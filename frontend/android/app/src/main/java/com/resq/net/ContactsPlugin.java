package com.resq.net;

import android.Manifest;
import android.database.Cursor;
import android.net.Uri;
import android.provider.ContactsContract;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(
    name = "Contacts",
    permissions = {
        @Permission(strings = { Manifest.permission.READ_CONTACTS }, alias = "contacts")
    }
)
public class ContactsPlugin extends Plugin {

    @PluginMethod
    public void getContacts(PluginCall call) {
        if (getPermissionState("contacts") != com.getcapacitor.PermissionState.GRANTED) {
            requestPermissionForAlias("contacts", call, "permissionCallback");
            return;
        }
        doGetContacts(call);
    }

    @PermissionCallback
    private void permissionCallback(PluginCall call) {
        if (getPermissionState("contacts") == com.getcapacitor.PermissionState.GRANTED) {
            doGetContacts(call);
        } else {
            call.reject("Contacts permission denied");
        }
    }

    private void doGetContacts(PluginCall call) {
        JSArray contacts = new JSArray();
        Cursor cursor = null;
        try {
            Uri uri = ContactsContract.CommonDataKinds.Phone.CONTENT_URI;
            String[] projection = new String[] {
                ContactsContract.CommonDataKinds.Phone.CONTACT_ID,
                ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
                ContactsContract.CommonDataKinds.Phone.NUMBER,
                ContactsContract.CommonDataKinds.Phone.TYPE
            };
            String sort = ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME + " COLLATE NOCASE ASC";

            cursor = getContext().getContentResolver().query(uri, projection, null, null, sort);
            if (cursor != null) {
                int idIdx     = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.CONTACT_ID);
                int nameIdx   = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME);
                int phoneIdx  = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.NUMBER);
                int typeIdx   = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.TYPE);

                while (cursor.moveToNext()) {
                    String name  = nameIdx >= 0 ? cursor.getString(nameIdx) : "";
                    String phone = phoneIdx >= 0 ? cursor.getString(phoneIdx) : "";
                    if (phone == null || phone.isEmpty()) continue;
                    phone = phone.replaceAll("\\s+", "");

                    JSObject c = new JSObject();
                    c.put("id",    idIdx >= 0 ? cursor.getString(idIdx) : "");
                    c.put("name",  name != null ? name : "");
                    c.put("phone", phone);
                    c.put("type",  typeIdx >= 0 ? cursor.getInt(typeIdx) : 0);
                    contacts.put(c);
                }
            }
        } catch (Exception e) {
            call.reject("Failed to read contacts: " + e.getMessage());
            return;
        } finally {
            if (cursor != null) cursor.close();
        }

        JSObject result = new JSObject();
        result.put("contacts", contacts);
        result.put("count",    contacts.length());
        call.resolve(result);
    }

    @PluginMethod
    public void checkPermission(PluginCall call) {
        JSObject result = new JSObject();
        result.put("contacts", getPermissionState("contacts").toString());
        call.resolve(result);
    }
}
