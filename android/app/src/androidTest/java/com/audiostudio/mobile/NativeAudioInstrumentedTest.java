package com.audiostudio.mobile;

import static org.junit.Assert.*;
import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.media.MediaCodec;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.net.Uri;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class NativeAudioInstrumentedTest {
    private Context context() { return InstrumentationRegistry.getInstrumentation().getTargetContext(); }

    private File fixture(String name) throws Exception {
        File directory = new File(context().getCacheDir(), "audio-studio-native-tests");
        assertTrue(directory.isDirectory() || directory.mkdirs());
        File file = new File(directory, name);
        try (InputStream input = InstrumentationRegistry.getInstrumentation().getContext().getAssets().open(name);
             FileOutputStream output = new FileOutputStream(file)) {
            byte[] bytes = new byte[65536]; int count;
            while ((count = input.read(bytes)) >= 0) output.write(bytes, 0, count);
        }
        return file;
    }

    private static final class DecodedAudio {
        final double rms, audibleDurationSec;
        DecodedAudio(double rms, double audibleDurationSec) { this.rms = rms; this.audibleDurationSec = audibleDurationSec; }
    }

    private DecodedAudio decodedAudio(File file) throws Exception {
        MediaExtractor extractor = new MediaExtractor();
        MediaCodec decoder = null;
        try {
            extractor.setDataSource(file.getAbsolutePath()); extractor.selectTrack(0);
            MediaFormat format = extractor.getTrackFormat(0);
            int rate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE), channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT);
            decoder = MediaCodec.createDecoderByType(format.getString(MediaFormat.KEY_MIME));
            format.setInteger(MediaFormat.KEY_PCM_ENCODING, 2);
            decoder.configure(format, null, null, 0); decoder.start();
            boolean inputDone = false, done = false;
            double energy = 0; long samples = 0, firstAudibleFrame = -1, lastAudibleFrame = -1;
            long deadline = System.currentTimeMillis() + 30000;
            MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
            while (!done && System.currentTimeMillis() < deadline) {
                if (!inputDone) {
                    int index = decoder.dequeueInputBuffer(10000);
                    if (index >= 0) {
                        ByteBuffer input = decoder.getInputBuffer(index); input.clear();
                        int count = extractor.readSampleData(input, 0);
                        if (count < 0) { decoder.queueInputBuffer(index, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM); inputDone = true; }
                        else { decoder.queueInputBuffer(index, 0, count, extractor.getSampleTime(), 0); extractor.advance(); }
                    }
                }
                int index = decoder.dequeueOutputBuffer(info, 10000);
                if (index >= 0) {
                    try {
                        if (info.size > 0) {
                            ByteBuffer output = decoder.getOutputBuffer(index);
                            assertNotNull("AAC decoder returned no PCM buffer", output);
                            output.order(ByteOrder.LITTLE_ENDIAN); output.position(info.offset); output.limit(info.offset + info.size);
                            while (output.remaining() >= 2) {
                                double sample = output.getShort() / 32768.0; energy += sample * sample;
                                if (Math.abs(sample) > 0.02) {
                                    if (firstAudibleFrame < 0) firstAudibleFrame = samples / channels;
                                    lastAudibleFrame = samples / channels;
                                }
                                samples++;
                            }
                        }
                        done = (info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0;
                    } finally { decoder.releaseOutputBuffer(index, false); }
                }
            }
            assertTrue("AAC decode did not reach end of stream", done);
            assertTrue("AAC output contains no decoded samples", samples > 1000);
            return new DecodedAudio(Math.sqrt(energy / samples), firstAudibleFrame < 0 ? 0 : (lastAudibleFrame - firstAudibleFrame + 1.0) / rate);
        } finally {
            if (decoder != null) { try { decoder.stop(); } catch (Exception ignored) {} decoder.release(); }
            extractor.release();
        }
    }

    private String timeline(File file, int rate) throws Exception {
        MediaExtractor extractor = new MediaExtractor();
        try {
            extractor.setDataSource(file.getAbsolutePath()); extractor.selectTrack(0);
            StringBuilder description = new StringBuilder(extractor.getTrackFormat(0).toString());
            int packets = 0; long lastTime = -1;
            while (extractor.getSampleTime() >= 0) {
                long time = extractor.getSampleTime();
                if (packets > 0) assertEquals("AAC packet " + packets + " has a timestamp gap at " + rate + " Hz", 1024.0 * 1000000 / rate, time - lastTime, 200);
                lastTime = time;
                if (packets < 4) description.append("; packet ").append(packets).append(" at ").append(lastTime);
                packets++; extractor.advance();
            }
            return description.append("; packets=").append(packets).append("; lastTimeUs=").append(lastTime).toString();
        } finally { extractor.release(); }
    }

    private void conversion(String inputName, int rate, int channels) throws Exception {
        File input = fixture(inputName);
        File output = new File(input.getParentFile(), inputName + "-" + rate + "-" + channels + ".m4a");
        try {
            AudioTranscoder.TranscodeResult result = new AudioTranscoder().transcode(context(), Uri.fromFile(input), output, 128, rate, channels, 0.25, 1.5, null);
            assertEquals(rate, result.outputSampleRate); assertEquals(channels, result.outputChannels);
            assertEquals(output.length(), result.outputSize);
            // AAC-LC may add two priming frames and up to one final padding frame.
            assertEquals("Trimmed duration is wrong for " + inputName + " (" + rate + " Hz, " + channels + " channels): " + timeline(output, rate), 1.25, result.durationUs / 1000000.0, 3072.0 / rate + 0.001);
            DecodedAudio decoded = decodedAudio(output);
            assertTrue("Output contains silent/corrupt PCM for " + inputName, decoded.rms > 0.02);
            assertEquals("Decoded tone has the wrong trim duration for " + inputName + " (" + rate + " Hz, " + channels + " channels)", 1.25, decoded.audibleDurationSec, 0.03);
        } finally { output.delete(); input.delete(); }
    }

    @Test public void releaseIdentityAndOfflinePermissionsAreCorrect() throws Exception {
        assertEquals("com.audiostudio.mobile", context().getPackageName());
        if ("true".equals(InstrumentationRegistry.getArguments().getString("release"))) {
            PackageInfo info = context().getPackageManager().getPackageInfo(context().getPackageName(), android.content.pm.PackageManager.GET_PERMISSIONS);
            assertEquals(InstrumentationRegistry.getArguments().getString("expectedVersion"), info.versionName);
            assertEquals(0, info.applicationInfo.flags & ApplicationInfo.FLAG_DEBUGGABLE);
            if (info.requestedPermissions != null) for (String permission : info.requestedPermissions) assertNotEquals("android.permission.INTERNET", permission);
        }
    }

    @Test public void nativeWavResamplingWorksAtEverySupportedRateAndChannelCount() throws Exception {
        for (int rate : new int[] {22050, 32000, 44100, 48000}) for (int channels : new int[] {1, 2}) conversion("native-tone.wav", rate, channels);
    }

    @Test public void nativeDecoderAcceptsAllAdvertisedInputContainers() throws Exception {
        for (String format : new String[] {"mp3", "m4a", "aac", "flac", "ogg"}) conversion("native-tone." + format, 44100, 2);
    }

    @Test public void invalidTrimAndCancellationNeverLeaveCompletedOutputs() throws Exception {
        File input = fixture("native-tone.wav");
        File output = new File(input.getParentFile(), "cancelled.m4a");
        try {
            assertThrows(Exception.class, () -> new AudioTranscoder().transcode(context(), Uri.fromFile(input), output, 128, 44100, 2, 2, 1, null));
            assertFalse(output.exists());
            AudioTranscoder cancelled = new AudioTranscoder(); cancelled.cancel();
            assertThrows(Exception.class, () -> cancelled.transcode(context(), Uri.fromFile(input), output, 128, 44100, 2, 0, 0, null));
            assertFalse(output.exists());
            AudioTranscoder running = new AudioTranscoder();
            assertThrows(Exception.class, () -> running.transcode(context(), Uri.fromFile(input), output, 128, 44100, 2, 0, 0,
                (percent, stage, bytes) -> { if (percent >= 5) running.cancel(); }));
            assertFalse("Cancelled conversion left an audio file", output.exists());
        } finally { output.delete(); input.delete(); }
    }
}
