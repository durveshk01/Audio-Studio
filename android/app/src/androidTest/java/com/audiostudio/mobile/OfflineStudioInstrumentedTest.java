package com.audiostudio.mobile;

import static org.junit.Assert.*;
import android.content.Context;
import android.database.Cursor;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.os.SystemClock;
import android.provider.MediaStore;
import android.util.Base64;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.io.InputStream;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Exercises the actual packaged React UI and native bridge, including non-debuggable release APKs. */
@RunWith(AndroidJUnit4.class)
public class OfflineStudioInstrumentedTest {
    private ActivityScenario<MainActivity> scenario;
    private Context context() { return InstrumentationRegistry.getInstrumentation().getTargetContext(); }

    @Before public void launch() throws Exception {
        scenario = ActivityScenario.launch(MainActivity.class);
        await("document.querySelector('.landing-container') !== null", "Bundled app did not start offline");
    }

    @After public void close() { if (scenario != null) scenario.close(); }

    private Object js(String expression) throws Exception {
        CountDownLatch latch = new CountDownLatch(1);
        AtomicReference<String> result = new AtomicReference<>();
        scenario.onActivity(activity -> activity.getBridge().getWebView().evaluateJavascript(
            "(()=>{try{return JSON.stringify({value:(" + expression + ")})}catch(e){return JSON.stringify({error:String(e)})}})()",
            value -> { result.set(value); latch.countDown(); }));
        assertTrue("WebView JavaScript timed out", latch.await(10, TimeUnit.SECONDS));
        Object decoded = new JSONTokener(result.get()).nextValue();
        assertTrue("WebView returned no result: " + result.get(), decoded instanceof String);
        JSONObject response = new JSONObject((String) decoded);
        assertFalse(response.optString("error"), response.has("error"));
        return response.opt("value");
    }

    private void await(String expression, String message) throws Exception {
        long deadline = SystemClock.elapsedRealtime() + 45000;
        while (SystemClock.elapsedRealtime() < deadline) {
            if (Boolean.TRUE.equals(js(expression))) return;
            SystemClock.sleep(150);
        }
        fail(message + ": " + js("document.body.innerText.slice(-2000)"));
    }

    private Object async(String expression) throws Exception {
        js("(()=>{window.__studioTestResult=null;Promise.resolve(" + expression + ").then(value=>{window.__studioTestResult={value}}).catch(error=>{window.__studioTestResult={error:String(error)}});return true})()");
        await("window.__studioTestResult !== null", "Async device operation timed out");
        JSONObject result = (JSONObject) js("window.__studioTestResult");
        assertFalse(result.optString("error"), result.has("error"));
        return result.opt("value");
    }

    private void navigate(String tab, String selector) throws Exception {
        js("(()=>{location.hash=" + JSONObject.quote("/" + tab) + ";return true})()");
        await("document.querySelector(" + JSONObject.quote(selector) + ") !== null", "Workspace did not load: " + tab);
    }

