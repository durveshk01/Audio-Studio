package com.audiostudio.mobile;

import android.app.Activity;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.media.MediaCodecInfo;
import android.media.MediaCodecList;
import android.media.MediaFormat;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;

import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

@CapacitorPlugin(name = "NativeAudioEngine")
public final class NativeAudioEngine extends Plugin {
    private final AtomicReference<AudioTranscoder> current = new AtomicReference<>();
    private final Map<String, File> imports = new ConcurrentHashMap<>();
    private final ExecutorService encoderExecutor = Executors.newSingleThreadExecutor();
    private final ExecutorService ioExecutor = new ThreadPoolExecutor(1, 1, 0, TimeUnit.MILLISECONDS, new ArrayBlockingQueue<>(8));

    private interface IoWork { void run() throws Exception; }
    private void io(PluginCall call, IoWork work) {
        try { ioExecutor.execute(() -> { try { work.run(); } catch (Exception e) { call.reject(e.getMessage() == null ? "Device file operation failed." : e.getMessage()); } }); }
        catch (RuntimeException e) { call.reject("Device storage is busy. Try again shortly."); }
    }

    private File temporaryDir() { return new File(getContext().getCacheDir(), "audio-studio-temp"); }
    private File exportsDir() { return new File(getContext().getFilesDir(), "audio-exports"); }
    private static String safeName(String value) {
        String name = (value == null ? "AudioTrack" : value).replaceAll("[\\x00-\\x1f/\\\\:*?\"<>|]", "_").replaceAll("[. ]+$", "").trim();
        if (name.isEmpty()) name = "AudioTrack";
        int dot = name.lastIndexOf('.');
        String extension = dot >= 0 && name.substring(dot).matches("(?i)\\.[a-z0-9]{1,10}") ? name.substring(dot) : "";
        String base = extension.isEmpty() ? name : name.substring(0, dot);
        if (base.isEmpty()) base = "AudioTrack";
        int limit = 180 - extension.getBytes(StandardCharsets.UTF_8).length;
        int end = 0, bytes = 0;
        while (end < base.length()) {
            int next = end + Character.charCount(base.codePointAt(end));
            int size = base.substring(end, next).getBytes(StandardCharsets.UTF_8).length;
            if (bytes + size > limit) break;
            bytes += size; end = next;
        }
        return base.substring(0, end) + extension;
    }

    private File ownedPath(String value, boolean mustExist) throws IOException {
        if (value == null || value.isEmpty()) throw new IOException("Missing device file.");
        File file = new File(value).getCanonicalFile();
        String name = file.getPath();
        boolean allowed = name.startsWith(temporaryDir().getCanonicalPath() + File.separator)
                || name.startsWith(exportsDir().getCanonicalPath() + File.separator)
                || name.startsWith(new File(getContext().getCacheDir(), "processed_audio").getCanonicalPath() + File.separator);
        if (!allowed || (mustExist && !file.isFile())) throw new IOException("The selected app-owned audio file is unavailable.");
        return file;
    }

    @PluginMethod
    public void importFileChunk(PluginCall call) {
        io(call, () -> {
            String session = call.getString("sessionId");
            String encoded = call.getString("base64", "");
            if (encoded.length() > 1400000) throw new IOException("Import chunks must be at most 1 MB.");
            File file;
            if (session == null) {
                if (imports.size() >= 2) throw new IOException("Another file import is running.");
                if (!temporaryDir().isDirectory() && !temporaryDir().mkdirs()) throw new IOException("Could not create temporary storage.");
                session = UUID.randomUUID().toString();
                file = new File(temporaryDir(), session + "-" + safeName(call.getString("fileName")));
                imports.put(session, file);
            } else {
                file = imports.get(session);
                if (file == null) throw new IOException("The file import session expired.");
            }
            try {
                byte[] bytes = Base64.decode(encoded, Base64.NO_WRAP);
                if (bytes.length == 0 || bytes.length > 1024 * 1024 || file.length() + bytes.length > 200L * 1024 * 1024) throw new IOException("Device file export exceeds the supported size.");
                try (OutputStream output = new FileOutputStream(file, true)) { output.write(bytes); }
                if (Boolean.TRUE.equals(call.getBoolean("complete", false))) imports.remove(session);
                JSObject result = new JSObject(); result.put("sessionId", session); result.put("path", file.getAbsolutePath());
                call.resolve(result);
            } catch (Exception error) { imports.remove(session); file.delete(); throw error; }
        });
    }

    @PluginMethod
    public void removeTemporaryFile(PluginCall call) {
        io(call, () -> {
            File file = ownedPath(call.getString("path"), false);
            if (!file.getCanonicalPath().startsWith(temporaryDir().getCanonicalPath() + File.separator)) throw new IOException("Only temporary imports can be removed by this operation.");
            imports.values().remove(file);
            if (file.exists() && !file.delete()) throw new IOException("Could not remove the temporary file.");
            call.resolve();
        });
    }

