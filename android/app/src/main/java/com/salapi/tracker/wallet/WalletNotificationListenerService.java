package com.salapi.tracker.wallet;

import android.Manifest;
import android.app.ActivityManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.pm.PackageManager;
import android.content.Intent;
import android.os.Build;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

import org.json.JSONArray;
import org.json.JSONObject;

public class WalletNotificationListenerService extends NotificationListenerService {
    static final String ACTION_NOTIFICATION_CAPTURED = "com.salapi.tracker.WALLET_NOTIFICATION_CAPTURED";
    private static final String REVIEW_CHANNEL_ID = "wallet-purchase-review";
    private static volatile WalletNotificationListenerService connectedService;

    @Override
    public void onListenerConnected() {
        super.onListenerConnected();
        connectedService = this;
        if (WalletCaptureStore.isEnabled(this)) captureActiveWalletNotifications();
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
        captureCandidate(notification);
    }

    private void captureActiveWalletNotifications() {
        StatusBarNotification[] notifications = getActiveNotifications();
        if (notifications == null) return;
        for (StatusBarNotification notification : notifications) captureCandidate(notification);
    }

    private void captureCandidate(StatusBarNotification notification) {
        JSONObject candidate = WalletNotificationParser.parse(notification);
        if (candidate == null || !WalletCaptureStore.add(this, candidate)) return;
        showBackgroundReviewNotification(candidate);
        Intent event = new Intent(ACTION_NOTIFICATION_CAPTURED);
        event.setPackage(getPackageName());
        event.putExtra("notification", candidate.toString());
        sendBroadcast(event);
    }

    private void showBackgroundReviewNotification(JSONObject candidate) {
        if (isAppVisibleToUser()) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return;
        }

        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && !manager.areNotificationsEnabled()) return;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    REVIEW_CHANNEL_ID,
                    "transaction reviews",
                    NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription("Alerts when a transaction is ready to review.");
            manager.createNotificationChannel(channel);
        }

        Intent launchIntent = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (launchIntent == null) return;
        launchIntent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int notificationId = candidate.optString("id").hashCode() & 0x7fffffff;
        PendingIntent contentIntent = PendingIntent.getActivity(
                this,
                notificationId,
                launchIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(this, REVIEW_CHANNEL_ID)
                : new Notification.Builder(this);
        Notification reviewNotification = builder
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle("transaction")
                .setContentText("A purchase is ready for review in Salapi.")
                .setCategory(Notification.CATEGORY_EVENT)
                .setVisibility(Notification.VISIBILITY_PRIVATE)
                .setAutoCancel(true)
                .setContentIntent(contentIntent)
                .setPriority(Notification.PRIORITY_HIGH)
                .build();
        manager.notify(notificationId, reviewNotification);
    }

    private boolean isAppVisibleToUser() {
        ActivityManager.RunningAppProcessInfo processInfo = new ActivityManager.RunningAppProcessInfo();
        ActivityManager.getMyMemoryState(processInfo);
        return processInfo.importance <= ActivityManager.RunningAppProcessInfo.IMPORTANCE_VISIBLE;
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
