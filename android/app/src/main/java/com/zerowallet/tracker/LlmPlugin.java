package com.zerowallet.tracker;

import android.os.Environment;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.mediapipe.tasks.genai.llminference.LlmInference;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Capacitor plugin wrapping MediaPipe LlmInference for on-device AI.
 * Uses Qwen 2.5 0.5B model in .task format.
 */
@CapacitorPlugin(name = "LlmPlugin")
public class LlmPlugin extends Plugin {
    private static final String TAG = "LlmPlugin";

    private static final String MODEL_URL =
            "https://d3q489kjw0f759.cloudfront.net/Qwen2.5-1.5B-Instruct_multi-prefill-seq_q8_ekv4096.task";
    private static final String MODEL_FILE_NAME = "qwen2.5-1.5b-instruct.task";
    private static final int MAX_TOKENS = 1280;

    private LlmInference llmInference = null;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private volatile boolean isGenerating = false;

    // ─── Model status ───────────────────────────────────────────────────

    @PluginMethod()
    public void getModelStatus(PluginCall call) {
        JSObject result = new JSObject();
        File modelFile = getModelFile();
        boolean downloaded = modelFile.exists() && modelFile.length() > 100_000_000;
        boolean initialized = llmInference != null;

        result.put("downloaded", downloaded);
        result.put("initialized", initialized);
        result.put("generating", isGenerating);
        if (downloaded) {
            result.put("modelSizeMB", modelFile.length() / (1024 * 1024));
        }
        call.resolve(result);
    }

    // ─── Download ───────────────────────────────────────────────────────

    @PluginMethod()
    public void downloadModel(PluginCall call) {
        File modelFile = getModelFile();
        if (modelFile.exists() && modelFile.length() > 100_000_000) {
            JSObject result = new JSObject();
            result.put("success", true);
            result.put("message", "Model already downloaded");
            call.resolve(result);
            return;
        }

        call.setKeepAlive(true);

        executor.execute(() -> {
            try {
                Log.d(TAG, "Starting model download from " + MODEL_URL);
                notifyProgress("download", 0, "Connecting...");

                URL url = new URL(MODEL_URL);
                HttpURLConnection connection = (HttpURLConnection) url.openConnection();
                connection.setRequestMethod("GET");
                connection.setConnectTimeout(30_000);
                connection.setReadTimeout(120_000); // 2 min per read op for slow connections
                connection.setInstanceFollowRedirects(true);
                connection.setRequestProperty("User-Agent", "okhttp/4.12.0");
                connection.setRequestProperty("Accept", "*/*");
                connection.connect();

                int responseCode = connection.getResponseCode();
                Log.d(TAG, "Download response: HTTP " + responseCode + " url=" + MODEL_URL);
                if (responseCode != HttpURLConnection.HTTP_OK) {
                    call.reject("Download failed: HTTP " + responseCode + " — url: " + MODEL_URL);
                    return;
                }

                long totalBytes = connection.getContentLengthLong();
                Log.d(TAG, "Model size: " + (totalBytes / 1024 / 1024) + " MB");

                File tempFile = new File(modelFile.getParent(), MODEL_FILE_NAME + ".tmp");
                InputStream input = connection.getInputStream();
                FileOutputStream output = new FileOutputStream(tempFile);

                byte[] buffer = new byte[65536];
                long downloadedBytes = 0;
                int bytesRead;
                long lastProgressTime = 0;

                while ((bytesRead = input.read(buffer)) != -1) {
                    output.write(buffer, 0, bytesRead);
                    downloadedBytes += bytesRead;

                    long now = System.currentTimeMillis();
                    if (now - lastProgressTime > 500 || downloadedBytes == totalBytes) {
                        lastProgressTime = now;
                        double progress = totalBytes > 0
                                ? (double) downloadedBytes / totalBytes * 100 : 0;
                        notifyProgress("download", progress,
                                String.format("%.0f / %.0f MB",
                                        downloadedBytes / 1048576.0,
                                        totalBytes / 1048576.0));
                    }
                }

                output.close();
                input.close();
                connection.disconnect();

                if (tempFile.renameTo(modelFile)) {
                    Log.d(TAG, "Download complete: " + modelFile.getAbsolutePath());
                    notifyProgress("done", 100, "Download complete");
                    JSObject result = new JSObject();
                    result.put("success", true);
                    call.resolve(result);
                } else {
                    call.reject("Failed to save model file");
                }
            } catch (Exception e) {
                Log.e(TAG, "Download error", e);
                call.reject("Download failed: " + e.getMessage());
            }
        });
    }

