export interface AudioAnalysisMetrics {
  durationSec: number; sampleRate: number; channels: number; fileSizeBytes: number;
  peakDb: number; rmsDb: number; lufs: number | null; truePeakDb: number;
  clippingCount: number; silencePercent: number; dynamicRangeDb: number;
  waveformPeaks: number[]; silenceIntervals: Array<{ startSec: number; endSec: number }>;
  frequencyBands: { subBass: number; bass: number; lowMid: number; mid: number; highMid: number; high: number };
}

const db = (amplitude: number) => amplitude > 0 ? Math.max(-120, 20 * Math.log10(amplitude)) : -120;
const round = (value: number) => Math.round(value * 10) / 10;
const energyLufs = (energy: number) => energy > 0 ? -0.691 + 10 * Math.log10(energy) : -120;
interface Filter { b0: number; b1: number; b2: number; a1: number; a2: number }
interface FilterState { x1: number; x2: number; y1: number; y2: number }

function kWeightFilters(rate: number): [Filter, Filter] {
  const k = Math.tan(Math.PI * 1681.974450955533 / rate);
  const q = 0.7071752369554196, vh = 10 ** (3.999843853973347 / 20), vb = vh ** 0.4996667741545416;
  const a0 = 1 + k / q + k * k;
  const shelf = { b0: (vh + vb * k / q + k * k) / a0, b1: 2 * (k * k - vh) / a0,
    b2: (vh - vb * k / q + k * k) / a0, a1: 2 * (k * k - 1) / a0, a2: (1 - k / q + k * k) / a0 };
  const r = Math.tan(Math.PI * 38.13547087602444 / rate), rq = 0.5003270373238773, ra0 = 1 + r / rq + r * r;
  return [shelf, { b0: 1, b1: -2, b2: 1, a1: 2 * (r * r - 1) / ra0, a2: (1 - r / rq + r * r) / ra0 }];
}

function filtered(value: number, f: Filter, state: FilterState): number {
  const y = f.b0 * value + f.b1 * state.x1 + f.b2 * state.x2 - f.a1 * state.y1 - f.a2 * state.y2;
  state.x2 = state.x1; state.x1 = value; state.y2 = state.y1; state.y1 = y;
  return y;
}

function channelWeight(index: number, count: number): number {
  if (count >= 6 && index === 3) return 0; // Web Audio 5.1/7.1 LFE channel.
  if ((count === 4 && index >= 2) || (count === 5 && index >= 3) || (count >= 6 && index >= 4)) return 1.41;
  return 1;
}

function integratedLoudness(hops: Float64Array, hop: number, length: number): number | null {
  const energies: number[] = [];
  // 400 ms blocks, 75% overlap, channel energies summed (not averaged).
  for (let i = 0; (i + 4) * hop <= length; i++) energies.push((hops[i] + hops[i + 1] + hops[i + 2] + hops[i + 3]) / (4 * hop));
  const absolute = energies.filter((energy) => energyLufs(energy) >= -70);
  if (!absolute.length) return null;
  const relative = energyLufs(absolute.reduce((a, b) => a + b, 0) / absolute.length) - 10;
  const gated = absolute.filter((energy) => energyLufs(energy) >= relative);
  return round(energyLufs(gated.reduce((a, b) => a + b, 0) / gated.length));
}

function interpolatedPeak(channels: Float32Array[], samplePeak: number): number {
  if (!samplePeak) return 0;
  // Four-times oversampling with a windowed-sinc reconstruction filter. This is an estimate, not a certified meter.
  const phases = [0.25, 0.5, 0.75].map((phase) => {
    const taps = Array.from({ length: 16 }, (_, i) => {
      const x = i - 7 - phase;
      return (Math.abs(x) < 1e-12 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x)) * (0.5 + 0.5 * Math.cos(Math.PI * x / 8));
    });
    const sum = taps.reduce((a, b) => a + b, 0);
    return taps.map((t) => t / sum);
  });
  let peak = samplePeak;
  for (const channel of channels) for (let i = 0; i < channel.length - 1; i++) {
    for (const coefficients of phases) {
      let sample = 0;
      for (let tap = 0; tap < coefficients.length; tap++) sample += (channel[i + tap - 7] || 0) * coefficients[tap];
      peak = Math.max(peak, Math.abs(sample));
    }
  }
  return peak;
}

function fft(real: Float64Array, imaginary: Float64Array): void {
  const n = real.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [real[i], real[j]] = [real[j], real[i]]; [imaginary[i], imaginary[j]] = [imaginary[j], imaginary[i]]; }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1, angle = -2 * Math.PI / size;
    for (let start = 0; start < n; start += size) for (let i = 0; i < half; i++) {
      const wr = Math.cos(angle * i), wi = Math.sin(angle * i), even = start + i, odd = even + half;
      const tr = wr * real[odd] - wi * imaginary[odd], ti = wr * imaginary[odd] + wi * real[odd];
      real[odd] = real[even] - tr; imaginary[odd] = imaginary[even] - ti;
      real[even] += tr; imaginary[even] += ti;
    }
  }
}

