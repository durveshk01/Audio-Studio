package com.audiostudio.mobile;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.media.MediaCodecInfo;
import android.media.MediaCodecList;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.Log;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.UUID;

@CapacitorPlugin(name = "NativeAudioEngine")
public class NativeAudioEngine extends Plugin {
    private static final String TAG = "NativeAudioEngine";
    private AudioTranscoder currentTranscoder = null;

    @PluginMethod
    public void getEngineInfo(PluginCall call) {
        try {
            JSObject info = new JSObject();
            info.put("platform", "android");
            info.put("abi", Build.SUPPORTED_ABIS.length > 0 ? Build.SUPPORTED_ABIS[0] : "unknown");
            info.put("androidVersion", Build.VERSION.RELEASE);
            info.put("sdkInt", Build.VERSION.SDK_INT);
            info.put("deviceModel", Build.MANUFACTURER + " " + Build.MODEL);
            info.put("availableCores", Runtime.getRuntime().availableProcessors());
            info.put("maxMemoryMb", (int) (Runtime.getRuntime().maxMemory() / (1024 * 1024)));
            info.put("totalMemoryMb", (int) (Runtime.getRuntime().totalMemory() / (1024 * 1024)));
            info.put("freeMemoryMb", (int) (Runtime.getRuntime().freeMemory() / (1024 * 1024)));
            info.put("engineVersion", "2.0.0-hardware-accel");

            JSArray codecs = new JSArray();
            MediaCodecList list = new MediaCodecList(MediaCodecList.REGULAR_CODECS);
            for (MediaCodecInfo codecInfo : list.getCodecInfos()) {
                if (codecInfo.isEncoder()) {
                    for (String type : codecInfo.getSupportedTypes()) {
                        if (type.startsWith("audio/")) {
                            codecs.put(codecInfo.getName() + " (" + type + ")");
                        }
                    }
                }
            }
            info.put("audioEncoders", codecs);
            info.put("isNativeDevicePowered", true);
            call.resolve(info);
        } catch (Exception e) {
            Log.e(TAG, "Error getting engine info", e);
            call.reject("Could not get native engine info: " + e.getMessage());
        }
    }

