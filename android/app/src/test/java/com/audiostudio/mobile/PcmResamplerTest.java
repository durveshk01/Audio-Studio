package com.audiostudio.mobile;

import static org.junit.Assert.*;
import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import org.junit.Test;

public class PcmResamplerTest {
    private static ByteBuffer sine(int rate, int frames, int channels, double frequency) {
        ByteBuffer bytes = ByteBuffer.allocate(frames * channels * 2).order(ByteOrder.LITTLE_ENDIAN);
        for (int i = 0; i < frames; i++) for (int c = 0; c < channels; c++) bytes.putShort((short) Math.round(12000 * Math.sin(2 * Math.PI * frequency * i / rate)));
        bytes.flip(); return bytes;
    }

    private static byte[] converted(ByteBuffer input, int rate, int sourceChannels, int outputRate, int channels, int chunkFrames) throws Exception {
        PcmResampler converter = new PcmResampler(rate, sourceChannels, outputRate, channels);
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        while (input.hasRemaining()) {
            int frames = Math.min(chunkFrames, input.remaining() / (sourceChannels * 2));
            ByteBuffer block = input.slice(); block.limit(frames * sourceChannels * 2);
            ByteBuffer rendered = converter.append(block, 2, 0, frames);
            byte[] bytes = new byte[rendered.remaining()]; rendered.get(bytes); output.write(bytes);
            input.position(input.position() + frames * sourceChannels * 2);
        }
        ByteBuffer tail = converter.finish(); byte[] bytes = new byte[tail.remaining()]; tail.get(bytes); output.write(bytes);
        return output.toByteArray();
    }

    @Test public void streamingChunksPreserveSamplesAndExactDuration() throws Exception {
        for (int target : new int[] {22050, 32000, 44100, 48000}) {
            byte[] whole = converted(sine(48000, 48017, 2, 880), 48000, 2, target, 1, 48017);
            byte[] chunks = converted(sine(48000, 48017, 2, 880), 48000, 2, target, 1, 317);
            assertArrayEquals("PCM changed at a chunk boundary for " + target, whole, chunks);
            assertEquals(Math.round(48017.0 * target / 48000) * 2, whole.length);
        }
    }

    @Test public void monoIsDuplicatedWithoutSwappingStereoChannels() throws Exception {
        byte[] bytes = converted(sine(44100, 4410, 1, 440), 44100, 1, 44100, 2, 93);
        ByteBuffer pcm = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN);
        while (pcm.hasRemaining()) assertEquals(pcm.getShort(), pcm.getShort());
    }

    @Test public void downsamplingSuppressesUltrasonicAliases() throws Exception {
        byte[] bytes = converted(sine(48000, 48000, 1, 18000), 48000, 1, 22050, 1, 383);
        ByteBuffer pcm = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN);
        double energy = 0; int count = 0;
        while (pcm.hasRemaining()) { double value = pcm.getShort() / 32768.0; energy += value * value; count++; }
        assertTrue("High-frequency alias leaked into speech-rate output", Math.sqrt(energy / count) < 0.025);
    }

    @Test public void quadAndSurroundRearChannelsAreNotDropped() {
        for (int channels : new int[] {4, 7, 8}) {
            ByteBuffer source = ByteBuffer.allocate(64 * channels * 2).order(ByteOrder.LITTLE_ENDIAN);
            for (int i = 0; i < 64; i++) for (int c = 0; c < channels; c++) source.putShort((short) (c == channels - 1 ? 16000 : 0));
            source.flip();
            PcmResampler converter = new PcmResampler(44100, channels, 44100, 2);
            ByteBuffer pcm = converter.append(source, 2, 0, 64).order(ByteOrder.LITTLE_ENDIAN);
            int maximum = 0;
            while (pcm.hasRemaining()) maximum = Math.max(maximum, Math.abs(pcm.getShort()));
            assertTrue("Rear audio disappeared in " + channels + "-channel downmix", maximum > 2000);
        }
    }

    @Test public void floatPcmClampsNonFiniteValuesAndSupportsTrimOffsets() {
        ByteBuffer source = ByteBuffer.allocate(64 * 4).order(ByteOrder.LITTLE_ENDIAN);
        for (int i = 0; i < 64; i++) source.putFloat(i < 16 ? Float.NaN : 0.5f);
        source.flip();
        PcmResampler converter = new PcmResampler(44100, 1, 44100, 1);
        ByteBuffer pcm = converter.append(source, 4, 16, 32).order(ByteOrder.LITTLE_ENDIAN);
        pcm.position(16);
        assertEquals(16384, pcm.getShort(), 1);
    }

    @Test public void rejectsOutOfBoundsAndUnsupportedPcm() {
        PcmResampler converter = new PcmResampler(44100, 1, 44100, 1);
        assertThrows(IllegalArgumentException.class, () -> converter.append(ByteBuffer.allocate(8), 2, 2, 3));
        assertThrows(IllegalArgumentException.class, () -> PcmResampler.bytesPerSample(99));
        converter.finish();
        assertThrows(IllegalStateException.class, () -> converter.append(ByteBuffer.allocate(8), 2, 0, 4));
    }
}
