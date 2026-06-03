package com.resq.net;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothManager;
import android.bluetooth.le.AdvertiseCallback;
import android.bluetooth.le.AdvertiseData;
import android.bluetooth.le.AdvertiseSettings;
import android.bluetooth.le.BluetoothLeAdvertiser;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanFilter;
import android.bluetooth.le.ScanRecord;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.os.Build;
import android.os.ParcelUuid;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * BleSosPlugin — broadcast and receive SOS alerts via Bluetooth Low Energy.
 *
 * Works with ZERO network — Bluetooth only.
 * Range: ~30–100m depending on device and environment.
 *
 * Protocol:
 *   Service UUID: 0000FFFF-0000-1000-8000-00805F9B34FB  (RESQ SOS)
 *   Service data: UTF-8 encoded compact JSON (up to 27 bytes usable in advertisement)
 *   Format:       R<type><lat5><lng5><nameUp8>
 *   Example:      "RFLOOD|12.9716|77.5946|AhmedK"
 *
 * JS events:
 *   "ble_sos"    — { from, alertType, lat, lng, timestamp, rssi }
 *   "ble_status" — { advertising: bool, scanning: bool }
 */
@CapacitorPlugin(
    name = "BleSos",
    permissions = {
        @Permission(strings = { Manifest.permission.ACCESS_FINE_LOCATION },     alias = "location"),
        @Permission(strings = { Manifest.permission.BLUETOOTH_ADVERTISE },      alias = "bleAdvertise"),
        @Permission(strings = { Manifest.permission.BLUETOOTH_SCAN },           alias = "bleScan"),
        @Permission(strings = { Manifest.permission.BLUETOOTH_CONNECT },        alias = "bleConnect"),
    }
)
public class BleSosPlugin extends Plugin {

    private static final String RESQ_SOS_UUID = "0000ffff-0000-1000-8000-00805f9b34fb";
    private static final ParcelUuid RESQ_UUID = ParcelUuid.fromString(RESQ_SOS_UUID);

    private BluetoothAdapter    btAdapter;
    private BluetoothLeAdvertiser advertiser;
    private BluetoothLeScanner    scanner;
    private AdvertiseCallback     advertiseCallback;
    private ScanCallback          scanCallback;
    private boolean               isAdvertising = false;
    private boolean               isScanning    = false;

    // Dedupe seen beacons (address → lastSeen ms)
    private final Map<String, Long> seen = new HashMap<>();

    // ── Lifecycle ─────────────────────────────────────────────────────────────
    @Override
    public void load() {
        BluetoothManager bm = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        if (bm != null) {
            btAdapter = bm.getAdapter();
        }
    }

    // ── Advertise SOS beacon ──────────────────────────────────────────────────
    @PluginMethod
    public void startSosBeacon(PluginCall call) {
        if (!checkBleReady(call)) return;

        String alertType = call.getString("alertType", "SOS");
        String name      = call.getString("name",      "Unknown");
        double lat       = call.getDouble("lat",        0.0);
        double lng       = call.getDouble("lng",        0.0);

        // Encode payload: "R|<type>|<lat>|<lng>|<name>" — fits in 27 bytes if trimmed
        String latS  = String.format("%.4f", lat);
        String lngS  = String.format("%.4f", lng);
        String nameS = name.length() > 8 ? name.substring(0, 8) : name;
        String typeS = alertType.length() > 8 ? alertType.substring(0, 8) : alertType;
        String payload = "R|" + typeS + "|" + latS + "|" + lngS + "|" + nameS;
        byte[] data = payload.getBytes(StandardCharsets.UTF_8);
        // Clamp to 27 bytes max
        if (data.length > 27) data = Arrays.copyOf(data, 27);

        advertiser = btAdapter.getBluetoothLeAdvertiser();
        if (advertiser == null) {
            call.reject("BLE advertising not supported on this device");
            return;
        }

        AdvertiseSettings settings = new AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
            .setConnectable(false)
            .build();

        AdvertiseData adData = new AdvertiseData.Builder()
            .addServiceUuid(RESQ_UUID)
            .addServiceData(RESQ_UUID, data)
            .setIncludeDeviceName(false)
            .build();

        advertiseCallback = new AdvertiseCallback() {
            @Override
            public void onStartSuccess(AdvertiseSettings settingsInEffect) {
                isAdvertising = true;
                notifyStatus();
                call.resolve();
            }
            @Override
            public void onStartFailure(int errorCode) {
                isAdvertising = false;
                call.reject("BLE advertise failed: " + errorCode);
            }
        };

        advertiser.startAdvertising(settings, adData, advertiseCallback);
    }

