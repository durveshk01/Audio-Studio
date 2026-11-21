package com.audiostudio.mobile;

import android.content.Context;
import android.media.MediaCodec;
import android.media.MediaCodecInfo;
import android.media.MediaCodecList;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.media.MediaMuxer;
import android.net.Uri;

import java.io.File;
import java.io.IOException;
import java.nio.ByteBuffer;

public final class AudioTranscoder {
    private static final int TIMEOUT_US = 10000;
    private volatile boolean cancelled;
    public interface ProgressListener { void onProgress(int percent, String stage, long bytesProcessed); }
    public void cancel() { cancelled = true; }
    private void checkCancelled() throws IOException { if (cancelled || Thread.currentThread().isInterrupted()) throw new IOException("Operation cancelled."); }

    public static final class TranscodeResult {
        public File outputFile;
        public long durationUs, outputSize;
        public int outputBitrateKbps, outputSampleRate, outputChannels;
    }

    public TranscodeResult transcode(Context context, Uri input, File output, int bitrate, int rate, int channels,
            double startSec, double endSec, ProgressListener listener) throws Exception {
        if (bitrate < 64 || bitrate > 320 || channels < 1 || channels > 2 || !(rate == 22050 || rate == 32000 || rate == 44100 || rate == 48000)) throw new IOException("Unsupported output settings.");
        checkCancelled();
        MediaExtractor extractor = new MediaExtractor();
        MediaCodec decoder = null;
        EncoderSink sink = null;
        boolean success = false;
        try {
            extractor.setDataSource(context, input, null);
            MediaFormat sourceFormat = null;
            for (int i = 0; i < extractor.getTrackCount(); i++) {
                MediaFormat f = extractor.getTrackFormat(i);
                String mime = f.getString(MediaFormat.KEY_MIME);
                if (mime != null && mime.startsWith("audio/")) { sourceFormat = f; extractor.selectTrack(i); break; }
            }
            if (sourceFormat == null) throw new IOException("No supported audio track was found.");
            long duration = sourceFormat.containsKey(MediaFormat.KEY_DURATION) ? sourceFormat.getLong(MediaFormat.KEY_DURATION) : 0;
            long start = Math.round(startSec * 1000000), end = endSec > 0 ? Math.round(endSec * 1000000) : duration;
            if (!Double.isFinite(startSec) || !Double.isFinite(endSec) || start < 0 || end <= start || (duration > 0 && end > duration + 10000)) throw new IOException("Choose a trim region inside the track.");
            if (duration > 0) end = Math.min(end, duration);
            if (start > 0) extractor.seekTo(start, MediaExtractor.SEEK_TO_PREVIOUS_SYNC);
            sink = new EncoderSink(output, bitrate, rate, channels, end - start, listener);
            String mime = sourceFormat.getString(MediaFormat.KEY_MIME);
            PcmResampler converter;
            if ("audio/raw".equals(mime)) {
                int sourceRate = sourceFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE), sourceChannels = sourceFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT);
                int encoding = sourceFormat.containsKey(MediaFormat.KEY_PCM_ENCODING) ? sourceFormat.getInteger(MediaFormat.KEY_PCM_ENCODING) : 2;
                converter = new PcmResampler(sourceRate, sourceChannels, rate, channels);
                ByteBuffer raw = ByteBuffer.allocate(1024 * 1024);
                while (true) {
                    checkCancelled(); raw.clear();
                    int size = extractor.readSampleData(raw, 0);
                    long time = extractor.getSampleTime();
                    if (size < 0 || time >= end) break;
                    raw.position(0); raw.limit(size);
                    writeTrimmed(sink, converter, raw, encoding, sourceRate, sourceChannels, time, start, end);
                    extractor.advance();
                }
            } else {
                decoder = MediaCodec.createDecoderByType(mime);
                sourceFormat.setInteger(MediaFormat.KEY_PCM_ENCODING, 2);
                decoder.configure(sourceFormat, null, null, 0); decoder.start();
                int sourceRate = sourceFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE), sourceChannels = sourceFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT), encoding = 2;
                converter = new PcmResampler(sourceRate, sourceChannels, rate, channels);
                boolean inputDone = false, decoderDone = false;
                MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
                long deadline = System.currentTimeMillis() + 10 * 60 * 1000;
                while (!decoderDone) {
                    checkCancelled();
                    if (System.currentTimeMillis() > deadline) throw new IOException("Audio conversion exceeded the time limit.");
                    if (!inputDone) {
                        int index = decoder.dequeueInputBuffer(TIMEOUT_US);
                        if (index >= 0) {
                            ByteBuffer buffer = decoder.getInputBuffer(index);
                            if (buffer == null) throw new IOException("Decoder input buffer is unavailable.");
                            buffer.clear();
                            int size = extractor.readSampleData(buffer, 0);
                            long time = extractor.getSampleTime();
                            if (size < 0 || time >= end) { decoder.queueInputBuffer(index, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM); inputDone = true; }
                            else { decoder.queueInputBuffer(index, 0, size, time, 0); extractor.advance(); }
                        }
                    }
                    int index = decoder.dequeueOutputBuffer(info, TIMEOUT_US);
                    if (index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                        MediaFormat actual = decoder.getOutputFormat();
                        int actualRate = actual.getInteger(MediaFormat.KEY_SAMPLE_RATE), actualChannels = actual.getInteger(MediaFormat.KEY_CHANNEL_COUNT);
                        if (sink.frames > 0 && (actualRate != sourceRate || actualChannels != sourceChannels)) throw new IOException("Decoder changed its audio layout mid-stream.");
                        sourceRate = actualRate; sourceChannels = actualChannels;
                        encoding = actual.containsKey(MediaFormat.KEY_PCM_ENCODING) ? actual.getInteger(MediaFormat.KEY_PCM_ENCODING) : 2;
                        converter = new PcmResampler(sourceRate, sourceChannels, rate, channels);
                    } else if (index >= 0) {
                        try {
                            ByteBuffer buffer = decoder.getOutputBuffer(index);
                            if (buffer != null && info.size > 0) {
                                buffer.position(info.offset); buffer.limit(info.offset + info.size);
                                writeTrimmed(sink, converter, buffer, encoding, sourceRate, sourceChannels, info.presentationTimeUs, start, end);
                            }
                            decoderDone = (info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0;
                        } finally { decoder.releaseOutputBuffer(index, false); }
                    }
                    sink.drain(0);
                }
            }
            sink.write(converter.finish());
            sink.finish(); // Drain EOS and finalize the container before measuring it.
            if (output.length() <= 0) throw new IOException("The encoder produced an empty file.");
            MediaExtractor verification = new MediaExtractor();
            TranscodeResult result = new TranscodeResult();
            try {
                verification.setDataSource(output.getAbsolutePath());
                if (verification.getTrackCount() != 1) throw new IOException("The M4A output has no valid audio track.");
                MediaFormat actual = verification.getTrackFormat(0);
                result.durationUs = actual.getLong(MediaFormat.KEY_DURATION);
                result.outputSampleRate = actual.getInteger(MediaFormat.KEY_SAMPLE_RATE);
                result.outputChannels = actual.getInteger(MediaFormat.KEY_CHANNEL_COUNT);
                if (result.durationUs <= 0 || result.outputSampleRate != rate || result.outputChannels != channels
                        || !MediaFormat.MIMETYPE_AUDIO_AAC.equals(actual.getString(MediaFormat.KEY_MIME))) throw new IOException("The M4A output does not match the selected audio settings.");
            } finally { verification.release(); }
            result.outputFile = output; result.outputSize = output.length();
            result.outputBitrateKbps = (int) Math.round(result.outputSize * 8000.0 / result.durationUs);
            checkCancelled();
            success = true;
            if (listener != null) listener.onProgress(100, "M4A file finalized and verified.", result.outputSize);
            return result;
        } finally {
            if (decoder != null) { try { decoder.stop(); } catch (Exception ignored) {} decoder.release(); }
            if (sink != null) sink.close();
            extractor.release();
            if (!success) output.delete();
        }
    }

    private void writeTrimmed(EncoderSink sink, PcmResampler converter, ByteBuffer pcm, int encoding, int rate, int channels,
            long time, long start, long end) throws Exception {
        int blockAlign = channels * PcmResampler.bytesPerSample(encoding);
        if (pcm.remaining() % blockAlign != 0) throw new IOException("Decoder emitted an incomplete PCM frame.");
        int count = pcm.remaining() / blockAlign;
        int first = (int) Math.max(0, Math.min(count, Math.ceil((start - time) * rate / 1000000.0)));
        int last = (int) Math.max(first, Math.min(count, Math.ceil((end - time) * rate / 1000000.0)));
        if (last > first) sink.write(converter.append(pcm, encoding, first, last - first));
    }

    private final class EncoderSink {
        private final MediaCodec encoder;
        private MediaMuxer muxer;
        private final int rate, channels;
        private final long duration;
        private final ProgressListener listener;
        private final ByteBuffer pendingPcm;
        private int track = -1;
        private boolean muxerStarted, encoderDone;
        private long frames, encodedFrames, bytes;
        private final MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();

        EncoderSink(File output, int bitrate, int rate, int channels, long duration, ProgressListener listener) throws Exception {
            this.rate = rate; this.channels = channels; this.duration = duration; this.listener = listener;
            pendingPcm = ByteBuffer.allocate(1024 * channels * 2);
            MediaFormat format = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, rate, channels);
            format.setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC);
            format.setInteger(MediaFormat.KEY_BIT_RATE, bitrate * 1000); format.setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 65536);
            String name = new MediaCodecList(MediaCodecList.REGULAR_CODECS).findEncoderForFormat(format);
            if (name == null) throw new IOException("This device has no AAC encoder for the selected settings.");
            encoder = MediaCodec.createByCodecName(name);
            try {
                encoder.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE); encoder.start();
                if (!output.getParentFile().isDirectory() && !output.getParentFile().mkdirs()) throw new IOException("Could not create the audio output directory.");
                muxer = new MediaMuxer(output.getAbsolutePath(), MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);
            } catch (Exception error) { encoder.release(); throw error; }
        }

        void write(ByteBuffer pcm) throws Exception {
            // Keep one AAC-LC frame pending so chunk boundaries cannot introduce timestamp gaps,
            // and the final real PCM buffer can carry EOS instead of a later empty input buffer.
            while (pcm.hasRemaining()) {
                checkCancelled();
                if (!pendingPcm.hasRemaining()) {
                    pendingPcm.flip(); queue(pendingPcm, false); pendingPcm.clear();
                }
                int count = Math.min(pendingPcm.remaining(), pcm.remaining());
                int oldLimit = pcm.limit(); pcm.limit(pcm.position() + count);
                pendingPcm.put(pcm); pcm.limit(oldLimit);
            }
        }

        private void queue(ByteBuffer pcm, boolean endOfStream) throws Exception {
            long deadline = System.currentTimeMillis() + 30000;
            while (true) {
                checkCancelled(); drain(0);
                int index = encoder.dequeueInputBuffer(TIMEOUT_US);
                if (index < 0) { if (System.currentTimeMillis() > deadline) throw new IOException("AAC encoder stopped accepting input."); continue; }
                ByteBuffer input = encoder.getInputBuffer(index);
                if (input == null) throw new IOException("Encoder input buffer is unavailable.");
                input.clear();
                int count = pcm.remaining();
                if (input.remaining() < count) throw new IOException("Encoder buffer cannot hold an AAC PCM frame.");
                input.put(pcm);
                encoder.queueInputBuffer(index, 0, count, frames * 1000000 / rate, endOfStream ? MediaCodec.BUFFER_FLAG_END_OF_STREAM : 0);
                frames += count / (channels * 2);
                return;
            }
        }

        void drain(int timeout) throws Exception {
            int index;
            do {
                index = encoder.dequeueOutputBuffer(info, timeout);
                if (index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    if (muxerStarted) throw new IOException("AAC encoder changed its output format twice.");
                    track = muxer.addTrack(encoder.getOutputFormat()); muxer.start(); muxerStarted = true;
                } else if (index >= 0) {
                    try {
                        ByteBuffer buffer = encoder.getOutputBuffer(index);
                        if (buffer != null && info.size > 0 && (info.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) == 0) {
                            if (!muxerStarted) throw new IOException("AAC data arrived before its container format.");
                            buffer.position(info.offset); buffer.limit(info.offset + info.size);
                            // AAC-LC packets each represent 1024 samples. Some codecs shift EOS
                            // timestamps after a partial PCM buffer; derive a continuous media clock
                            // from the encoded samples so that those shifts cannot insert silence.
                            info.presentationTimeUs = encodedFrames * 1000000 / rate;
                            encodedFrames += 1024;
                            muxer.writeSampleData(track, buffer, info); bytes += info.size;
                            if (bytes > 100L * 1024 * 1024) throw new IOException("The encoded output exceeds 100 MB. Choose a lower bitrate or shorter region.");
                            if (listener != null) listener.onProgress((int) Math.min(99, info.presentationTimeUs * 100 / Math.max(1, duration)), "Encoding AAC on this device…", bytes);
                        }
                        if ((info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) encoderDone = true;
                    } finally { encoder.releaseOutputBuffer(index, false); }
                }
                timeout = 0;
            } while (index >= 0 || index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED);
        }

        void finish() throws Exception {
            long deadline = System.currentTimeMillis() + 30000;
            if (pendingPcm.position() == 0) throw new IOException("The selected region contains no PCM audio.");
            pendingPcm.flip(); queue(pendingPcm, true);
            while (!encoderDone) { checkCancelled(); drain(TIMEOUT_US); if (System.currentTimeMillis() > deadline) throw new IOException("AAC end-of-stream timed out."); }
            if (!muxerStarted || bytes == 0) throw new IOException("The selected region contains no encoded audio.");
            muxer.stop(); muxer.release(); muxer = null;
        }

        void close() {
            try { encoder.stop(); } catch (Exception ignored) {} encoder.release();
            if (muxer != null) { try { if (muxerStarted) muxer.stop(); } catch (Exception ignored) {} muxer.release(); }
        }
    }
}
