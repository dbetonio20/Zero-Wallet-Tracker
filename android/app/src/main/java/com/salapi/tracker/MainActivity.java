package com.salapi.tracker;

import android.os.Bundle;
import android.os.Environment;
import android.util.Log;
import com.getcapacitor.BridgeActivity;
import com.salapi.tracker.wallet.WalletNotificationCapturePlugin;

import java.io.File;

/**
 * Main activity for Zero Wallet Tracker.
 */
public class MainActivity extends BridgeActivity {
    private static final String TAG = "MainActivity";
    private static final String[] LEGACY_MODEL_FILES = {
            "qwen2.5-1.5b-instruct.task",
            "qwen2.5-1.5b-instruct.task.tmp"
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(WalletNotificationCapturePlugin.class);
        super.onCreate(savedInstanceState);
        removeLegacyModelFiles();
    }

    private void removeLegacyModelFiles() {
        File downloadsDir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        if (downloadsDir == null) {
            return;
        }

        for (String fileName : LEGACY_MODEL_FILES) {
            File modelFile = new File(downloadsDir, fileName);
            if (modelFile.exists() && !modelFile.delete()) {
                Log.w(TAG, "Could not remove legacy AI model file: " + modelFile.getName());
            }
        }
    }
}
