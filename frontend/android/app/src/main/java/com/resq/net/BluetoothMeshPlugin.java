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

    // ── Lifecycle ─────────────────────────────────────────────────────────────
    @Override
    public void load() {
        BluetoothManager bm = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        if (bm != null) btAdapter = bm.getAdapter();
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

        if (!checkBle(call)) return;

        startGattServer();
        startAdvertising();
        startScanning();
        active = true;

        // Periodic sync every 15 s — connect to known peers and exchange queued messages
        main.postDelayed(this::syncAllPeers, 5000);

        notifyStatus();
        call.resolve();
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
                if (peers.containsKey(addr)) return; // already known

                // Parse adv data
                ScanRecord rec = result.getScanRecord();
                String peerUserId = addr; // fallback
                String peerName   = "Unknown";
                if (rec != null) {
                    byte[] sd = rec.getServiceData(PARCEL_SVC);
                    if (sd != null) {
                        String raw = new String(sd, StandardCharsets.UTF_8);
                        if (raw.startsWith("RM") && raw.contains("|")) {
                            String[] parts = raw.substring(2).split("\\|", 2);
                            peerUserId = parts[0];
                            peerName   = parts.length > 1 ? parts[1] : "Unknown";
                        }
                    }
                }
                if (peerUserId.equals(ownUserId)) return; // ignore self

                JSObject peer = new JSObject();
                peer.put("address",  addr);
                peer.put("userId",   peerUserId);
                peer.put("name",     peerName);
                peer.put("rssi",     result.getRssi());
                peer.put("lastSeen", System.currentTimeMillis());
                peers.put(addr, peer);

                notifyListeners("bt_peer_found", peer);

                // Connect to exchange keys + messages
                final String finalPeerUserId = peerUserId;
                pool.execute(() -> connectAndSync(result.getDevice(), finalPeerUserId));
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
    private void connectAndSync(BluetoothDevice device, String peerUserId) {
        if (activeGatts.containsKey(device.getAddress())) return;

        BluetoothGatt[] gattRef = new BluetoothGatt[1];

        BluetoothGattCallback cb = new BluetoothGattCallback() {
            @Override
            public void onConnectionStateChange(BluetoothGatt gatt, int status, int newState) {
                if (newState == BluetoothProfile.STATE_CONNECTED) {
                    gatt.requestMtu(512);
                } else {
                    activeGatts.remove(device.getAddress());
                    gatt.close();
                    // Mark peer as seen but possibly moved away
                    JSObject peer = peers.get(device.getAddress());
                    if (peer != null) {
                        long lastSeen = peer.getLong("lastSeen", 0);
                        if (System.currentTimeMillis() - lastSeen > 120_000) {
                            peers.remove(device.getAddress());
                            JSObject lost = new JSObject();
                            lost.put("userId", peerUserId);
                            notifyListeners("bt_peer_lost", lost);
                        }
                    }
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

                // Step 1: read device info
                BluetoothGattCharacteristic info = svc.getCharacteristic(CHAR_DEVINFO);
                if (info != null) gatt.readCharacteristic(info);
                else {
                    // Skip to key read
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
                    // Parse peer info and update registry
                    String info = new String(characteristic.getValue(), StandardCharsets.UTF_8);
                    if (info.contains("|")) {
                        String[] p = info.split("\\|", 2);
                        JSObject peer = peers.getOrDefault(device.getAddress(), new JSObject());
                        peer.put("userId", p[0]);
                        peer.put("name",   p.length > 1 ? p[1] : "Unknown");
                        peers.put(device.getAddress(), peer);
                    }
                    // Read public key next
                    BluetoothGattCharacteristic pk = svc.getCharacteristic(CHAR_PUBKEY);
                    if (pk != null) gatt.readCharacteristic(pk);

                } else if (CHAR_PUBKEY.equals(characteristic.getUuid())) {
                    byte[] keyBytes = characteristic.getValue();
                    if (keyBytes != null && keyBytes.length > 0) {
                        String pubKeyB64 = Base64.encodeToString(keyBytes, Base64.NO_WRAP);
                        JSObject event = new JSObject();
                        event.put("userId",    peerUserId);
                        event.put("publicKey", pubKeyB64);
                        notifyListeners("bt_pubkey", event);
                    }
                    // Now write pending messages for this peer
                    deliverPendingMessages(gatt, svc, peerUserId);
                }
            }

            @Override
            public void onCharacteristicWrite(BluetoothGatt gatt,
                    BluetoothGattCharacteristic characteristic, int status) {
                // Next message in queue will be written by deliverPendingMessages loop
            }
        };

        BluetoothGatt gatt = device.connectGatt(getContext(), false, cb, BluetoothDevice.TRANSPORT_LE);
        gattRef[0] = gatt;
        activeGatts.put(device.getAddress(), gatt);
    }

    // Deliver all queued messages relevant to this peer (direct or relay)
    private void deliverPendingMessages(BluetoothGatt gatt, BluetoothGattService svc, String peerUserId) {
        BluetoothGattCharacteristic msgChar = svc.getCharacteristic(CHAR_MSG);
        if (msgChar == null) { gatt.disconnect(); return; }

        synchronized (relayQueue) {
            List<String> toRemove = new ArrayList<>();
            for (String msgJson : relayQueue) {
                String to = extractField(msgJson, "to");
                // Send if: addressed to this peer, or is a broadcast/relay
                boolean shouldSend = "all".equals(to) || peerUserId.equals(to);
                if (shouldSend) {
                    byte[] bytes = msgJson.getBytes(StandardCharsets.UTF_8);
                    if (bytes.length > 512) continue; // skip oversized (shouldn't happen)
                    msgChar.setValue(bytes);
                    gatt.writeCharacteristic(msgChar);
                    if (!"all".equals(to)) toRemove.add(msgJson); // direct → remove after delivery
                }
            }
            relayQueue.removeAll(toRemove);
        }

        // Close after a short delay to let writes complete
        main.postDelayed(gatt::disconnect, 1500);
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

    // ── Periodic sync with all known peers ────────────────────────────────────
    private void syncAllPeers() {
        if (!active || relayQueue.isEmpty()) {
            if (active) main.postDelayed(this::syncAllPeers, 15_000);
            return;
        }
        for (Map.Entry<String, JSObject> entry : peers.entrySet()) {
            String addr = entry.getKey();
            String peerUserId = entry.getValue().getString("userId");
            BluetoothDevice dev = btAdapter.getRemoteDevice(addr);
            if (!activeGatts.containsKey(addr)) {
                pool.execute(() -> connectAndSync(dev, peerUserId));
            }
        }
        if (active) main.postDelayed(this::syncAllPeers, 15_000);
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
        if (checkBle(call)) start(call);
        else call.reject("Bluetooth permissions denied");
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
