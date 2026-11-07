package com.audiostudio.mobile;

import android.content.Context;
import android.media.MediaCodec;
import android.media.MediaCodecInfo;
import android.media.MediaCodecList;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.media.MediaMuxer;
import android.net.Uri;
import android.util.Log;

import java.io.File;
import java.io.IOException;
import java.nio.ByteBuffer;

public class AudioTranscoder {
    private static final String TAG = "AudioTranscoder";
    private static final int TIMEOUT_US = 10000;

    public interface ProgressListener {
        void onProgress(int percent, String stage, long bytesProcessed);
    }

    private volatile boolean isCancelled = false;

    public void cancel() {
        this.isCancelled = true;
    }

    public static class TranscodeResult {
        public File outputFile;
        public long durationUs;
        public int outputBitrateKbps;
        public int outputSampleRate;
        public int outputChannels;
        public long originalSize;
        public long outputSize;
    }

    public TranscodeResult transcode(
            Context context,
            Uri inputUri,
            File outputFile,
            int targetBitrateKbps,
            int targetSampleRate,
            int targetChannels,
            double trimStartSec,
            double trimEndSec,
            ProgressListener listener
    ) throws Exception {
        MediaExtractor extractor = new MediaExtractor();
        MediaCodec decoder = null;
        MediaCodec encoder = null;
        MediaMuxer muxer = null;

        isCancelled = false;

        try {
            extractor.setDataSource(context, inputUri, null);

            int audioTrackIndex = -1;
            MediaFormat inputFormat = null;
            for (int i = 0; i < extractor.getTrackCount(); i++) {
                MediaFormat format = extractor.getTrackFormat(i);
                String mime = format.getString(MediaFormat.KEY_MIME);
                if (mime != null && mime.startsWith("audio/")) {
                    audioTrackIndex = i;
                    inputFormat = format;
                    break;
                }
            }

            if (audioTrackIndex < 0 || inputFormat == null) {
                throw new IOException("No audio track found in the source file.");
            }

            extractor.selectTrack(audioTrackIndex);

            long durationUs = inputFormat.containsKey(MediaFormat.KEY_DURATION)
                    ? inputFormat.getLong(MediaFormat.KEY_DURATION) : 0L;
            int srcSampleRate = inputFormat.containsKey(MediaFormat.KEY_SAMPLE_RATE)
                    ? inputFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE) : 44100;
            int srcChannels = inputFormat.containsKey(MediaFormat.KEY_CHANNEL_COUNT)
                    ? inputFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT) : 2;

            long startUs = trimStartSec > 0 ? (long) (trimStartSec * 1_000_000L) : 0L;
            long endUs = trimEndSec > 0 ? (long) (trimEndSec * 1_000_000L) : durationUs;
            if (endUs <= 0 || endUs > durationUs) endUs = durationUs;

            if (startUs > 0) {
                extractor.seekTo(startUs, MediaExtractor.SEEK_TO_CLOSEST_SYNC);
            }

            long processDurationUs = (endUs > startUs) ? (endUs - startUs) : durationUs;
            if (processDurationUs <= 0) processDurationUs = 1_000_000L;

            int outSampleRate = targetSampleRate > 0 ? targetSampleRate : srcSampleRate;
            int outChannels = targetChannels > 0 ? targetChannels : srcChannels;
            int outBitrate = targetBitrateKbps > 0 ? targetBitrateKbps * 1000 : 128000;

            String decoderMime = inputFormat.getString(MediaFormat.KEY_MIME);
            decoder = MediaCodec.createDecoderByType(decoderMime);
            decoder.configure(inputFormat, null, null, 0);
            decoder.start();

