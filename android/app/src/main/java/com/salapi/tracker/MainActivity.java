package com.salapi.tracker;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

/**
 * Main activity for Zero Wallet Tracker.
 * Registers the native LlmPlugin for on-device AI inference via MediaPipe.
 */
public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Register native plugins before super.onCreate
        registerPlugin(LlmPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
