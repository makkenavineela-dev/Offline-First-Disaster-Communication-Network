package com.resq.net;

import android.Manifest;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;
import android.telephony.SmsManager;
import android.telephony.SmsMessage;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(
    name = "SmsBridge",
    permissions = {
        @Permission(strings = { Manifest.permission.SEND_SMS },    alias = "sendSms"),
        @Permission(strings = { Manifest.permission.RECEIVE_SMS }, alias = "receiveSms"),
    }
)
public class SmsBridgePlugin extends Plugin {

    static final String RESQ_PREFIX = "[RESQ]";
    static final String SMS_ACTION  = "android.provider.Telephony.SMS_RECEIVED";

    private BroadcastReceiver smsReceiver;
    private boolean isListening = false;

    // ── Send SMS ──────────────────────────────────────────────────────────────
    @PluginMethod
    public void sendSms(PluginCall call) {
        String number = call.getString("number", "").trim();
        String text   = call.getString("text",   "").trim();

        if (number.isEmpty()) { call.reject("number required"); return; }
        if (text.isEmpty())   { call.reject("text required");   return; }

        if (getPermissionState("sendSms") != PermissionState.GRANTED) {
            requestPermissionForAlias("sendSms", call, "onSendPermission");
            return;
        }
        doSend(call, number, text);
    }

    @PermissionCallback
    private void onSendPermission(PluginCall call) {
        if (getPermissionState("sendSms") == PermissionState.GRANTED) {
            doSend(call, call.getString("number", ""), call.getString("text", ""));
        } else {
            call.reject("SEND_SMS permission denied by user");
        }
    }

    @SuppressWarnings("deprecation")
    private void doSend(PluginCall call, String number, String text) {
        try {
            SmsManager mgr;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                mgr = getContext().getSystemService(SmsManager.class);
            } else {
                mgr = SmsManager.getDefault();
            }
            if (text.length() > 160) {
                mgr.sendMultipartTextMessage(number, null, mgr.divideMessage(text), null, null);
            } else {
                mgr.sendTextMessage(number, null, text, null, null);
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("SMS send failed: " + e.getMessage());
        }
    }

    // ── Listen for incoming RESQ SMS ──────────────────────────────────────────
    @PluginMethod(returnType = PluginMethod.RETURN_CALLBACK)
    public void startListening(PluginCall call) {
        if (isListening) {
            call.resolve(new JSObject().put("listening", true));
            return;
        }

        if (getPermissionState("receiveSms") != PermissionState.GRANTED) {
            requestPermissionForAlias("receiveSms", call, "onReceivePermission");
            return;
        }
        doListen(call);
    }

    @PermissionCallback
    private void onReceivePermission(PluginCall call) {
        if (getPermissionState("receiveSms") == PermissionState.GRANTED) {
            doListen(call);
        } else {
            call.reject("RECEIVE_SMS permission denied by user");
        }
    }

    @SuppressWarnings("deprecation")
    private void doListen(PluginCall call) {
        call.setKeepAlive(true);
        isListening = true;

        IntentFilter filter = new IntentFilter(SMS_ACTION);
        filter.setPriority(IntentFilter.SYSTEM_HIGH_PRIORITY);

        smsReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context ctx, Intent intent) {
                if (!SMS_ACTION.equals(intent.getAction())) return;

                Object[] pdus   = (Object[]) intent.getSerializableExtra("pdus");
                String   format = intent.getStringExtra("format");
                if (pdus == null || pdus.length == 0) return;

                StringBuilder body   = new StringBuilder();
                String        sender = null;
                long          ts     = System.currentTimeMillis();

                for (Object pdu : pdus) {
                    SmsMessage msg;
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        msg = SmsMessage.createFromPdu((byte[]) pdu, format);
                    } else {
                        msg = SmsMessage.createFromPdu((byte[]) pdu);
                    }
                    if (msg == null) continue;
                    body.append(msg.getMessageBody());
                    if (sender == null) {
                        sender = msg.getOriginatingAddress();
                        ts     = msg.getTimestampMillis();
                    }
                }

                String fullBody = body.toString();
                if (!fullBody.startsWith(RESQ_PREFIX)) return;

                String payload = fullBody.substring(RESQ_PREFIX.length()).trim();

                JSObject data = new JSObject();
                data.put("from",      sender != null ? sender : "unknown");
                data.put("body",      payload);
                data.put("timestamp", ts);

                notifyListeners("smsReceived", data);
            }
        };

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            getContext().registerReceiver(smsReceiver, filter, Context.RECEIVER_EXPORTED);
        } else {
            getContext().registerReceiver(smsReceiver, filter);
        }

        JSObject result = new JSObject();
        result.put("listening", true);
        call.resolve(result);
    }

    @PluginMethod
    public void stopListening(PluginCall call) {
        if (smsReceiver != null) {
            try { getContext().unregisterReceiver(smsReceiver); } catch (Exception ignored) {}
            smsReceiver = null;
            isListening = false;
        }
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        if (smsReceiver != null) {
            try { getContext().unregisterReceiver(smsReceiver); } catch (Exception ignored) {}
            smsReceiver = null;
        }
    }
}