    private String fixtureBase64(String name) throws Exception {
        try (InputStream input = InstrumentationRegistry.getInstrumentation().getContext().getAssets().open(name)) {
            java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream();
            byte[] buffer = new byte[65536]; int count;
            while ((count = input.read(buffer)) >= 0) bytes.write(buffer, 0, count);
            return Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP);
        }
    }

    private void selectFile(String label, String fixture, String name, String mime) throws Exception {
        String selector = "input[aria-label='" + label + "']";
        String encoded = fixtureBase64(fixture);
        // Keep individual evaluateJavascript calls comfortably below Android's Binder size limit.
        js("(()=>{window.__studioTestFileChunks=[];return true})()");
        try {
            for (int offset = 0; offset < encoded.length(); offset += 16384) {
                js("(()=>{window.__studioTestFileChunks.push(Uint8Array.from(atob(" + JSONObject.quote(encoded.substring(offset, Math.min(encoded.length(), offset + 16384)))
                    + "),c=>c.charCodeAt(0)));return true})()");
            }
            String script = "(()=>{const input=document.querySelector(" + JSONObject.quote(selector) + ");const data=new DataTransfer();data.items.add(new File(window.__studioTestFileChunks,"
                + JSONObject.quote(name) + ",{type:" + JSONObject.quote(mime) + "}));input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true}));return true})()";
            assertEquals(Boolean.TRUE, js(script));
        } finally { js("delete window.__studioTestFileChunks"); }
    }

    private void value(String id, String value) throws Exception {
        String script = "(()=>{const input=document.getElementById(" + JSONObject.quote(id) + ");const setter=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input),'value').set;setter.call(input,"
            + JSONObject.quote(value) + ");input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));return true})()";
        assertEquals(Boolean.TRUE, js(script));
    }

    private void click(String text) throws Exception {
        assertEquals(Boolean.TRUE, js("(()=>{const button=Array.from(document.querySelectorAll('button')).find(b=>!b.closest('[hidden]')&&b.textContent.trim()==="
            + JSONObject.quote(text) + ");if(!button||button.disabled)throw Error('Button unavailable: '+" + JSONObject.quote(text) + ");button.click();return true})()"));
    }

    private JSONArray tracks() throws Exception {
        return (JSONArray) async("new Promise((resolve,reject)=>{const open=indexedDB.open('AudioStudioDB');open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result;const request=db.transaction('tracks').objectStore('tracks').getAll();request.onerror=()=>reject(request.error);request.onsuccess=()=>{resolve(request.result.map(t=>({id:t.id,title:t.title,format:t.format,nativePath:t.nativePath,bytes:t.blob?.size,favorite:t.favorite})));db.close()}}})");
    }

    private JSONObject track(String title) throws Exception {
        long deadline = SystemClock.elapsedRealtime() + 15000;
        while (SystemClock.elapsedRealtime() < deadline) {
            JSONArray tracks = tracks();
            for (int i = 0; i < tracks.length(); i++) if (title.equals(tracks.getJSONObject(i).optString("title"))) return tracks.getJSONObject(i);
            SystemClock.sleep(150);
        }
        throw new AssertionError("Audio was not committed to the library: " + title);
    }

    private void compress(String format, String name) throws Exception {
        navigate("compressor", ".compressor-view-container");
        String label = Boolean.TRUE.equals(js("document.querySelector('.queue-card') !== null")) ? "More audio files for compression" : "Audio files for compression";
        selectFile(label, "native-tone.wav", name + ".wav", "audio/wav");
        await("document.getElementById('output-format') !== null", "Audio input did not reach the queue");
        // Let native capability detection and persisted preferences settle before choosing an encoder.
        await("!document.querySelector('#output-format option[value=m4a]').disabled", "Native AAC encoder unavailable");
        value("output-format", format);
        click(format.equals("wav") ? "Convert Audio" : "Compress Audio");
        await("document.querySelector('.queue-card.processing') === null && document.querySelector('.queue-card.completed') !== null", "Local encoding failed");
        assertEquals(0, ((Number) js("document.querySelectorAll('.queue-card.failed').length")).intValue());
        track(name);
    }

    @Test public void nativeAacExportPersistsPlaysAndSurvivesCacheMaintenance() throws Exception {
        String name = "QA native persistence " + System.currentTimeMillis();
        compress("m4a", name);
        JSONObject saved = track(name);
        File file = new File(saved.getString("nativePath"));
        assertTrue("Native AAC was not stored persistently", file.isFile());
        assertTrue(file.getCanonicalPath().startsWith(new File(context().getFilesDir(), "audio-exports").getCanonicalPath()));
        navigate("settings", ".settings-view-container");
        assertEquals(Boolean.FALSE, js("document.getElementById('backend-url') !== null"));
        click("Clear Temporary Cache");
        await("document.body.innerText.includes('Temporary cache cleared')", "Cache cleanup failed");
        assertTrue("Cache cleanup removed a saved export", file.isFile());
        scenario.close(); scenario = ActivityScenario.launch(MainActivity.class);
        await("document.querySelector('.landing-container') !== null", "Offline app restart failed");
        assertEquals("Saved library entry changed after restart", saved.getString("id"), track(name).getString("id"));
        navigate("library", ".library-view-container");
        await("Array.from(document.querySelectorAll('.track-title')).some(e=>e.textContent===" + JSONObject.quote(name) + ")", "Library did not survive app restart");
        js("(()=>{document.querySelector('button[aria-label=" + JSONObject.quote("Listen to " + name) + "]').click();return true})()");
        await("document.querySelector('.floating-player-bar audio')?.readyState >= 2", "Persistent native audio cannot be played");
        await("document.querySelector('.floating-player-bar audio')?.currentTime > 0.05", "Native audio playback did not advance");
        js("(()=>{document.querySelector('.floating-player-bar audio').pause();document.querySelector('button[aria-label=" + JSONObject.quote("Save " + name) + "]').click();return true})()");
        await("document.body.innerText.includes('Audio saved.')", "System Downloads export failed offline");
        assertNotNull("Audio was not exported to system Downloads", download(name + ".m4a"));
    }

    @Test public void localWorkerMp3AndWavEncodingWorkInsideReleaseWebView() throws Exception {
        for (String format : new String[] {"mp3", "wav"}) {
            String name = "QA worker " + format + " " + System.currentTimeMillis();
            compress(format, name);
            JSONObject track = track(name);
            assertTrue("Local worker did not persist encoded bytes", track.getInt("bytes") > 1000);
        }
    }

    private Uri download(String name) {
        Uri collection = MediaStore.Downloads.EXTERNAL_CONTENT_URI;
        try (Cursor cursor = context().getContentResolver().query(collection, new String[] {MediaStore.MediaColumns._ID}, MediaStore.MediaColumns.DISPLAY_NAME + "=?", new String[] {name}, null)) {
            return cursor != null && cursor.moveToFirst() ? android.content.ContentUris.withAppendedId(collection, cursor.getLong(0)) : null;
        }
    }

    @Test public void metadataAndLocalCoverAreEmbeddedWithoutCloudRequests() throws Exception {
        String title = "QA offline tags " + System.currentTimeMillis();
        navigate("metatune", ".metatune-view-container");
        selectFile("Audio file for metadata editing", "native-tone.m4a", "QA metadata.m4a", "audio/mp4");
        await("document.getElementById('meta-title') !== null && !document.querySelector('.metadata-form-panel').disabled", "Metadata could not be read");
        value("meta-title", title); value("meta-artist", "Local Artist"); value("meta-track", "2/5"); value("meta-year", "2026");
        assertEquals(Boolean.FALSE, js("document.getElementById('ai-cover-prompt') !== null"));
        click("Create Local Cover");
        await("document.querySelector('.cover-img') !== null && !document.querySelector('.metadata-form-panel').disabled", "Local cover designer failed");
        click("Save & Export Audio");
        await("document.body.innerText.includes('Tagged audio saved.')", "Metadata export failed offline");
        Uri uri = download("Local Artist - " + title + ".m4a");
        assertNotNull("Tagged audio was not saved to Downloads", uri);
        MediaMetadataRetriever retriever = new MediaMetadataRetriever();
        try {
            retriever.setDataSource(context(), uri);
            assertEquals(title, retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_TITLE));
            assertEquals("Local Artist", retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ARTIST));
            assertNotNull("Local PNG cover was not embedded", retriever.getEmbeddedPicture());
            assertTrue(retriever.getEmbeddedPicture().length > 1000);
        } finally { retriever.release(); }
    }

    @Test public void analysisAndTrimProduceRealOfflineAudio() throws Exception {
        String name = "QA analysis " + System.currentTimeMillis();
        navigate("tools", ".audio-tools-view");
        selectFile("Audio file for analysis", "native-tone.wav", name + ".wav", "audio/wav");
        await("document.getElementById('trim-start') !== null", "Local analysis failed");
        assertEquals(Boolean.TRUE, js("document.body.innerText.includes('FFT Frequency Energy')"));
        value("trim-start", "0.25"); value("trim-end", "1.25");
        click("Export Trimmed Region");
        await("document.body.innerText.includes('Trimmed audio saved.')", "Offline trim export failed");
        Uri uri = download(name + "_trimmed.wav");
        assertNotNull("Trimmed PCM was not exported", uri);
        MediaMetadataRetriever retriever = new MediaMetadataRetriever();
        try {
            retriever.setDataSource(context(), uri);
            assertEquals(1000, Long.parseLong(retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)), 25);
        } finally { retriever.release(); }
    }
}
