package com.resq.net;

import android.Manifest;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.wifi.p2p.WifiP2pConfig;
import android.net.wifi.p2p.WifiP2pDevice;
import android.net.wifi.p2p.WifiP2pDeviceList;
import android.net.wifi.p2p.WifiP2pGroup;
import android.net.wifi.p2p.WifiP2pInfo;
import android.net.wifi.p2p.WifiP2pManager;
import android.os.Build;
import android.os.Looper;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.PrintWriter;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * WifiDirectPlugin — device-to-device mesh messaging without any router or internet.
 *
 * Flow:
 *   startDiscovery() → peers appear via onPeersChanged event
 *   connect(deviceAddress) → creates a WiFi P2P group
 *   One device becomes Group Owner (GO) and runs a TCP server on port 8988
 *   Other device connects to GO's IP and sends/receives messages
 *
 * JS events fired via notifyListeners():
 *   "peers"    — { peers: [{name, address, status}] }
 *   "connected"— { groupOwnerIp, isGroupOwner }
 *   "message"  — { from, content, timestamp }
 *   "status"   — { state: "connected"|"disconnected"|"discovering" }
 */
@CapacitorPlugin(
    name = "WifiDirect",
    permissions = {
        @Permission(strings = { Manifest.permission.ACCESS_FINE_LOCATION },   alias = "location"),
        @Permission(strings = { Manifest.permission.CHANGE_WIFI_STATE },       alias = "wifiState"),
        @Permission(strings = { Manifest.permission.ACCESS_WIFI_STATE },       alias = "wifiStateRead"),
        @Permission(strings = { Manifest.permission.CHANGE_NETWORK_STATE },    alias = "networkState"),
    }
)
public class WifiDirectPlugin extends Plugin {

    private static final int TCP_PORT = 8988;

    private WifiP2pManager   manager;
    private WifiP2pManager.Channel channel;
    private BroadcastReceiver receiver;
    private boolean           isGroupOwner     = false;
    private String            groupOwnerIp     = null;
    private ServerSocket      serverSocket     = null;
    private final ExecutorService pool = Executors.newCachedThreadPool();

    // ── Lifecycle ─────────────────────────────────────────────────────────────
    @Override
    public void load() {
        manager = (WifiP2pManager) getContext().getSystemService(Context.WIFI_P2P_SERVICE);
        channel = manager.initialize(getContext(), Looper.getMainLooper(), null);
        registerReceiver();
    }

