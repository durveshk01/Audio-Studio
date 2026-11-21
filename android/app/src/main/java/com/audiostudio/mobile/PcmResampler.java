package com.audiostudio.mobile;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.Arrays;

/** Bounded streaming PCM conversion with channel mixing and a band-limited fractional resampler. */
public final class PcmResampler {
    private final int sourceRate, sourceChannels, outputRate, outputChannels;
    private final float[][] coefficients = new float[1024][16];
    private float[] pending = new float[0];
    private long baseFrame = 0, totalFrames = 0, outputFrames = 0;
    private boolean finished = false;

    public PcmResampler(int sourceRate, int sourceChannels, int outputRate, int outputChannels) {
        if (sourceRate < 8000 || sourceRate > 384000 || outputRate < 8000 || outputRate > 384000 || sourceChannels < 1 || sourceChannels > 8 || outputChannels < 1 || outputChannels > 2) {
            throw new IllegalArgumentException("Unsupported PCM sample rate or channel layout.");
        }
        this.sourceRate = sourceRate; this.sourceChannels = sourceChannels;
        this.outputRate = outputRate; this.outputChannels = outputChannels;
        double cutoff = outputRate < sourceRate ? (double) outputRate / sourceRate * 0.94 : 1;
        for (int phase = 0; phase < coefficients.length; phase++) {
            double sum = 0;
            for (int tap = 0; tap < 16; tap++) {
                double x = tap - 7 - (double) phase / coefficients.length;
                double sinc = Math.abs(x) < 1e-12 ? cutoff : Math.sin(Math.PI * x * cutoff) / (Math.PI * x);
                coefficients[phase][tap] = (float) (sinc * (0.5 + 0.5 * Math.cos(Math.PI * x / 8)));
                sum += coefficients[phase][tap];
            }
            for (int tap = 0; tap < 16; tap++) coefficients[phase][tap] /= sum;
        }
    }

    public static int bytesPerSample(int encoding) {
        if (encoding == 2) return 2; // PCM 16-bit
        if (encoding == 3) return 1; // PCM unsigned 8-bit
        if (encoding == 4 || encoding == 22) return 4; // float / signed 32-bit
        if (encoding == 21) return 3; // packed signed 24-bit
        throw new IllegalArgumentException("Unsupported decoder PCM encoding.");
    }

    public ByteBuffer append(ByteBuffer input, int encoding, int startFrame, int frameCount) {
        if (finished) throw new IllegalStateException("PCM conversion is already finished.");
        int alignment = sourceChannels * bytesPerSample(encoding);
        if (startFrame < 0 || frameCount < 0 || ((long) startFrame + frameCount) * alignment > input.remaining()) throw new IllegalArgumentException("PCM region exceeds its input buffer.");
        ByteBuffer source = input.duplicate().order(ByteOrder.LITTLE_ENDIAN);
        source.position(source.position() + startFrame * sourceChannels * bytesPerSample(encoding));
        float[] mixed = new float[frameCount * outputChannels];
        float[] frame = new float[sourceChannels];
        for (int i = 0; i < frameCount; i++) {
            for (int c = 0; c < sourceChannels; c++) {
                float value;
                if (encoding == 4) value = source.getFloat();
                else if (encoding == 22) value = source.getInt() / 2147483648f;
                else if (encoding == 21) {
                    int raw = (source.get() & 255) | ((source.get() & 255) << 8) | (source.get() << 16);
                    value = raw / 8388608f;
                } else if (encoding == 3) value = ((source.get() & 255) - 128) / 128f;
                else value = source.getShort() / 32768f;
                frame[c] = Float.isFinite(value) ? value : 0;
            }
            if (outputChannels == 1) {
                float sum = 0; int count = 0;
                for (int c = 0; c < sourceChannels; c++) if (!(sourceChannels >= 6 && c == 3)) { sum += frame[c]; count++; }
                mixed[i] = sum / count;
            } else if (sourceChannels == 1) mixed[i * 2] = mixed[i * 2 + 1] = frame[0];
            else {
                mixed[i * 2] = frame[0]; mixed[i * 2 + 1] = frame[1];
                if (sourceChannels == 4) {
                    // Quadraphonic PCM has rear L/R, not a center channel.
                    mixed[i * 2] = (frame[0] + frame[2] * 0.707f) / 1.707f;
                    mixed[i * 2 + 1] = (frame[1] + frame[3] * 0.707f) / 1.707f;
                } else if (sourceChannels > 2) {
                    mixed[i * 2] += frame[2] * 0.707f; mixed[i * 2 + 1] += frame[2] * 0.707f;
                    if (sourceChannels >= 5) {
                        int surround = sourceChannels >= 6 ? 4 : 3;
                        mixed[i * 2] += frame[surround] * 0.707f; mixed[i * 2 + 1] += frame[surround + 1] * 0.707f;
                    }
                    float scale = sourceChannels >= 5 ? 2.414f : 1.707f;
                    if (sourceChannels == 7) {
                        mixed[i * 2] += frame[6] * 0.5f; mixed[i * 2 + 1] += frame[6] * 0.5f;
                        scale += 0.5f;
                    } else if (sourceChannels == 8) {
                        mixed[i * 2] += frame[6] * 0.707f; mixed[i * 2 + 1] += frame[7] * 0.707f;
                        scale += 0.707f;
                    }
                    mixed[i * 2] /= scale; mixed[i * 2 + 1] /= scale;
                }
            }
        }
        int previous = pending.length;
        pending = Arrays.copyOf(pending, previous + mixed.length);
        System.arraycopy(mixed, 0, pending, previous, mixed.length);
        totalFrames += frameCount;
        return render(false);
    }

    public ByteBuffer finish() { finished = true; return render(true); }

    private ByteBuffer render(boolean flush) {
        long limit = flush ? Math.round((double) totalFrames * outputRate / sourceRate)
                : Math.max(0, (long) Math.ceil((totalFrames - 8) * (double) outputRate / sourceRate));
        int frames = (int) Math.max(0, limit - outputFrames);
        ByteBuffer result = ByteBuffer.allocate(frames * outputChannels * 2).order(ByteOrder.LITTLE_ENDIAN);
        while (outputFrames < limit) {
            double position = (double) outputFrames * sourceRate / outputRate;
            long center = (long) Math.floor(position);
            int phase = Math.min(1023, (int) ((position - center) * 1024));
            for (int c = 0; c < outputChannels; c++) {
                double sample = 0;
                for (int tap = 0; tap < 16; tap++) {
                    long index = center + tap - 7 - baseFrame;
                    if (index >= 0 && index * outputChannels + c < pending.length) sample += pending[(int) index * outputChannels + c] * coefficients[phase][tap];
                }
                sample = Math.max(-1, Math.min(1, sample));
                result.putShort((short) Math.round(sample * (sample < 0 ? 32768 : 32767)));
            }
            outputFrames++;
        }
        long keep = Math.max(baseFrame, (long) Math.floor((double) outputFrames * sourceRate / outputRate) - 7);
        int discard = (int) Math.min(pending.length, Math.max(0, keep - baseFrame) * outputChannels);
        pending = Arrays.copyOfRange(pending, discard, pending.length);
        baseFrame += discard / outputChannels;
        result.flip(); return result;
    }
}