            MediaFormat outputFormat = MediaFormat.createAudioFormat(
                    MediaFormat.MIMETYPE_AUDIO_AAC, outSampleRate, outChannels);
            outputFormat.setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC);
            outputFormat.setInteger(MediaFormat.KEY_BIT_RATE, outBitrate);
            outputFormat.setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 64 * 1024);

            encoder = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC);
            encoder.configure(outputFormat, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE);
            encoder.start();

            if (outputFile.exists()) {
                outputFile.delete();
            }
            outputFile.getParentFile().mkdirs();

            muxer = new MediaMuxer(outputFile.getAbsolutePath(), MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);

            boolean extractorDone = false;
            boolean decoderDone = false;
            boolean encoderDone = false;
            boolean muxerStarted = false;
            int muxerAudioTrackIndex = -1;

            MediaCodec.BufferInfo decoderOutputBufferInfo = new MediaCodec.BufferInfo();
            MediaCodec.BufferInfo encoderOutputBufferInfo = new MediaCodec.BufferInfo();

            long totalBytesEncoded = 0;
            long presentationTimeBase = -1;

            while (!encoderDone && !isCancelled) {
                // 1. Feed input to decoder
                if (!extractorDone) {
                    int decoderInputIndex = decoder.dequeueInputBuffer(TIMEOUT_US);
                    if (decoderInputIndex >= 0) {
                        ByteBuffer inputBuffer = decoder.getInputBuffer(decoderInputIndex);
                        if (inputBuffer != null) {
                            inputBuffer.clear();
                            int sampleSize = extractor.readSampleData(inputBuffer, 0);
                            long sampleTime = extractor.getSampleTime();

                            if (sampleSize < 0 || (endUs > 0 && sampleTime > endUs)) {
                                decoder.queueInputBuffer(
                                        decoderInputIndex, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM);
                                extractorDone = true;
                            } else {
                                decoder.queueInputBuffer(
                                        decoderInputIndex, 0, sampleSize, sampleTime, 0);
                                extractor.advance();
                            }
                        }
                    }
                }

                // 2. Poll decoder output and feed into encoder
                if (!decoderDone) {
                    int decoderOutputIndex = decoder.dequeueOutputBuffer(decoderOutputBufferInfo, TIMEOUT_US);
                    if (decoderOutputIndex >= 0) {
                        ByteBuffer decodedBuffer = decoder.getOutputBuffer(decoderOutputIndex);

                        if ((decoderOutputBufferInfo.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) {
                            decoderDone = true;
                        }

                        if (decodedBuffer != null && decoderOutputBufferInfo.size > 0) {
                            int encoderInputIndex = encoder.dequeueInputBuffer(TIMEOUT_US);
                            if (encoderInputIndex >= 0) {
                                ByteBuffer encoderInputBuffer = encoder.getInputBuffer(encoderInputIndex);
                                if (encoderInputBuffer != null) {
                                    encoderInputBuffer.clear();
                                    encoderInputBuffer.put(decodedBuffer);

                                    long pTime = decoderOutputBufferInfo.presentationTimeUs;
                                    if (presentationTimeBase < 0) {
                                        presentationTimeBase = pTime;
                                    }
                                    long adjustedTimeUs = Math.max(0, pTime - presentationTimeBase);

                                    int flags = decoderDone ? MediaCodec.BUFFER_FLAG_END_OF_STREAM : 0;
                                    encoder.queueInputBuffer(
                                            encoderInputIndex,
                                            0,
                                            decoderOutputBufferInfo.size,
                                            adjustedTimeUs,
                                            flags
                                    );
                                }
                            }
                        }

                        decoder.releaseOutputBuffer(decoderOutputIndex, false);
                    } else if (decoderOutputIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                        Log.d(TAG, "Decoder output format changed: " + decoder.getOutputFormat());
                    }
                }

                // 3. Poll encoder output and write to muxer
                int encoderOutputIndex = encoder.dequeueOutputBuffer(encoderOutputBufferInfo, TIMEOUT_US);
                if (encoderOutputIndex >= 0) {
                    ByteBuffer encodedBuffer = encoder.getOutputBuffer(encoderOutputIndex);

                    if ((encoderOutputBufferInfo.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) != 0) {
                        encoderOutputBufferInfo.size = 0;
                    }

                    if (encodedBuffer != null && encoderOutputBufferInfo.size > 0) {
                        if (!muxerStarted) {
                            throw new IllegalStateException("Muxer hasn't started but received audio data.");
                        }

                        encodedBuffer.position(encoderOutputBufferInfo.offset);
                        encodedBuffer.limit(encoderOutputBufferInfo.offset + encoderOutputBufferInfo.size);

                        muxer.writeSampleData(muxerAudioTrackIndex, encodedBuffer, encoderOutputBufferInfo);
                        totalBytesEncoded += encoderOutputBufferInfo.size;

                        if (listener != null && processDurationUs > 0) {
                            int pct = (int) Math.min(99, (encoderOutputBufferInfo.presentationTimeUs * 100) / processDurationUs);
                            listener.onProgress(pct, "Encoding audio with device hardware…", totalBytesEncoded);
                        }
                    }

                    encoder.releaseOutputBuffer(encoderOutputIndex, false);

                    if ((encoderOutputBufferInfo.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) {
                        encoderDone = true;
                    }
                } else if (encoderOutputIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    if (muxerStarted) {
                        throw new IllegalStateException("Encoder format changed twice.");
                    }
                    MediaFormat newFormat = encoder.getOutputFormat();
                    muxerAudioTrackIndex = muxer.addTrack(newFormat);
                    muxer.start();
                    muxerStarted = true;
                    Log.d(TAG, "Muxer started with track index: " + muxerAudioTrackIndex);
                }
            }

            if (isCancelled) {
                if (outputFile.exists()) outputFile.delete();
                throw new Exception("Operation cancelled by user.");
            }

            if (listener != null) {
                listener.onProgress(100, "Finalizing compressed file…", totalBytesEncoded);
            }

            TranscodeResult result = new TranscodeResult();
            result.outputFile = outputFile;
            result.durationUs = processDurationUs;
            result.outputBitrateKbps = outBitrate / 1000;
            result.outputSampleRate = outSampleRate;
            result.outputChannels = outChannels;
            result.outputSize = outputFile.length();
            return result;

        } finally {
            try { if (decoder != null) { decoder.stop(); decoder.release(); } } catch (Exception ignored) {}
            try { if (encoder != null) { encoder.stop(); encoder.release(); } } catch (Exception ignored) {}
            try { extractor.release(); } catch (Exception ignored) {}
            try {
                if (muxer != null) {
                    muxer.stop();
                    muxer.release();
                }
            } catch (Exception ignored) {}
        }
    }
}