    @PluginMethod
    public void deleteNativeExport(PluginCall call) {
        io(call, () -> {
            File file = ownedPath(call.getString("path"), false);
            if (!file.getCanonicalPath().startsWith(exportsDir().getCanonicalPath() + File.separator)) throw new IOException("Only app-created exports can be removed.");
            if (file.exists() && !file.delete()) throw new IOException("Could not remove the audio export.");
            call.resolve();
        });
    }

    @PluginMethod
    public void getEngineInfo(PluginCall call) {
        io(call, () -> {
            MediaFormat format = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, 44100, 2);
            format.setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC);
            format.setInteger(MediaFormat.KEY_BIT_RATE, 192000);
            MediaCodecList list = new MediaCodecList(MediaCodecList.REGULAR_CODECS);
            String name = list.findEncoderForFormat(format);
            boolean hardware = false;
            JSArray codecs = new JSArray();
            for (MediaCodecInfo info : list.getCodecInfos()) if (info.isEncoder()) {
                for (String type : info.getSupportedTypes()) if (type.startsWith("audio/")) codecs.put(info.getName() + " (" + type + ")");
                if (info.getName().equals(name) && Build.VERSION.SDK_INT >= 29) hardware = info.isHardwareAccelerated();
            }
            JSObject info = new JSObject();
            info.put("platform", "android"); info.put("abi", Build.SUPPORTED_ABIS.length > 0 ? Build.SUPPORTED_ABIS[0] : "unknown");
            info.put("availableCores", Runtime.getRuntime().availableProcessors());
            info.put("freeMemoryMb", Runtime.getRuntime().freeMemory() / (1024 * 1024));
            info.put("aacAvailable", name != null); info.put("aacEncoder", name); info.put("hardwareAcceleration", hardware);
            info.put("audioEncoders", codecs); info.put("isNativeDevicePowered", true);
            call.resolve(info);
        });
    }

    @PluginMethod
    public void extractMetadata(PluginCall call) {
        io(call, () -> {
            File file = ownedPath(call.getString("path"), true);
            MediaMetadataRetriever retriever = new MediaMetadataRetriever();
            try {
                retriever.setDataSource(file.getAbsolutePath());
                JSObject result = new JSObject();
                result.put("title", retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_TITLE));
                result.put("artist", retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ARTIST));
                result.put("album", retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ALBUM));
                result.put("albumArtist", retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ALBUMARTIST));
                result.put("genre", retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_GENRE));
                result.put("year", retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_YEAR));
                result.put("trackNumber", retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_CD_TRACK_NUMBER));
                result.put("composer", retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_COMPOSER));
                result.put("bitrate", retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_BITRATE));
                String duration = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
                result.put("durationSec", duration == null ? 0 : Long.parseLong(duration) / 1000.0);
                byte[] picture = retriever.getEmbeddedPicture();
                result.put("hasCoverArt", picture != null);
                if (picture != null && picture.length > 0 && picture.length <= 8 * 1024 * 1024) result.put("coverArtBase64", "data:image/" + (picture[0] == (byte) 137 ? "png" : "jpeg") + ";base64," + Base64.encodeToString(picture, Base64.NO_WRAP));
                call.resolve(result);
            } finally { retriever.release(); }
        });
    }

    @PluginMethod
    public void processAudio(PluginCall call) {
        AudioTranscoder transcoder = new AudioTranscoder();
        if (!current.compareAndSet(null, transcoder)) { call.reject("Another device audio operation is running."); return; }
        try {
            File source = ownedPath(call.getString("path"), true);
            String display = safeName(call.getString("outputName", "AudioTrack.m4a"));
            if (!display.toLowerCase(Locale.ROOT).endsWith(".m4a")) display += ".m4a";
            final String fileName = display;
            File output = new File(exportsDir(), UUID.randomUUID() + "-" + fileName);
            encoderExecutor.execute(() -> {
                try {
                    AudioTranscoder.TranscodeResult result = transcoder.transcode(getContext(), Uri.fromFile(source), output,
                            call.getInt("targetBitrateKbps", 192), call.getInt("targetSampleRate", 44100), call.getInt("targetChannels", 2),
                            call.getDouble("trimStartSeconds", 0.0), call.getDouble("trimEndSeconds", 0.0),
                            (percent, stage, bytes) -> { JSObject event = new JSObject(); event.put("percent", percent); event.put("stage", stage); event.put("bytesProcessed", bytes); notifyListeners("transcodeProgress", event); });
                    JSObject response = new JSObject();
                    response.put("outputPath", output.getAbsolutePath()); response.put("fileName", fileName);
                    response.put("outputSize", result.outputSize); response.put("originalSize", source.length());
                    response.put("durationSec", result.durationUs / 1000000.0); response.put("outputBitrateKbps", result.outputBitrateKbps);
                    response.put("outputSampleRate", result.outputSampleRate); response.put("outputChannels", result.outputChannels);
                    response.put("contentUri", FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", output).toString());
                    current.compareAndSet(transcoder, null);
                    call.resolve(response);
                } catch (Exception error) { call.reject("Device conversion failed: " + error.getMessage()); }
                finally { current.compareAndSet(transcoder, null); }
            });
        } catch (Exception error) { current.compareAndSet(transcoder, null); call.reject(error.getMessage()); }
    }

    @PluginMethod
    public void cancelProcessing(PluginCall call) { AudioTranscoder task = current.get(); if (task != null) task.cancel(); call.resolve(); }

    private static String mime(String name) {
        String lower = name.toLowerCase(Locale.ROOT);
        if (lower.endsWith(".mp3")) return "audio/mpeg";
        if (lower.endsWith(".wav")) return "audio/wav";
        if (lower.endsWith(".zip")) return "application/zip";
        if (lower.endsWith(".flac")) return "audio/flac";
        if (lower.endsWith(".ogg")) return "audio/ogg";
        if (lower.endsWith(".aac")) return "audio/aac";
        return "audio/mp4";
    }

    private void copy(File source, Uri uri) throws IOException {
        try (InputStream input = new FileInputStream(source); OutputStream output = getContext().getContentResolver().openOutputStream(uri)) {
            if (output == null) throw new IOException("The selected destination is unavailable.");
            byte[] bytes = new byte[65536]; int count;
            while ((count = input.read(bytes)) != -1) output.write(bytes, 0, count);
        }
    }

    @PluginMethod
    public void saveToDownloads(PluginCall call) {
        if (Build.VERSION.SDK_INT < 29) {
            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT); intent.addCategory(Intent.CATEGORY_OPENABLE);
            String name = safeName(call.getString("displayName"));
            intent.setType(mime(name)); intent.putExtra(Intent.EXTRA_TITLE, name);
            startActivityForResult(call, intent, "saveDocumentResult"); return;
        }
        io(call, () -> {
            File source = ownedPath(call.getString("path"), true);
            String name = safeName(call.getString("displayName", source.getName()));
            ContentResolver resolver = getContext().getContentResolver();
            ContentValues values = new ContentValues(); values.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
            values.put(MediaStore.MediaColumns.MIME_TYPE, mime(name)); values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/AudioStudio");
            values.put(MediaStore.MediaColumns.IS_PENDING, 1);
            Uri target = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (target == null) throw new IOException("Could not create the download entry.");
            try {
                copy(source, target); values.clear(); values.put(MediaStore.MediaColumns.IS_PENDING, 0); resolver.update(target, values, null, null);
                JSObject result = new JSObject(); result.put("uri", target.toString()); call.resolve(result);
            } catch (Exception error) { resolver.delete(target, null, null); throw error; }
        });
    }

    @ActivityCallback
    private void saveDocumentResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Uri uri = result.getData() == null ? null : result.getData().getData();
        if (result.getResultCode() != Activity.RESULT_OK || uri == null) { call.reject("Save cancelled."); return; }
        io(call, () -> { copy(ownedPath(call.getString("path"), true), uri); JSObject response = new JSObject(); response.put("uri", uri.toString()); call.resolve(response); });
    }

    @PluginMethod
    public void shareFile(PluginCall call) {
        try {
            File file = ownedPath(call.getString("path"), true);
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
            Intent intent = new Intent(Intent.ACTION_SEND); intent.setType(mime(file.getName()));
            intent.putExtra(Intent.EXTRA_STREAM, uri); intent.setClipData(ClipData.newRawUri("Audio Studio export", uri));
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().runOnUiThread(() -> {
                try { getActivity().startActivity(Intent.createChooser(intent, call.getString("title", "Share Audio"))); call.resolve(); }
                catch (RuntimeException e) { call.reject("No application can share this file."); }
            });
        } catch (Exception error) { call.reject(error.getMessage()); }
    }

    @PluginMethod
    public void clearTemporaryCache(PluginCall call) {
        io(call, () -> {
            if (current.get() != null || !imports.isEmpty()) throw new IOException("Wait for audio processing and file imports to finish.");
            long removed = 0;
            File[] files = temporaryDir().listFiles();
            if (files != null) for (File file : files) if (file.isFile()) {
                long size = file.length(); if (!file.delete()) throw new IOException("A temporary file could not be removed."); removed += size;
            }
            JSObject result = new JSObject(); result.put("bytesRemoved", removed); call.resolve(result);
        });
    }

    @Override
    protected void handleOnDestroy() {
        AudioTranscoder task = current.get(); if (task != null) task.cancel();
        encoderExecutor.shutdownNow(); ioExecutor.shutdownNow();
        super.handleOnDestroy();
    }
}