    // ─── Initialize ─────────────────────────────────────────────────────

    @PluginMethod()
    public void initialize(PluginCall call) {
        File modelFile = getModelFile();
        if (!modelFile.exists()) {
            call.reject("Model not downloaded. Call downloadModel() first.");
            return;
        }

        if (llmInference != null) {
            JSObject result = new JSObject();
            result.put("success", true);
            result.put("message", "Already initialized");
            call.resolve(result);
            return;
        }

        executor.execute(() -> {
            try {
                Log.d(TAG, "Initializing LlmInference: " + modelFile.getAbsolutePath());
                long startMs = System.currentTimeMillis();

                LlmInference.LlmInferenceOptions options =
                        LlmInference.LlmInferenceOptions.builder()
                                .setModelPath(modelFile.getAbsolutePath())
                                .setMaxTokens(MAX_TOKENS)
                                .build();

                llmInference = LlmInference.createFromOptions(
                        getContext(), options);

                long elapsed = System.currentTimeMillis() - startMs;
                Log.d(TAG, "LlmInference initialized in " + elapsed + "ms");

                JSObject result = new JSObject();
                result.put("success", true);
                call.resolve(result);
            } catch (Exception e) {
                Log.e(TAG, "Init error", e);
                call.reject("Failed to initialize model: " + e.getMessage());
            }
        });
    }

    // ─── Generate ───────────────────────────────────────────────────────

    @PluginMethod()
    public void generate(PluginCall call) {
        String prompt = call.getString("prompt", "");
        if (prompt.isEmpty()) {
            call.reject("Prompt cannot be empty");
            return;
        }

        if (llmInference == null) {
            call.reject("Model not initialized. Call initialize() first.");
            return;
        }

        if (isGenerating) {
            call.reject("Already generating. Wait or abort first.");
            return;
        }

        isGenerating = true;

        executor.execute(() -> {
            try {
                Log.d(TAG, "Generating (" + prompt.length() + " chars)");
                long startMs = System.currentTimeMillis();

                // Use synchronous generateResponse on background thread.
                // Token streaming will be added once we confirm the correct async API.
                String response = llmInference.generateResponse(prompt);

                long elapsed = System.currentTimeMillis() - startMs;
                isGenerating = false;
                Log.d(TAG, "Generated " + (response != null ? response.length() : 0)
                        + " chars in " + elapsed + "ms");

                // Send the full response as a single token event
                if (response != null && !response.isEmpty()) {
                    JSObject tokenEvent = new JSObject();
                    tokenEvent.put("token", response);
                    tokenEvent.put("done", false);
                    notifyListeners("onToken", tokenEvent);
                }

                // Send done event
                JSObject doneEvent = new JSObject();
                doneEvent.put("token", "");
                doneEvent.put("done", true);
                notifyListeners("onToken", doneEvent);

                JSObject result = new JSObject();
                result.put("response", response != null ? response : "");
                call.resolve(result);
            } catch (Exception e) {
                isGenerating = false;
                Log.e(TAG, "Generate error", e);
                call.reject("Generation failed: " + e.getMessage());
            }
        });
    }

    // ─── Reset ──────────────────────────────────────────────────────────

    @PluginMethod()
    public void reset(PluginCall call) {
        executor.execute(() -> {
            try {
                if (llmInference != null) {
                    llmInference.close();
                    llmInference = null;
                }
                isGenerating = false;
                JSObject result = new JSObject();
                result.put("success", true);
                call.resolve(result);
            } catch (Exception e) {
                call.reject("Reset failed: " + e.getMessage());
            }
        });
    }

    // ─── Delete Model ───────────────────────────────────────────────────

    @PluginMethod()
    public void deleteModel(PluginCall call) {
        executor.execute(() -> {
            try {
                if (llmInference != null) {
                    llmInference.close();
                    llmInference = null;
                }
                File modelFile = getModelFile();
                if (modelFile.exists()) {
                    modelFile.delete();
                }
                JSObject result = new JSObject();
                result.put("success", true);
                call.resolve(result);
            } catch (Exception e) {
                call.reject("Delete failed: " + e.getMessage());
            }
        });
    }

    // ─── Helpers ────────────────────────────────────────────────────────

    private File getModelFile() {
        File dir = getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        return new File(dir, MODEL_FILE_NAME);
    }

    private void notifyProgress(String status, double progress, String message) {
        JSObject event = new JSObject();
        event.put("status", status);
        event.put("progress", progress);
        event.put("message", message);
        notifyListeners("onProgress", event);
    }
}
