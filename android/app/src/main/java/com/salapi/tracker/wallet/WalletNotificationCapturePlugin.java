package com.salapi.tracker.wallet;

import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;
import android.provider.Settings;
import android.text.TextUtils;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

@CapacitorPlugin(name = "WalletNotificationCapture")
public class WalletNotificationCapturePlugin extends Plugin {
    private BroadcastReceiver receiver;

    @Override
    public void load() {
        receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                String serialized = intent.getStringExtra("notification");
                if (serialized == null) return;
                try {
                    notifyListeners("notificationCaptured", new JSObject(serialized), true);
                } catch (JSONException ignored) {
                    // Invalid bridge payloads are discarded; the durable native queue remains intact.
                }
            }
        };
        IntentFilter filter = new IntentFilter(WalletNotificationListenerService.ACTION_NOTIFICATION_CAPTURED);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            getContext().registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            getContext().registerReceiver(receiver, filter);
        }
    }

    @Override
    protected void handleOnDestroy() {
        if (receiver != null) {
            getContext().unregisterReceiver(receiver);
            receiver = null;
        }
        super.handleOnDestroy();
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject result = new JSObject();
        result.put("enabled", WalletCaptureStore.isEnabled(getContext()));
        result.put("permissionGranted", hasNotificationAccess());
        result.put("listenerConnected", WalletNotificationListenerService.isConnected());
        call.resolve(result);
    }

    @PluginMethod
    public void setCaptureEnabled(PluginCall call) {
        Boolean enabled = call.getBoolean("enabled");
        if (enabled == null) {
            call.reject("The enabled flag is required.");
            return;
        }
        WalletCaptureStore.setEnabled(getContext(), enabled);
        call.resolve();
    }

    @PluginMethod
    public void openAccessSettings(PluginCall call) {
        try {
            Intent settings = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
            getActivity().startActivity(settings);
            call.resolve();
        } catch (Exception exception) {
            call.reject("Could not open Android notification access settings.", exception);
        }
    }

    @PluginMethod
    public void getPendingNotifications(PluginCall call) {
        call.resolve(notificationsResult(WalletCaptureStore.get(getContext()), true));
    }

    @PluginMethod
    public void getActiveNotifications(PluginCall call) {
        boolean connected = WalletNotificationListenerService.isConnected();
        call.resolve(notificationsResult(WalletNotificationListenerService.getActiveWalletNotifications(), connected));
    }

    @PluginMethod
    public void acknowledgeNotification(PluginCall call) {
        String id = call.getString("id");
        if (id == null || id.isEmpty()) {
            call.reject("A notification ID is required.");
            return;
        }
        WalletCaptureStore.acknowledge(getContext(), id);
        call.resolve();
    }

    @PluginMethod
    public void clearCapturedNotifications(PluginCall call) {
        WalletCaptureStore.clear(getContext());
        call.resolve();
    }

    private JSObject notificationsResult(JSONArray notifications, boolean serviceConnected) {
        JSObject result = new JSObject();
        JSArray entries = new JSArray();
        for (int index = 0; index < notifications.length(); index++) {
            JSONObject item = notifications.optJSONObject(index);
            if (item == null) continue;
            try {
                entries.put(new JSObject(item.toString()));
            } catch (JSONException ignored) {
                // Ignore malformed native queue entries and leave queued deliveries available for retry.
            }
        }
        result.put("notifications", entries);
        result.put("serviceConnected", serviceConnected);
        return result;
    }

    private boolean hasNotificationAccess() {
        String enabledListeners = Settings.Secure.getString(
                getContext().getContentResolver(),
                "enabled_notification_listeners"
        );
        if (TextUtils.isEmpty(enabledListeners)) return false;
        ComponentName service = new ComponentName(getContext(), WalletNotificationListenerService.class);
        for (String listener : enabledListeners.split(":")) {
            if (service.equals(ComponentName.unflattenFromString(listener))) return true;
        }
        return false;
    }
}