    @PluginMethod
    public void stopSosBeacon(PluginCall call) {
        if (advertiser != null && advertiseCallback != null) {
            advertiser.stopAdvertising(advertiseCallback);
            advertiseCallback = null;
        }
        isAdvertising = false;
        notifyStatus();
        call.resolve();
    }

    // ── Scan for nearby SOS beacons ───────────────────────────────────────────
    @PluginMethod
    public void startScanning(PluginCall call) {
        if (!checkBleReady(call)) return;

        scanner = btAdapter.getBluetoothLeScanner();
        if (scanner == null) {
            call.reject("BLE scanning not supported");
            return;
        }

        ScanFilter filter = new ScanFilter.Builder()
            .setServiceUuid(RESQ_UUID)
            .build();

        ScanSettings scanSettings = new ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .build();

        scanCallback = new ScanCallback() {
            @Override
            public void onScanResult(int callbackType, ScanResult result) {
                String addr = result.getDevice().getAddress();
                long now = System.currentTimeMillis();
                // Dedupe: ignore same device within 10s
                Long lastSeen = seen.get(addr);
                if (lastSeen != null && now - lastSeen < 10_000) return;
                seen.put(addr, now);

                ScanRecord record = result.getScanRecord();
                if (record == null) return;
                byte[] serviceData = record.getServiceData(RESQ_UUID);
                if (serviceData == null) return;

                String payload = new String(serviceData, StandardCharsets.UTF_8);
                JSObject sos = parseBeaconPayload(payload, result.getRssi(), now);
                if (sos != null) {
                    notifyListeners("ble_sos", sos);
                }
            }
        };

        scanner.startScan(List.of(filter), scanSettings, scanCallback);
        isScanning = true;
        notifyStatus();
        call.resolve();
    }

    @PluginMethod
    public void stopScanning(PluginCall call) {
        if (scanner != null && scanCallback != null) {
            try { scanner.stopScan(scanCallback); } catch (Exception ignored) {}
            scanCallback = null;
        }
        isScanning = false;
        notifyStatus();
        call.resolve();
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject r = new JSObject();
        r.put("advertising", isAdvertising);
        r.put("scanning",    isScanning);
        r.put("supported",   btAdapter != null && btAdapter.isEnabled());
        call.resolve(r);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────
    private JSObject parseBeaconPayload(String payload, int rssi, long timestamp) {
        // Format: "R|<type>|<lat>|<lng>|<name>"
        if (!payload.startsWith("R|")) return null;
        String[] parts = payload.substring(2).split("\\|", -1);
        if (parts.length < 4) return null;
        try {
            JSObject obj = new JSObject();
            obj.put("alertType", parts[0]);
            obj.put("lat",       Double.parseDouble(parts[1]));
            obj.put("lng",       Double.parseDouble(parts[2]));
            obj.put("from",      parts.length > 3 ? parts[3] : "Unknown");
            obj.put("rssi",      rssi);
            obj.put("timestamp", timestamp);
            obj.put("channel",   "ble");
            return obj;
        } catch (Exception e) {
            return null;
        }
    }

    private void notifyStatus() {
        JSObject s = new JSObject();
        s.put("advertising", isAdvertising);
        s.put("scanning",    isScanning);
        notifyListeners("ble_status", s);
    }

    private boolean checkBleReady(PluginCall call) {
        if (btAdapter == null || !btAdapter.isEnabled()) {
            call.reject("Bluetooth is disabled");
            return false;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (getPermissionState("bleAdvertise") != PermissionState.GRANTED ||
                getPermissionState("bleScan")      != PermissionState.GRANTED) {
                requestAllPermissions(call, "onBlePermission");
                return false;
            }
        } else {
            if (getPermissionState("location") != PermissionState.GRANTED) {
                requestPermissionForAlias("location", call, "onBlePermission");
                return false;
            }
        }
        return true;
    }

    @PermissionCallback
    private void onBlePermission(PluginCall call) {
        if (checkBleReady(call)) {
            // Re-invoke the original method
            String method = call.getMethodName();
            if ("startSosBeacon".equals(method)) startSosBeacon(call);
            else if ("startScanning".equals(method)) startScanning(call);
            else call.resolve();
        } else {
            call.reject("Bluetooth permissions denied");
        }
    }

    @Override
    protected void handleOnDestroy() {
        if (advertiser != null && advertiseCallback != null) {
            try { advertiser.stopAdvertising(advertiseCallback); } catch (Exception ignored) {}
        }
        if (scanner != null && scanCallback != null) {
            try { scanner.stopScan(scanCallback); } catch (Exception ignored) {}
        }
    }
}
