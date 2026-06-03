package com.resq.net;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SmsBridgePlugin.class);
        registerPlugin(ContactsPlugin.class);
        registerPlugin(WifiDirectPlugin.class);
        registerPlugin(BleSosPlugin.class);
        registerPlugin(BluetoothMeshPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
