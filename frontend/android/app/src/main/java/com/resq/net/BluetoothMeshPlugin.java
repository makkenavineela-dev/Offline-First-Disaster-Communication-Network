package com.resq.net;

import android.Manifest;
import android.bluetooth.*;
import android.bluetooth.le.*;
import android.content.Context;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelUuid;

import com.getcapacitor.*;
import com.getcapacitor.annotation.*;

import android.util.Base64;

import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;

/**
 * BluetoothMeshPlugin — full BLE GATT mesh for offline device-to-device messaging.
 *
 * Architecture:
 *   ADVERTISER  — broadcasts presence beacon so nearby phones discover this device
 *   SCANNER     — discovers nearby RESQ phones
 *   GATT SERVER — receives connections; peers write messages here, read our public key
 *   GATT CLIENT — connects to each discovered peer, exchanges keys, delivers queued messages
 *   ROUTER      — TTL decrement, deduplication, relay queue
 *
 * Message format (JSON string written to CHAR_MESSAGE):
 *   {"id":"m123","from":"uid","to":"uid|all","ct":"base64","ttl":7,"ts":1234567890,"enc":true}
 *   enc=true  → ct is E2EE encrypted (only recipient can read)
 *   enc=false → ct is plain text broadcast
 *
 * JS events emitted via notifyListeners():
 *   "bt_peer_found"  — { userId, name, rssi }
 *   "bt_peer_lost"   — { userId }
 *   "bt_message"     — { id, from, fromName, to, content, enc, timestamp }
 *   "bt_status"      — { active, peers: number }
 *   "bt_pubkey"      — { userId, publicKey }  (key exchange complete)
 */
@CapacitorPlugin(
    name = "BluetoothMesh",
    permissions = {
        @Permission(strings = { Manifest.permission.BLUETOOTH_ADVERTISE }, alias = "bleAdv"),
        @Permission(strings = { Manifest.permission.BLUETOOTH_SCAN },      alias = "bleScan"),
        @Permission(strings = { Manifest.permission.BLUETOOTH_CONNECT },   alias = "bleConn"),
        @Permission(strings = { Manifest.permission.ACCESS_FINE_LOCATION }, alias = "loc"),
    }
)
public class BluetoothMeshPlugin extends Plugin {

    // ── UUIDs ─────────────────────────────────────────────────────────────────
    static final UUID SVC_UUID      = UUID.fromString("0000AA00-0000-1000-8000-00805F9B34FB");
    static final UUID CHAR_MSG      = UUID.fromString("0000AA01-0000-1000-8000-00805F9B34FB"); // WRITE
    static final UUID CHAR_PUBKEY   = UUID.fromString("0000AA02-0000-1000-8000-00805F9B34FB"); // READ
    static final UUID CHAR_DEVINFO  = UUID.fromString("0000AA03-0000-1000-8000-00805F9B34FB"); // READ
    static final UUID DESC_NOTIFY   = UUID.fromString("00002902-0000-1000-8000-00805F9B34FB");
    static final ParcelUuid PARCEL_SVC = ParcelUuid.fromString("0000AA00-0000-1000-8000-00805F9B34FB");

    // ── State ─────────────────────────────────────────────────────────────────
    private BluetoothAdapter      btAdapter;
    private BluetoothLeAdvertiser advertiser;
    private BluetoothLeScanner    scanner;
    private BluetoothGattServer   gattServer;
    private AdvertiseCallback     advCallback;
    private ScanCallback          scanCallback;
    private final Handler         main   = new Handler(Looper.getMainLooper());
    private final ExecutorService pool   = Executors.newCachedThreadPool();
    private boolean               active = false;

