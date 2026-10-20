package com.salapi.tracker.wallet;

import android.content.Intent;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

import org.json.JSONArray;
import org.json.JSONObject;

public class WalletNotificationListenerService extends NotificationListenerService {
    static final String ACTION_NOTIFICATION_CAPTURED = "com.salapi.tracker.WALLET_NOTIFICATION_CAPTURED";
    private static volatile WalletNotificationListenerService connectedService;

    @Override
    public void onListenerConnected() {
        super.onListenerConnected();
        connectedService = this;
    }

    @Override
    public void onListenerDisconnected() {
        if (connectedService == this) connectedService = null;
        super.onListenerDisconnected();
    }

    @Override
    public void onDestroy() {
        if (connectedService == this) connectedService = null;
        super.onDestroy();
    }

    @Override
    public void onNotificationPosted(StatusBarNotification notification) {
        if (!WalletCaptureStore.isEnabled(this)) return;
        JSONObject candidate = WalletNotificationParser.parse(notification);
        if (candidate == null || !WalletCaptureStore.add(this, candidate)) return;

        Intent event = new Intent(ACTION_NOTIFICATION_CAPTURED);
        event.setPackage(getPackageName());
        event.putExtra("notification", candidate.toString());
        sendBroadcast(event);
    }

    static JSONArray getActiveWalletNotifications() {
        WalletNotificationListenerService service = connectedService;
        JSONArray result = new JSONArray();
        if (service == null) return result;
        StatusBarNotification[] notifications = service.getActiveNotifications();
        if (notifications == null) return result;
        for (StatusBarNotification notification : notifications) {
            JSONObject candidate = WalletNotificationParser.parse(notification);
            if (candidate != null) result.put(candidate);
        }
        return result;
    }

    static boolean isConnected() {
        return connectedService != null;
    }
}
