package com.salapi.tracker.wallet;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

final class WalletCaptureStore {
    private static final String PREFERENCES = "wallet_notification_capture";
    private static final String CAPTURE_ENABLED = "capture_enabled";
    private static final String CAPTURE_QUEUE = "captured_notifications";

    private WalletCaptureStore() {}

    static SharedPreferences preferences(Context context) {
        return context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
    }

    static boolean isEnabled(Context context) {
        return preferences(context).getBoolean(CAPTURE_ENABLED, false);
    }

    static void setEnabled(Context context, boolean enabled) {
        preferences(context).edit().putBoolean(CAPTURE_ENABLED, enabled).commit();
    }

    static synchronized boolean add(Context context, JSONObject candidate) {
        JSONArray current = get(context);
        String id = candidate.optString("id");
        for (int index = 0; index < current.length(); index++) {
            JSONObject existing = current.optJSONObject(index);
            if (existing != null && id.equals(existing.optString("id"))) return false;
        }
        JSONArray updated = new JSONArray();
        updated.put(candidate);
        for (int index = 0; index < current.length(); index++) {
            updated.put(current.opt(index));
        }
        preferences(context).edit().putString(CAPTURE_QUEUE, updated.toString()).commit();
        return true;
    }

    static synchronized JSONArray get(Context context) {
        String serialized = preferences(context).getString(CAPTURE_QUEUE, "[]");
        try {
            return new JSONArray(serialized);
        } catch (JSONException exception) {
            return new JSONArray();
        }
    }

    static synchronized void acknowledge(Context context, String id) {
        JSONArray current = get(context);
        JSONArray updated = new JSONArray();
        for (int index = 0; index < current.length(); index++) {
            JSONObject candidate = current.optJSONObject(index);
            if (candidate != null && !id.equals(candidate.optString("id"))) updated.put(candidate);
        }
        preferences(context).edit().putString(CAPTURE_QUEUE, updated.toString()).commit();
    }

    static synchronized void clear(Context context) {
        preferences(context).edit().remove(CAPTURE_QUEUE).commit();
    }
}