    @PluginMethod
    public void extractMetadata(PluginCall call) {
        String inputPath = call.getString("path");
        String uriStr = call.getString("uri");

        if ((inputPath == null || inputPath.isEmpty()) && (uriStr == null || uriStr.isEmpty())) {
            call.reject("Missing file path or URI");
            return;
        }

        MediaMetadataRetriever retriever = new MediaMetadataRetriever();
        try {
            if (uriStr != null && !uriStr.isEmpty()) {
                retriever.setDataSource(getContext(), Uri.parse(uriStr));
            } else {
                retriever.setDataSource(inputPath);
            }

            JSObject meta = new JSObject();
            meta.put("title", retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_TITLE));
            meta.put("artist", retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ARTIST));
            meta.put("album", retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ALBUM));
            meta.put("albumArtist", retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ALBUMARTIST));
            meta.put("genre", retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_GENRE));
            meta.put("year", retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_YEAR));
            meta.put("date", retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DATE));
            meta.put("trackNumber", retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_CD_TRACK_NUMBER));
            meta.put("composer", retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_COMPOSER));
            meta.put("bitrate", retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_BITRATE));

            String durStr = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
            long durationMs = durStr != null ? Long.parseLong(durStr) : 0;
            meta.put("durationMs", durationMs);
            meta.put("durationSec", durationMs / 1000.0);

            byte[] pic = retriever.getEmbeddedPicture();
            if (pic != null && pic.length > 0) {
                meta.put("hasCoverArt", true);
                meta.put("coverArtBase64", "data:image/jpeg;base64," + Base64.encodeToString(pic, Base64.NO_WRAP));
                meta.put("coverArtSizeBytes", pic.length);
            } else {
                meta.put("hasCoverArt", false);
            }

            call.resolve(meta);
        } catch (Exception e) {
            Log.e(TAG, "Error extracting metadata", e);
            call.reject("Metadata extraction failed: " + e.getMessage());
        } finally {
            try { retriever.release(); } catch (Exception ignored) {}
        }
    }

    @PluginMethod
    public void processAudio(PluginCall call) {
        String inputPath = call.getString("path");
        String uriStr = call.getString("uri");
        int targetBitrateKbps = call.getInt("targetBitrateKbps", 128);
        int targetSampleRate = call.getInt("targetSampleRate", 44100);
        int targetChannels = call.getInt("targetChannels", 2);
        double trimStart = call.getDouble("trimStartSeconds", 0.0);
        double trimEnd = call.getDouble("trimEndSeconds", 0.0);
        String customOutputName = call.getString("outputName");

        if ((inputPath == null || inputPath.isEmpty()) && (uriStr == null || uriStr.isEmpty())) {
            call.reject("Missing audio input source");
            return;
        }

        Uri sourceUri;
        long inputSize = 0;
        try {
            if (uriStr != null && !uriStr.isEmpty()) {
                sourceUri = Uri.parse(uriStr);
            } else {
                File inputFile = new File(inputPath);
                inputSize = inputFile.length();
                sourceUri = Uri.fromFile(inputFile);
            }
        } catch (Exception e) {
            call.reject("Invalid input file: " + e.getMessage());
            return;
        }

        File outputDir = new File(getContext().getCacheDir(), "processed_audio");
        outputDir.mkdirs();

        String genName = customOutputName != null && !customOutputName.isEmpty()
                ? customOutputName
                : "audiostudio_" + UUID.randomUUID().toString().substring(0, 8) + ".m4a";
        if (!genName.endsWith(".m4a")) genName += ".m4a";
        final String finalFileName = genName;
        final long finalInputSize = inputSize;
        final Uri finalSourceUri = sourceUri;

        File outputFile = new File(outputDir, finalFileName);

        currentTranscoder = new AudioTranscoder();

        new Thread(() -> {
            try {
                AudioTranscoder.TranscodeResult result = currentTranscoder.transcode(
                        getContext(),
                        finalSourceUri,
                        outputFile,
                        targetBitrateKbps,
                        targetSampleRate,
                        targetChannels,
                        trimStart,
                        trimEnd,
                        (percent, stage, bytesProcessed) -> {
                            JSObject progressEvent = new JSObject();
                            progressEvent.put("percent", percent);
                            progressEvent.put("stage", stage);
                            progressEvent.put("bytesProcessed", bytesProcessed);
                            notifyListeners("transcodeProgress", progressEvent);
                        }
                );

                long originalBytes = finalInputSize > 0 ? finalInputSize : result.outputSize * 2;
                long outBytes = result.outputSize;
                double savedPercent = originalBytes > 0
                        ? Math.max(0, Math.round(((double) (originalBytes - outBytes) / originalBytes) * 100))
                        : 0;

                JSObject res = new JSObject();
                res.put("success", true);
                res.put("outputPath", result.outputFile.getAbsolutePath());
                res.put("fileName", finalFileName);
                res.put("outputSize", outBytes);
                res.put("originalSize", originalBytes);
                res.put("durationSec", result.durationUs / 1_000_000.0);
                res.put("outputBitrateKbps", result.outputBitrateKbps);
                res.put("outputSampleRate", result.outputSampleRate);
                res.put("outputChannels", result.outputChannels);
                res.put("savedPercent", savedPercent);
                res.put("contentUri", FileProvider.getUriForFile(
                        getContext(),
                        getContext().getPackageName() + ".fileprovider",
                        result.outputFile
                ).toString());

                call.resolve(res);
            } catch (Exception e) {
                Log.e(TAG, "Native transcode failed", e);
                call.reject("Device transcode failed: " + e.getMessage());
            } finally {
                currentTranscoder = null;
            }
        }).start();
    }

    @PluginMethod
    public void cancelProcessing(PluginCall call) {
        if (currentTranscoder != null) {
            currentTranscoder.cancel();
            call.resolve();
        } else {
            call.resolve();
        }
    }

    @PluginMethod
    public void saveToDownloads(PluginCall call) {
        String filePath = call.getString("path");
        String displayName = call.getString("displayName");

        if (filePath == null || filePath.isEmpty()) {
            call.reject("Missing file path");
            return;
        }

        File srcFile = new File(filePath);
        if (!srcFile.exists()) {
            call.reject("Source file does not exist");
            return;
        }

        if (displayName == null || displayName.isEmpty()) {
            displayName = srcFile.getName();
        }

        try {
            ContentResolver resolver = getContext().getContentResolver();
            Uri targetUri;

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues values = new ContentValues();
                values.put(MediaStore.MediaColumns.DISPLAY_NAME, displayName);
                values.put(MediaStore.MediaColumns.MIME_TYPE, displayName.endsWith(".mp3") ? "audio/mpeg" : "audio/mp4");
                values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/AudioStudio");
                values.put(MediaStore.MediaColumns.IS_PENDING, 1);

                targetUri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (targetUri == null) throw new Exception("Failed to create download entry");

                try (InputStream in = new FileInputStream(srcFile);
                     OutputStream out = resolver.openOutputStream(targetUri)) {
                    byte[] buffer = new byte[8192];
                    int len;
                    while ((len = in.read(buffer)) > 0) {
                        out.write(buffer, 0, len);
                    }
                }

                values.clear();
                values.put(MediaStore.MediaColumns.IS_PENDING, 0);
                resolver.update(targetUri, values, null, null);
            } else {
                File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "AudioStudio");
                dir.mkdirs();
                File dest = new File(dir, displayName);
                try (InputStream in = new FileInputStream(srcFile);
                     OutputStream out = new FileOutputStream(dest)) {
                    byte[] buffer = new byte[8192];
                    int len;
                    while ((len = in.read(buffer)) > 0) {
                        out.write(buffer, 0, len);
                    }
                }
                targetUri = Uri.fromFile(dest);
            }

            JSObject res = new JSObject();
            res.put("success", true);
            res.put("uri", targetUri.toString());
            res.put("savedName", displayName);
            call.resolve(res);
        } catch (Exception e) {
            Log.e(TAG, "Error saving to downloads", e);
            call.reject("Save to Downloads failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void shareFile(PluginCall call) {
        String filePath = call.getString("path");
        String title = call.getString("title", "Share Audio");

        if (filePath == null || filePath.isEmpty()) {
            call.reject("Missing file path");
            return;
        }

        File file = new File(filePath);
        if (!file.exists()) {
            call.reject("File does not exist: " + filePath);
            return;
        }

        try {
            Uri contentUri = FileProvider.getUriForFile(
                    getContext(),
                    getContext().getPackageName() + ".fileprovider",
                    file
            );

            Intent shareIntent = new Intent(Intent.ACTION_SEND);
            shareIntent.setType(filePath.endsWith(".mp3") ? "audio/mpeg" : "audio/mp4");
            shareIntent.putExtra(Intent.EXTRA_STREAM, contentUri);
            shareIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

            Intent chooser = Intent.createChooser(shareIntent, title);
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(chooser);

            call.resolve();
        } catch (Exception e) {
            Log.e(TAG, "Share failed", e);
            call.reject("Share failed: " + e.getMessage());
        }
    }
}