    private void registerReceiver() {
        IntentFilter filter = new IntentFilter();
        filter.addAction(WifiP2pManager.WIFI_P2P_STATE_CHANGED_ACTION);
        filter.addAction(WifiP2pManager.WIFI_P2P_PEERS_CHANGED_ACTION);
        filter.addAction(WifiP2pManager.WIFI_P2P_CONNECTION_CHANGED_ACTION);
        filter.addAction(WifiP2pManager.WIFI_P2P_THIS_DEVICE_CHANGED_ACTION);

        receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context ctx, Intent intent) {
                String action = intent.getAction();
                if (WifiP2pManager.WIFI_P2P_PEERS_CHANGED_ACTION.equals(action)) {
                    manager.requestPeers(channel, peerList -> {
                        List<WifiP2pDevice> devices = new ArrayList<>(peerList.getDeviceList());
                        JSArray arr = new JSArray();
                        for (WifiP2pDevice d : devices) {
                            JSObject obj = new JSObject();
                            obj.put("name",    d.deviceName);
                            obj.put("address", d.deviceAddress);
                            obj.put("status",  d.status);
                            arr.put(obj);
                        }
                        JSObject data = new JSObject();
                        data.put("peers", arr);
                        notifyListeners("peers", data);
                    });
                } else if (WifiP2pManager.WIFI_P2P_CONNECTION_CHANGED_ACTION.equals(action)) {
                    manager.requestConnectionInfo(channel, info -> {
                        if (info.groupFormed) {
                            isGroupOwner = info.isGroupOwner;
                            groupOwnerIp = info.groupOwnerAddress != null
                                ? info.groupOwnerAddress.getHostAddress()
                                : null;

                            JSObject data = new JSObject();
                            data.put("groupOwnerIp",  groupOwnerIp);
                            data.put("isGroupOwner",  isGroupOwner);
                            notifyListeners("connected", data);

                            JSObject status = new JSObject();
                            status.put("state", "connected");
                            notifyListeners("status", status);

                            if (isGroupOwner) {
                                pool.execute(WifiDirectPlugin.this::runTcpServer);
                            }
                        } else {
                            JSObject status = new JSObject();
                            status.put("state", "disconnected");
                            notifyListeners("status", status);
                        }
                    });
                }
            }
        };

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            getContext().registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED);
        } else {
            getContext().registerReceiver(receiver, filter);
        }
    }

    // ── Plugin Methods ────────────────────────────────────────────────────────

    @PluginMethod
    public void startDiscovery(PluginCall call) {
        if (!hasRequiredPermissions()) {
            requestAllPermissions(call, "onPermissionResult");
            return;
        }
        manager.discoverPeers(channel, new WifiP2pManager.ActionListener() {
            @Override public void onSuccess() {
                JSObject status = new JSObject();
                status.put("state", "discovering");
                notifyListeners("status", status);
                call.resolve();
            }
            @Override public void onFailure(int reason) {
                call.reject("Discovery failed: " + reason);
            }
        });
    }

    @PluginMethod
    public void stopDiscovery(PluginCall call) {
        manager.stopPeerDiscovery(channel, new WifiP2pManager.ActionListener() {
            @Override public void onSuccess() { call.resolve(); }
            @Override public void onFailure(int r) { call.reject("Stop failed: " + r); }
        });
    }

    @PluginMethod
    public void connect(PluginCall call) {
        String address = call.getString("address", "");
        if (address.isEmpty()) { call.reject("address required"); return; }

        WifiP2pConfig config = new WifiP2pConfig();
        config.deviceAddress = address;

        manager.connect(channel, config, new WifiP2pManager.ActionListener() {
            @Override public void onSuccess() { call.resolve(); }
            @Override public void onFailure(int r) { call.reject("Connect failed: " + r); }
        });
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        manager.removeGroup(channel, new WifiP2pManager.ActionListener() {
            @Override public void onSuccess() {
                stopTcpServer();
                call.resolve();
            }
            @Override public void onFailure(int r) { call.reject("Disconnect failed: " + r); }
        });
    }

    /** Send a text message to the group. GO broadcasts to all; clients send to GO which relays. */
    @PluginMethod
    public void sendMessage(PluginCall call) {
        String content = call.getString("content", "");
        String name    = call.getString("name",    "Unknown");
        if (content.isEmpty()) { call.reject("content required"); return; }

        pool.execute(() -> {
            // Format: JSON-ish one-liner so it survives TCP framing
            String line = "{\"name\":\"" + name.replace("\"","") + "\",\"content\":\"" +
                content.replace("\\","\\\\").replace("\"","\\\"") + "\",\"ts\":" + System.currentTimeMillis() + "}";
            try {
                String target = isGroupOwner ? "127.0.0.1" : groupOwnerIp;
                if (target == null) { call.reject("not connected"); return; }
                Socket sock = new Socket();
                sock.connect(new InetSocketAddress(target, TCP_PORT), 3000);
                PrintWriter pw = new PrintWriter(sock.getOutputStream(), true);
                pw.println(line);
                sock.close();
                call.resolve();
            } catch (IOException e) {
                call.reject("send failed: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject r = new JSObject();
        r.put("isGroupOwner", isGroupOwner);
        r.put("groupOwnerIp", groupOwnerIp != null ? groupOwnerIp : "");
        r.put("connected",    groupOwnerIp != null);
        call.resolve(r);
    }

    // ── TCP server (runs on Group Owner) ──────────────────────────────────────
    private void runTcpServer() {
        try {
            stopTcpServer();
            serverSocket = new ServerSocket(TCP_PORT);
            while (!serverSocket.isClosed()) {
                Socket client = serverSocket.accept();
                pool.execute(() -> handleClient(client));
            }
        } catch (IOException e) {
            // Server closed — normal on disconnect
        }
    }

    private void handleClient(Socket client) {
        try (BufferedReader br = new BufferedReader(new InputStreamReader(client.getInputStream()))) {
            String line;
            while ((line = br.readLine()) != null) {
                // Relay to all JS listeners
                JSObject msg = parseWdMessage(line);
                notifyListeners("message", msg);
                // Relay back to group (broadcast): connect to ourselves as "all"
                // (other clients connect individually — GO fires event to WebView which re-sends via sendMessage to each)
            }
        } catch (IOException ignored) {}
        try { client.close(); } catch (IOException ignored) {}
    }

    private JSObject parseWdMessage(String line) {
        // Minimal JSON parse for our known format
        JSObject obj = new JSObject();
        try {
            String name    = extractJsonString(line, "name");
            String content = extractJsonString(line, "content");
            String tsStr   = extractJsonValue(line,  "ts");
            obj.put("from",      name != null ? name : "Unknown");
            obj.put("content",   content != null ? content : line);
            obj.put("timestamp", tsStr != null ? Long.parseLong(tsStr) : System.currentTimeMillis());
        } catch (Exception e) {
            obj.put("from", "Unknown");
            obj.put("content", line);
            obj.put("timestamp", System.currentTimeMillis());
        }
        return obj;
    }

    private String extractJsonString(String json, String key) {
        String pattern = "\"" + key + "\":\"";
        int start = json.indexOf(pattern);
        if (start < 0) return null;
        start += pattern.length();
        int end = json.indexOf("\"", start);
        return end < 0 ? null : json.substring(start, end).replace("\\\"","\"").replace("\\\\","\\");
    }

    private String extractJsonValue(String json, String key) {
        String pattern = "\"" + key + "\":";
        int start = json.indexOf(pattern);
        if (start < 0) return null;
        start += pattern.length();
        int end = json.indexOf("}", start);
        String raw = end < 0 ? json.substring(start) : json.substring(start, end);
        return raw.replaceAll("[^0-9]", "");
    }

    private void stopTcpServer() {
        if (serverSocket != null && !serverSocket.isClosed()) {
            try { serverSocket.close(); } catch (IOException ignored) {}
            serverSocket = null;
        }
    }

    // ── Permissions ───────────────────────────────────────────────────────────
    private boolean hasRequiredPermissions() {
        return getPermissionState("location") == PermissionState.GRANTED;
    }

    @PermissionCallback
    private void onPermissionResult(PluginCall call) {
        if (hasRequiredPermissions()) {
            startDiscovery(call);
        } else {
            call.reject("Location permission required for WiFi Direct");
        }
    }

    @Override
    protected void handleOnDestroy() {
        stopTcpServer();
        if (receiver != null) {
            try { getContext().unregisterReceiver(receiver); } catch (Exception ignored) {}
        }
        pool.shutdownNow();
    }
}