    // Peer registry: deviceAddress → { userId, name, address }
    private final Map<String, JSObject>  peers       = new ConcurrentHashMap<>();
    // Seen message IDs → timestamp (dedupe + loop prevention)
    private final Map<String, Long>      seenMsgs    = new ConcurrentHashMap<>();
    // Relay queue: messages to forward to next peer we meet
    private final List<String>           relayQueue  = Collections.synchronizedList(new ArrayList<>());
    // Our own public key bytes (set from JS)
    private byte[]                       ownPubKey   = new byte[0];
    // Our own device info
    private String                       ownUserId   = "";
    private String                       ownName     = "";
    // Connected GATT clients (outbound connections we opened)
    private final Map<String, BluetoothGatt> activeGatts = new ConcurrentHashMap<>();
    // Addresses we are currently connecting to (prevents duplicate connects)
    private final java.util.Set<String> connecting =
        java.util.Collections.newSetFromMap(new ConcurrentHashMap<>());
    // deviceAddress -> full userId (resolved from GATT devinfo, NOT truncated advert)
    private final Map<String, String> addrToUserId = new ConcurrentHashMap<>();
    // deviceAddress -> queue of message bytes waiting to be written sequentially.
    // BLE allows only ONE outstanding write at a time, so we chain via the
    // onCharacteristicWrite callback instead of looping.
    private final Map<String, java.util.Queue<byte[]>> pendingWrites = new ConcurrentHashMap<>();

    // ── Lifecycle ─────────────────────────────────────────────────────────────
    @Override
    public void load() {
        BluetoothManager bm = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        if (bm != null) btAdapter = bm.getAdapter();
    }

