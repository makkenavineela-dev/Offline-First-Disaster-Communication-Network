package com.resq.net;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import androidx.core.app.NotificationCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.getcapacitor.PermissionState;

/**
 * LocalNotifPlugin — posts REAL Android system-tray notifications.
 *
 * Unlike the in-app banner, these appear in the phone's notification shade,
 * make a sound, vibrate, and show on the lock screen — even when the app is in
 * the background (as long as the app process is alive running the BLE mesh).
 *
 * Two channels:
 *   resq_sos   — high-importance, red, urgent alarm for SOS alerts
 *   resq_msg   — default-importance for normal mesh messages
 *
 * JS:  Capacitor.Plugins.LocalNotif.notify({ title, body, urgent })
 */
@CapacitorPlugin(
    name = "LocalNotif",
    permissions = {
        @Permission(strings = { "android.permission.POST_NOTIFICATIONS" }, alias = "notif")
    }
)
public class LocalNotifPlugin extends Plugin {

    private static final String CH_SOS = "resq_sos";
    private static final String CH_MSG = "resq_msg";
    private int _id = 1000;

    @Override
    public void load() {
        createChannels();
    }

    private void createChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;

            NotificationChannel sos = new NotificationChannel(
                CH_SOS, "SOS Alerts", NotificationManager.IMPORTANCE_HIGH);
            sos.setDescription("Urgent emergency SOS alerts from nearby devices");
            sos.enableVibration(true);
            sos.setVibrationPattern(new long[]{0, 300, 150, 300, 150, 500});
            sos.enableLights(true);
            sos.setLightColor(0xFFFF1F1F);
            nm.createNotificationChannel(sos);

            NotificationChannel msg = new NotificationChannel(
                CH_MSG, "Messages", NotificationManager.IMPORTANCE_DEFAULT);
            msg.setDescription("New messages and resource shares over the mesh");
            msg.enableVibration(true);
            nm.createNotificationChannel(msg);
        }
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (getPermissionState("notif") != PermissionState.GRANTED) {
                requestPermissionForAlias("notif", call, "onNotifPerm");
                return;
            }
        }
        JSObject r = new JSObject();
        r.put("granted", true);
        call.resolve(r);
    }

    @PermissionCallback
    private void onNotifPerm(PluginCall call) {
        JSObject r = new JSObject();
        r.put("granted", getPermissionState("notif") == PermissionState.GRANTED);
        call.resolve(r);
    }

    @PluginMethod
    public void notify(PluginCall call) {
        String title = call.getString("title", "RESQ");
        String body  = call.getString("body",  "");
        boolean urgent = call.getBoolean("urgent", false);

        // On Android 13+ we need POST_NOTIFICATIONS granted
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && getPermissionState("notif") != PermissionState.GRANTED) {
            call.reject("notification permission not granted");
            return;
        }

        String channel = urgent ? CH_SOS : CH_MSG;

        // Tapping the notification opens the app
        Intent launch = getContext().getPackageManager()
            .getLaunchIntentForPackage(getContext().getPackageName());
        PendingIntent pi = null;
        if (launch != null) {
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
            pi = PendingIntent.getActivity(getContext(), 0, launch, flags);
        }

        NotificationCompat.Builder b = new NotificationCompat.Builder(getContext(), channel)
            .setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setPriority(urgent ? NotificationCompat.PRIORITY_MAX : NotificationCompat.PRIORITY_DEFAULT)
            .setDefaults(NotificationCompat.DEFAULT_ALL);

        if (urgent) {
            b.setColor(0xFFFF1F1F);
            b.setCategory(NotificationCompat.CATEGORY_ALARM);
        }
        if (pi != null) b.setContentIntent(pi);

        NotificationManager nm = (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            // SOS uses a stable id so repeats update; messages stack
            int id = urgent ? 999 : (++_id);
            nm.notify(id, b.build());
        }
        call.resolve();
    }
}