function spectrum(channels: Float32Array[], sampleRate: number): AudioAnalysisMetrics["frequencyBands"] {
  const size = 4096, count = Math.min(72, Math.max(1, Math.ceil(channels[0].length / size)));
  const energy = new Float64Array(size / 2);
  for (let frame = 0; frame < count; frame++) for (const channel of channels) {
    const start = Math.floor(frame / Math.max(1, count - 1) * Math.max(0, channel.length - size));
    const real = new Float64Array(size), imaginary = new Float64Array(size);
    for (let i = 0; i < size; i++) real[i] = (channel[start + i] || 0) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (size - 1)));
    fft(real, imaginary);
    for (let bin = 1; bin < energy.length; bin++) energy[bin] += real[bin] ** 2 + imaginary[bin] ** 2;
  }
  const ranges = [20, 60, 250, 500, 2000, 6000, 20000];
  const bands = new Float64Array(6);
  for (let bin = 1; bin < energy.length; bin++) {
    const hz = bin * sampleRate / size;
    for (let i = 0; i < bands.length; i++) if (hz >= ranges[i] && hz < ranges[i + 1]) { bands[i] += energy[bin]; break; }
  }
  const total = bands.reduce((a, b) => a + b, 0);
  const percent = Array.from(bands, (value) => total ? round(value / total * 100) : 0);
  return { subBass: percent[0], bass: percent[1], lowMid: percent[2], mid: percent[3], highMid: percent[4], high: percent[5] };
}

export function analyzePcm(channels: Float32Array[], sampleRate: number, fileSize: number, status?: (message: string) => void): AudioAnalysisMetrics {
  const length = channels[0]?.length || 0;
  if (!length || sampleRate < 8000 || channels.some((c) => c.length !== length)) throw new Error("Invalid or empty decoded audio.");
  const hop = Math.round(sampleRate * 0.1);
  const rawHops = new Float64Array(Math.ceil(length / hop)), weightedHops = new Float64Array(rawHops.length);
  const waveformPeaks = new Array<number>(180).fill(0);
  const [shelf, highPass] = kWeightFilters(sampleRate);
  let samplePeak = 0, squares = 0, clippingCount = 0;
  status?.("Measuring every decoded sample and K-weighted loudness…");
  channels.forEach((channel, c) => {
    const shelfState: FilterState = { x1: 0, x2: 0, y1: 0, y2: 0 }, hpState = { ...shelfState };
    for (let i = 0; i < length; i++) {
      const value = channel[i], magnitude = Math.abs(value), energy = value * value;
      samplePeak = Math.max(samplePeak, magnitude); squares += energy;
      if (magnitude >= 0.999) clippingCount++;
      const block = Math.floor(i / hop);
      rawHops[block] += energy;
      const weighted = filtered(filtered(value, shelf, shelfState), highPass, hpState);
      weightedHops[block] += weighted * weighted * channelWeight(c, channels.length);
      const bin = Math.min(179, Math.floor(i * 180 / length));
      waveformPeaks[bin] = Math.max(waveformPeaks[bin], magnitude);
    }
  });
  const silenceIntervals: AudioAnalysisMetrics["silenceIntervals"] = [];
  let silenceStart = -1, silentFrames = 0;
  for (let block = 0; block < rawHops.length; block++) {
    const frames = Math.min(hop, length - block * hop);
    const silent = Math.sqrt(rawHops[block] / (frames * channels.length)) < 10 ** (-50 / 20);
    if (silent) { silentFrames += frames; if (silenceStart < 0) silenceStart = block * hop / sampleRate; }
    if ((!silent || block === rawHops.length - 1) && silenceStart >= 0) {
      silenceIntervals.push({ startSec: silenceStart, endSec: (silent ? Math.min(length, (block + 1) * hop) : block * hop) / sampleRate });
      silenceStart = -1;
    }
  }
  const peakDb = round(db(samplePeak)), rmsDb = round(db(Math.sqrt(squares / (length * channels.length))));
  status?.("Reconstructing a 4× interpolated peak estimate…");
  const truePeakDb = round(db(interpolatedPeak(channels, samplePeak)));
  status?.("Measuring FFT energy in windows across the track…");
  return { durationSec: length / sampleRate, sampleRate, channels: channels.length, fileSizeBytes: fileSize,
    peakDb, rmsDb, truePeakDb, lufs: integratedLoudness(weightedHops, hop, length), clippingCount,
    silencePercent: round(silentFrames / length * 100), dynamicRangeDb: round(Math.max(0, peakDb - rmsDb)),
    waveformPeaks, silenceIntervals, frequencyBands: spectrum(channels, sampleRate) };
}