    // ── Permission request (explicit, callable from JS before start) ───────────
    @PluginMethod
    public void requestPermissions(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (getPermissionState("bleAdv")  != PermissionState.GRANTED ||
                getPermissionState("bleScan") != PermissionState.GRANTED ||
                getPermissionState("bleConn") != PermissionState.GRANTED) {
                requestAllPermissions(call, "onPermsRequested");
                return;
            }
        } else {
            if (getPermissionState("loc") != PermissionState.GRANTED) {
                requestPermissionForAlias("loc", call, "onPermsRequested");
                return;
            }
        }
        JSObject r = new JSObject();
        r.put("granted", true);
        call.resolve(r);
    }

    @PermissionCallback
    private void onPermsRequested(PluginCall call) {
        boolean granted;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            granted = getPermissionState("bleAdv")  == PermissionState.GRANTED &&
                      getPermissionState("bleScan") == PermissionState.GRANTED &&
                      getPermissionState("bleConn") == PermissionState.GRANTED;
        } else {
            granted = getPermissionState("loc") == PermissionState.GRANTED;
        }
        JSObject r = new JSObject();
        r.put("granted", granted);
        call.resolve(r);
    }

    // ── Start / Stop ──────────────────────────────────────────────────────────
    @PluginMethod
    public void start(PluginCall call) {
        ownUserId   = call.getString("userId",   "");
        ownName     = call.getString("name",     "Unknown");
        String pubKeyB64 = call.getString("publicKey", "");

        if (!pubKeyB64.isEmpty()) {
            try {
                ownPubKey = Base64.decode(pubKeyB64, Base64.NO_WRAP);
            } catch (Exception ignored) {}
        }

        // Idempotent: if already running, just update identity and return success.
        // This lets every page call start() safely without restarting the radio.
        if (active) {
            JSObject r = new JSObject();
            r.put("active", true);
            r.put("alreadyRunning", true);
            call.resolve(r);
            return;
        }

        if (!checkBle(call)) return;

        try {
            startGattServer();
            startAdvertising();
            startScanning();
            active = true;
        } catch (Exception e) {
            call.reject("BLE start failed: " + e.getMessage());
            return;
        }

        // Periodic sync every 15 s — connect to known peers and exchange queued messages
        main.postDelayed(this::syncAllPeers, 5000);

        notifyStatus();
        JSObject r = new JSObject();
        r.put("active", true);
        call.resolve(r);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        active = false;
        stopAdvertising();
        stopScanning();
        if (gattServer != null) { gattServer.close(); gattServer = null; }
        for (BluetoothGatt g : activeGatts.values()) { try { g.close(); } catch (Exception ignored) {} }
        activeGatts.clear();
        peers.clear();
        notifyStatus();
        call.resolve();
    }

    // ── Send a message ────────────────────────────────────────────────────────
    @PluginMethod
    public void sendMessage(PluginCall call) {
        String to       = call.getString("to",        "all");
        String ct       = call.getString("ct",        "");    // already encrypted by JS
        boolean enc     = call.getBoolean("enc",      false);
        String fromName = call.getString("fromName",  ownName);

        String id  = "m_" + ownUserId.hashCode() + "_" + System.currentTimeMillis();
        String msg = buildMsgJson(id, ownUserId, fromName, to, ct, enc, 7);

        seenMsgs.put(id, System.currentTimeMillis());
        relayQueue.add(msg);

        // Immediately try to deliver to connected peers
        syncAllPeers();
        call.resolve(new JSObject().put("id", id));
    }

    // ── Update own public key ─────────────────────────────────────────────────
    @PluginMethod
    public void setPublicKey(PluginCall call) {
        String b64 = call.getString("publicKey", "");
        if (!b64.isEmpty()) {
            try { ownPubKey = Base64.decode(b64, Base64.NO_WRAP); } catch (Exception ignored) {}
        }
        call.resolve();
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject r = new JSObject();
        r.put("active", active);
        r.put("peers",  peers.size());
        call.resolve(r);
    }

    // ── GATT Server ───────────────────────────────────────────────────────────
    private void startGattServer() {
        BluetoothManager bm = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        if (bm == null) return;

        gattServer = bm.openGattServer(getContext(), new BluetoothGattServerCallback() {

            @Override
            public void onConnectionStateChange(BluetoothDevice device, int status, int newState) {}

            @Override
            public void onCharacteristicReadRequest(BluetoothDevice device,
                    int requestId, int offset, BluetoothGattCharacteristic characteristic) {
                byte[] value = new byte[0];
                if (CHAR_PUBKEY.equals(characteristic.getUuid())) {
                    value = ownPubKey;
                } else if (CHAR_DEVINFO.equals(characteristic.getUuid())) {
                    String info = ownUserId + "|" + ownName;
                    value = info.getBytes(StandardCharsets.UTF_8);
                }
                if (gattServer != null)
                    gattServer.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, value);
            }

            @Override
            public void onCharacteristicWriteRequest(BluetoothDevice device,
                    int requestId, BluetoothGattCharacteristic characteristic,
                    boolean preparedWrite, boolean responseNeeded, int offset, byte[] value) {

                if (CHAR_MSG.equals(characteristic.getUuid()) && value != null) {
                    String json = new String(value, StandardCharsets.UTF_8);
                    pool.execute(() -> routeMessage(json, device.getAddress()));
                }
                if (responseNeeded && gattServer != null)
                    gattServer.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, null);
            }
        });

        // Build service
        BluetoothGattService svc = new BluetoothGattService(SVC_UUID, BluetoothGattService.SERVICE_TYPE_PRIMARY);

        BluetoothGattCharacteristic msgChar = new BluetoothGattCharacteristic(CHAR_MSG,
                BluetoothGattCharacteristic.PROPERTY_WRITE | BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE,
                BluetoothGattCharacteristic.PERMISSION_WRITE);

        BluetoothGattCharacteristic pkChar = new BluetoothGattCharacteristic(CHAR_PUBKEY,
                BluetoothGattCharacteristic.PROPERTY_READ,
                BluetoothGattCharacteristic.PERMISSION_READ);

        BluetoothGattCharacteristic infoChar = new BluetoothGattCharacteristic(CHAR_DEVINFO,
                BluetoothGattCharacteristic.PROPERTY_READ,
                BluetoothGattCharacteristic.PERMISSION_READ);

        svc.addCharacteristic(msgChar);
        svc.addCharacteristic(pkChar);
        svc.addCharacteristic(infoChar);
        gattServer.addService(svc);
    }

    // ── Advertiser ────────────────────────────────────────────────────────────
    private void startAdvertising() {
        advertiser = btAdapter.getBluetoothLeAdvertiser();
        if (advertiser == null) return;

        AdvertiseSettings settings = new AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_POWER)
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_MEDIUM)
            .setConnectable(true)
            .build();

        // Service data: "RM" + first 6 chars userId + first 6 chars name
        String uid6  = (ownUserId.length()  > 6 ? ownUserId.substring(0, 6)  : ownUserId);
        String name6 = (ownName.length()    > 6 ? ownName.substring(0, 6)    : ownName);
        byte[] adData = ("RM" + uid6 + "|" + name6).getBytes(StandardCharsets.UTF_8);

        AdvertiseData data = new AdvertiseData.Builder()
            .addServiceUuid(PARCEL_SVC)
            .addServiceData(PARCEL_SVC, adData)
            .setIncludeDeviceName(false)
            .build();

        advCallback = new AdvertiseCallback() {
            @Override public void onStartSuccess(AdvertiseSettings s) {}
            @Override public void onStartFailure(int e) {}
        };
        advertiser.startAdvertising(settings, data, advCallback);
    }

    private void stopAdvertising() {
        if (advertiser != null && advCallback != null) {
            try { advertiser.stopAdvertising(advCallback); } catch (Exception ignored) {}
            advCallback = null;
        }
    }

    // ── Scanner ───────────────────────────────────────────────────────────────
    private void startScanning() {
        scanner = btAdapter.getBluetoothLeScanner();
        if (scanner == null) return;

        ScanFilter filter = new ScanFilter.Builder().setServiceUuid(PARCEL_SVC).build();
        ScanSettings settings = new ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_POWER)
            .build();

        scanCallback = new ScanCallback() {
            @Override
            public void onScanResult(int callbackType, ScanResult result) {
                String addr = result.getDevice().getAddress();

                // Known peer still advertising — refresh lastSeen so it isn't
                // pruned as stale, then skip (no need to reconnect just to discover).
                JSObject known = peers.get(addr);
                if (known != null) {
                    known.put("lastSeen", System.currentTimeMillis());
                    return;
                }
                if (connecting.contains(addr)) return;

                // (We do NOT use the truncated advertisement data as identity;
                //  the FULL userId + name come from the GATT devinfo read.)

                // Best-effort self-check: ignore our own advertisement.
                // The advert userId is truncated to 6 chars, so compare prefixes.
                ScanRecord rec = result.getScanRecord();
                if (rec != null) {
                    byte[] sd = rec.getServiceData(PARCEL_SVC);
                    if (sd != null) {
                        String raw = new String(sd, StandardCharsets.UTF_8);
                        if (raw.startsWith("RM") && raw.contains("|")) {
                            String advUid = raw.substring(2).split("\\|", 2)[0];
                            String myPrefix = ownUserId.length() > 6 ? ownUserId.substring(0, 6) : ownUserId;
                            if (advUid.equals(myPrefix)) return; // it's us
                        }
                    }
                }

                connecting.add(addr);
                final int rssi = result.getRssi();
                pool.execute(() -> connectAndSync(result.getDevice(), rssi));
            }

            @Override public void onScanFailed(int errorCode) {}
        };

        scanner.startScan(List.of(filter), settings, scanCallback);
    }

    private void stopScanning() {
        if (scanner != null && scanCallback != null) {
            try { scanner.stopScan(scanCallback); } catch (Exception ignored) {}
            scanCallback = null;
        }
    }

    // ── GATT Client — connect, exchange keys, deliver messages ────────────────
    private void connectAndSync(BluetoothDevice device, int rssi) {
        final String addr = device.getAddress();
        if (activeGatts.containsKey(addr)) return;

        // Mutable holders — filled with the FULL identity once devinfo is read.
        final String[] fullUserId = { addr };       // fallback to MAC until resolved
        final String[] fullName   = { "Unknown" };
        final int[]    peerRssi    = { rssi };

        BluetoothGatt[] gattRef = new BluetoothGatt[1];

        BluetoothGattCallback cb = new BluetoothGattCallback() {
            @Override
            public void onConnectionStateChange(BluetoothGatt gatt, int status, int newState) {
                if (newState == BluetoothProfile.STATE_CONNECTED) {
                    gatt.requestMtu(512);
                } else {
                    // Normal disconnect after message delivery — do NOT fire
                    // bt_peer_lost here. We connect/disconnect frequently for
                    // store-and-forward. The peer stays "known" as long as the
                    // scanner keeps seeing its advertisement. A separate stale
                    // check (pruneStalePeers) removes peers truly gone.
                    activeGatts.remove(addr);
                    connecting.remove(addr);
                    pendingWrites.remove(addr);
                    try { gatt.close(); } catch (Exception ignored) {}
                }
            }

            @Override
            public void onMtuChanged(BluetoothGatt gatt, int mtu, int status) {
                gatt.discoverServices();
            }

            @Override
            public void onServicesDiscovered(BluetoothGatt gatt, int status) {
                if (status != BluetoothGatt.GATT_SUCCESS) { gatt.disconnect(); return; }
                BluetoothGattService svc = gatt.getService(SVC_UUID);
                if (svc == null) { gatt.disconnect(); return; }

                // Step 1: read FULL device info (userId|name) — not truncated like advert
                BluetoothGattCharacteristic info = svc.getCharacteristic(CHAR_DEVINFO);
                if (info != null) gatt.readCharacteristic(info);
                else {
                    BluetoothGattCharacteristic pk = svc.getCharacteristic(CHAR_PUBKEY);
                    if (pk != null) gatt.readCharacteristic(pk);
                }
            }

            boolean infoRead = false;

            @Override
            public void onCharacteristicRead(BluetoothGatt gatt,
                    BluetoothGattCharacteristic characteristic, int status) {
                if (status != BluetoothGatt.GATT_SUCCESS) { gatt.disconnect(); return; }
                BluetoothGattService svc = gatt.getService(SVC_UUID);
                if (svc == null) return;

                if (CHAR_DEVINFO.equals(characteristic.getUuid()) && !infoRead) {
                    infoRead = true;

                    // Parse the FULL identity (this is the authoritative userId+name,
                    // matching exactly what the sender puts in message 'from' fields).
                    byte[] val = characteristic.getValue();
                    String info = val != null ? new String(val, StandardCharsets.UTF_8) : "";
                    if (info.contains("|")) {
                        String[] p = info.split("\\|", 2);
                        fullUserId[0] = p[0];
                        fullName[0]   = p.length > 1 ? p[1] : "Unknown";
                    }

                    // Ignore self (full id check)
                    if (fullUserId[0].equals(ownUserId)) {
                        gatt.disconnect();
                        return;
                    }

                    // Record mapping + peer entry with FULL identity
                    addrToUserId.put(addr, fullUserId[0]);
                    JSObject peer = new JSObject();
                    peer.put("address",  addr);
                    peer.put("userId",   fullUserId[0]);
                    peer.put("name",     fullName[0]);
                    peer.put("rssi",     peerRssi[0]);
                    peer.put("lastSeen", System.currentTimeMillis());
                    peers.put(addr, peer);

                    // NOW fire bt_peer_found with the FULL, correct identity
                    notifyListeners("bt_peer_found", peer);

                    // Read public key next
                    BluetoothGattCharacteristic pk = svc.getCharacteristic(CHAR_PUBKEY);
                    if (pk != null) gatt.readCharacteristic(pk);
                    else deliverPendingMessages(gatt, svc, fullUserId[0]);

                } else if (CHAR_PUBKEY.equals(characteristic.getUuid())) {
                    byte[] keyBytes = characteristic.getValue();
                    if (keyBytes != null && keyBytes.length > 0) {
                        String pubKeyB64 = Base64.encodeToString(keyBytes, Base64.NO_WRAP);
                        JSObject event = new JSObject();
                        event.put("userId",    fullUserId[0]); // FULL id — matches message sender
                        event.put("publicKey", pubKeyB64);
                        notifyListeners("bt_pubkey", event);
                    }
                    // Deliver any queued messages to this peer
                    deliverPendingMessages(gatt, svc, fullUserId[0]);
                }
            }

            @Override
            public void onCharacteristicWrite(BluetoothGatt gatt,
                    BluetoothGattCharacteristic characteristic, int status) {
                // Write the NEXT queued message (sequential — one at a time)
                writeNextPending(gatt, addr);
            }
        };

        BluetoothGatt gatt = device.connectGatt(getContext(), false, cb, BluetoothDevice.TRANSPORT_LE);
        gattRef[0] = gatt;
        activeGatts.put(addr, gatt);
    }

    // Queue messages relevant to this peer, then kick off sequential writes.
    private void deliverPendingMessages(BluetoothGatt gatt, BluetoothGattService svc, String peerUserId) {
        BluetoothGattCharacteristic msgChar = svc.getCharacteristic(CHAR_MSG);
        if (msgChar == null) { cleanupConnection(gatt, gatt.getDevice().getAddress()); return; }

        java.util.Queue<byte[]> q = new java.util.LinkedList<>();
        synchronized (relayQueue) {
            for (String msgJson : relayQueue) {
                String to = extractField(msgJson, "to");
                // Send broadcasts to everyone; direct messages only to the target peer
                boolean shouldSend = "all".equals(to) || peerUserId.equals(to);
                if (shouldSend) {
                    byte[] bytes = msgJson.getBytes(StandardCharsets.UTF_8);
                    if (bytes.length <= 512) q.add(bytes);
                }
            }
        }

        if (q.isEmpty()) {
            // Nothing to send — close after a moment
            main.postDelayed(() -> cleanupConnection(gatt, gatt.getDevice().getAddress()), 800);
            return;
        }

        pendingWrites.put(gatt.getDevice().getAddress(), q);
        writeNextPending(gatt, gatt.getDevice().getAddress());
    }

    // Write the next queued message for this connection, or clean up when done.
    private void writeNextPending(BluetoothGatt gatt, String addr) {
        java.util.Queue<byte[]> q = pendingWrites.get(addr);
        if (q == null || q.isEmpty()) {
            pendingWrites.remove(addr);
            // Give the last write a moment to flush, then disconnect
            main.postDelayed(() -> cleanupConnection(gatt, addr), 600);
            return;
        }
        BluetoothGattService svc = gatt.getService(SVC_UUID);
        if (svc == null) { cleanupConnection(gatt, addr); return; }
        BluetoothGattCharacteristic msgChar = svc.getCharacteristic(CHAR_MSG);
        if (msgChar == null) { cleanupConnection(gatt, addr); return; }

        byte[] next = q.poll();
        msgChar.setValue(next);
        msgChar.setWriteType(BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT);
        boolean ok = gatt.writeCharacteristic(msgChar);
        if (!ok) {
            // Write couldn't start — retry shortly
            main.postDelayed(() -> writeNextPending(gatt, addr), 200);
        }
    }

    private void cleanupConnection(BluetoothGatt gatt, String addr) {
        pendingWrites.remove(addr);
        connecting.remove(addr);
        try { gatt.disconnect(); } catch (Exception ignored) {}
    }

    // ── Message Router ────────────────────────────────────────────────────────
    private void routeMessage(String json, String fromAddress) {
        String id  = extractField(json, "id");
        String to  = extractField(json, "to");
        String from = extractField(json, "from");
        String ct  = extractField(json, "ct");
        String fromName = extractField(json, "fromName");
        boolean enc = "true".equals(extractField(json, "enc"));
        int ttl;
        try { ttl = Integer.parseInt(extractField(json, "ttl")); }
        catch (Exception e) { ttl = 0; }
        long ts;
        try { ts = Long.parseLong(extractField(json, "ts")); }
        catch (Exception e) { ts = System.currentTimeMillis(); }

        if (id == null || seenMsgs.containsKey(id)) return; // duplicate
        seenMsgs.put(id, System.currentTimeMillis());

        // Prune seen cache older than 10 minutes
        long cutoff = System.currentTimeMillis() - 600_000;
        seenMsgs.entrySet().removeIf(e -> e.getValue() < cutoff);

        // Deliver to this device if addressed to us or broadcast
        boolean forMe = "all".equals(to) || ownUserId.equals(to);
        if (forMe) {
            JSObject event = new JSObject();
            event.put("id",        id);
            event.put("from",      from);
            event.put("fromName",  fromName != null ? fromName : "Unknown");
            event.put("to",        to);
            event.put("content",   ct); // JS decrypts if enc=true
            event.put("enc",       enc);
            event.put("timestamp", ts);
            notifyListeners("bt_message", event);
        }

        // Relay to next hop if TTL allows and it wasn't only for us
        if (ttl > 1 && !ownUserId.equals(to)) {
            String relayJson = rebuildWithTtl(json, ttl - 1);
            relayQueue.add(relayJson);
        }
    }

    // Remove peers whose advertisement hasn't been seen for 45s, firing
    // bt_peer_lost so the UI drops them. Active connections are exempt.
    private void pruneStalePeers() {
        long cutoff = System.currentTimeMillis() - 45_000;
        for (Map.Entry<String, JSObject> entry : new ArrayList<>(peers.entrySet())) {
            String addr = entry.getKey();
            if (activeGatts.containsKey(addr) || connecting.contains(addr)) continue;
            long lastSeen = entry.getValue().optLong("lastSeen", 0);
            if (lastSeen < cutoff) {
                String uid = entry.getValue().getString("userId");
                peers.remove(addr);
                addrToUserId.remove(addr);
                if (uid != null) {
                    JSObject lost = new JSObject();
                    lost.put("userId", uid);
                    notifyListeners("bt_peer_lost", lost);
                }
            }
        }
    }

    // ── Periodic sync with all known peers ────────────────────────────────────
    // Reconnects to known peers to flush the relay queue (deliver pending msgs).
    private void syncAllPeers() {
        // Prune relay-queue messages older than 5 minutes so broadcasts don't
        // accumulate and re-send forever.
        synchronized (relayQueue) {
            long cutoff = System.currentTimeMillis() - 5 * 60 * 1000;
            relayQueue.removeIf(json -> {
                try { return Long.parseLong(extractField(json, "ts")) < cutoff; }
                catch (Exception e) { return false; }
            });
        }

        // Prune peers not seen advertising for 45s — fire bt_peer_lost for each.
        pruneStalePeers();

        if (!active || relayQueue.isEmpty()) {
            if (active) main.postDelayed(this::syncAllPeers, 8_000);
            return;
        }
        for (Map.Entry<String, JSObject> entry : peers.entrySet()) {
            String addr = entry.getKey();
            BluetoothDevice dev = btAdapter.getRemoteDevice(addr);
            if (!activeGatts.containsKey(addr) && !connecting.contains(addr)) {
                int rssi = (int) entry.getValue().optLong("rssi", -70);
                connecting.add(addr);
                pool.execute(() -> connectAndSync(dev, rssi));
            }
        }
        if (active) main.postDelayed(this::syncAllPeers, 8_000);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────
    private void notifyStatus() {
        JSObject s = new JSObject();
        s.put("active", active);
        s.put("peers",  peers.size());
        notifyListeners("bt_status", s);
    }

    private String buildMsgJson(String id, String from, String fromName, String to,
                                 String ct, boolean enc, int ttl) {
        return "{\"id\":\"" + esc(id) + "\",\"from\":\"" + esc(from) + "\",\"fromName\":\"" +
               esc(fromName) + "\",\"to\":\"" + esc(to) + "\",\"ct\":\"" + esc(ct) +
               "\",\"enc\":" + enc + ",\"ttl\":" + ttl +
               ",\"ts\":" + System.currentTimeMillis() + "}";
    }

    private String rebuildWithTtl(String json, int newTtl) {
        return json.replaceFirst("\"ttl\":\\d+", "\"ttl\":" + newTtl);
    }

    private String esc(String s) {
        return s == null ? "" : s.replace("\\","\\\\").replace("\"","\\\"");
    }

    private String extractField(String json, String key) {
        String pattern = "\"" + key + "\":";
        int i = json.indexOf(pattern);
        if (i < 0) return null;
        i += pattern.length();
        if (i >= json.length()) return null;
        if (json.charAt(i) == '"') {
            // string value
            i++;
            int end = i;
            while (end < json.length()) {
                if (json.charAt(end) == '"' && json.charAt(end - 1) != '\\') break;
                end++;
            }
            return json.substring(i, end).replace("\\\"","\"").replace("\\\\","\\");
        } else {
            // number or boolean
            int end = i;
            while (end < json.length() && ",}".indexOf(json.charAt(end)) < 0) end++;
            return json.substring(i, end).trim();
        }
    }

    private boolean checkBle(PluginCall call) {
        if (btAdapter == null || !btAdapter.isEnabled()) {
            call.reject("Bluetooth is disabled");
            return false;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (getPermissionState("bleAdv")  != PermissionState.GRANTED ||
                getPermissionState("bleScan") != PermissionState.GRANTED ||
                getPermissionState("bleConn") != PermissionState.GRANTED) {
                requestAllPermissions(call, "onBlePermission");
                return false;
            }
        } else {
            if (getPermissionState("loc") != PermissionState.GRANTED) {
                requestPermissionForAlias("loc", call, "onBlePermission");
                return false;
            }
        }
        return true;
    }

    @PermissionCallback
    private void onBlePermission(PluginCall call) {
        // Check state DIRECTLY to avoid infinite recursion (checkBle would
        // re-request permissions → onBlePermission → checkBle → ... StackOverflow).
        boolean granted;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            granted = getPermissionState("bleAdv")  == PermissionState.GRANTED &&
                      getPermissionState("bleScan") == PermissionState.GRANTED &&
                      getPermissionState("bleConn") == PermissionState.GRANTED;
        } else {
            granted = getPermissionState("loc") == PermissionState.GRANTED;
        }

        if (!granted) {
            call.reject("Bluetooth permissions denied");
            return;
        }

        // Granted — proceed with start ONCE (Bluetooth enabled check still applies)
        if (btAdapter == null || !btAdapter.isEnabled()) {
            call.reject("Bluetooth is disabled");
            return;
        }
        try {
            startGattServer();
            startAdvertising();
            startScanning();
            active = true;
            main.postDelayed(this::syncAllPeers, 5000);
            notifyStatus();
            JSObject r = new JSObject();
            r.put("active", true);
            call.resolve(r);
        } catch (Exception e) {
            call.reject("BLE start failed: " + e.getMessage());
        }
    }

    @Override
    protected void handleOnDestroy() {
        active = false;
        stopAdvertising();
        stopScanning();
        if (gattServer != null) { try { gattServer.close(); } catch (Exception ignored) {} }
        for (BluetoothGatt g : activeGatts.values()) { try { g.close(); } catch (Exception ignored) {} }
        pool.shutdownNow();
    }
}
