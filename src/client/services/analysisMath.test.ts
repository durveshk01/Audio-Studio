import { describe, expect, it } from "vitest";
import { analyzePcm } from "./analysisMath";

const rate = 48000;
function sine(hz: number, seconds = 1, amplitude = 0.1, phase = 0): Float32Array {
  return Float32Array.from({ length: rate * seconds }, (_, i) => amplitude * Math.sin(2 * Math.PI * hz * i / rate + phase));
}

describe("measured PCM analysis", () => {
  it("reports silence without fabricated frequency energy or loudness", () => {
    const result = analyzePcm([new Float32Array(rate)], rate, 96044);
    expect(result.lufs).toBeNull();
    expect(result.silencePercent).toBe(100);
    expect(result.silenceIntervals).toEqual([{ startSec: 0, endSec: 1 }]);
    expect(Object.values(result.frequencyBands)).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it("distinguishes equal-level tones by their actual FFT frequencies", () => {
    const bass = analyzePcm([sine(100)], rate, 96044);
    const mid = analyzePcm([sine(1000)], rate, 96044);
    expect(bass.rmsDb).toBeCloseTo(mid.rmsDb, 1);
    expect(bass.frequencyBands.bass).toBeGreaterThan(99);
    expect(mid.frequencyBands.mid).toBeGreaterThan(99);
  });

  it("sums K-weighted channel energies and retains antiphase stereo spectrum", () => {
    const mono = sine(1000);
    const single = analyzePcm([mono], rate, 96044);
    const stereo = analyzePcm([mono, mono.map((sample) => -sample)], rate, 192044);
    expect(stereo.lufs! - single.lufs!).toBeCloseTo(3, 1);
    expect(stereo.frequencyBands.mid).toBeGreaterThan(99);
  });

  it("counts isolated clipped samples and waveform tails without sparse sampling", () => {
    const pcm = new Float32Array(rate * 2); pcm[pcm.length - 1] = 1;
    const result = analyzePcm([pcm], rate, 192044);
    expect(result.clippingCount).toBe(1);
    expect(result.peakDb).toBe(0);
    expect(result.waveformPeaks.at(-1)).toBe(1);
  });

  it("estimates intersample overshoot rather than linearly interpolating it away", () => {
    const result = analyzePcm([sine(12000, 1, 0.8, Math.PI / 4)], rate, 96044);
    expect(result.truePeakDb).toBeGreaterThan(result.peakDb + 2);
  });
});
