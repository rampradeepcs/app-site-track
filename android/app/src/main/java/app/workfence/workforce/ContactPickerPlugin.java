package app.workfence.workforce;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.ContactsContract;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * Two routes into the address book, with different privacy costs.
 *
 * `pick()` — one contact, chosen by the person, with no permission asked for.
 * ACTION_PICK against the phone-number table: the system draws the picker,
 * the user chooses, and Android hands back a content URI carrying a one-shot
 * read grant for that single row. Nothing is declared, nothing is requested,
 * and the app never sees a contact the user did not pick.
 *
 * `list()` — the whole phone-number table, for the in-app multi-select sheet.
 * This one *does* cost READ_CONTACTS, declared in the manifest and requested
 * at runtime, because Android has no multi-select system picker: bulk
 * selection means the app must draw the list itself, and drawing the list
 * means reading it. READ_CONTACTS alone, though — not the READ+WRITE alias
 * that @capacitor-community/contacts would have demanded — and a denial is
 * not an error: the JS side falls back to `pick()`, so refusing the prompt
 * costs the bulk shortcut, never the feature.
 */
@CapacitorPlugin(
    name = "ContactPicker",
    permissions = @Permission(alias = "contacts", strings = { Manifest.permission.READ_CONTACTS })
)
public class ContactPickerPlugin extends Plugin {

    @PluginMethod
    public void pick(PluginCall call) {
        // Phone.CONTENT_URI rather than Contacts.CONTENT_URI: picking from the
        // phone-number table returns a row that already carries the display
        // name and the number, so one query on the granted URI answers both.
        // Picking the *contact* would hand back an id that needs a second
        // lookup — and that lookup is not covered by the grant.
        Intent intent = new Intent(Intent.ACTION_PICK, ContactsContract.CommonDataKinds.Phone.CONTENT_URI);
        startActivityForResult(call, intent, "pickResult");
    }

    @ActivityCallback
    private void pickResult(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }

        JSObject out = new JSObject();
        Intent data = result.getData();

        // A cancelled picker and a denied one are indistinguishable here, and
        // neither is an error: the caller has manual entry either way.
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            out.put("cancelled", true);
            call.resolve(out);
            return;
        }

        Uri uri = data.getData();
        String[] projection = {
            ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
            ContactsContract.CommonDataKinds.Phone.NUMBER
        };

        try (Cursor cursor = getContext().getContentResolver().query(uri, projection, null, null, null)) {
            if (cursor == null || !cursor.moveToFirst()) {
                out.put("cancelled", true);
                call.resolve(out);
                return;
            }
            int nameIndex = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME);
            int numberIndex = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.NUMBER);
            out.put("cancelled", false);
            out.put("name", nameIndex >= 0 ? cursor.getString(nameIndex) : "");
            out.put("phone", numberIndex >= 0 ? cursor.getString(numberIndex) : "");
            call.resolve(out);
        } catch (SecurityException e) {
            // The read grant rides on the returned URI. If it is gone — an OEM
            // picker that returns something else, a URI that outlived the
            // result — say so rather than resolving an empty contact that
            // looks like the user picked nobody.
            call.reject("Couldn't read the contact you picked.", e);
        } catch (Exception e) {
            call.reject("Couldn't read the contact you picked.", e);
        }
    }

    @PluginMethod
    public void list(PluginCall call) {
        if (getPermissionState("contacts") == PermissionState.GRANTED) {
            resolveContactList(call);
        } else {
            requestPermissionForAlias("contacts", call, "contactsPermissionCallback");
        }
    }

    @PermissionCallback
    private void contactsPermissionCallback(PluginCall call) {
        if (getPermissionState("contacts") == PermissionState.GRANTED) {
            resolveContactList(call);
        } else {
            // Refusal resolves rather than rejects: the caller's next move is
            // the permissionless single picker, not an error banner.
            JSObject out = new JSObject();
            out.put("denied", true);
            out.put("contacts", new JSArray());
            call.resolve(out);
        }
    }

    private void resolveContactList(PluginCall call) {
        String[] projection = {
            ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
            ContactsContract.CommonDataKinds.Phone.NUMBER
        };

        JSArray contacts = new JSArray();
        try (Cursor cursor = getContext().getContentResolver().query(
                ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                projection,
                null,
                null,
                ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME + " COLLATE NOCASE ASC")) {
            if (cursor != null) {
                int nameIndex = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME);
                int numberIndex = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.NUMBER);
                while (cursor.moveToNext()) {
                    JSObject row = new JSObject();
                    row.put("name", nameIndex >= 0 ? cursor.getString(nameIndex) : "");
                    row.put("phone", numberIndex >= 0 ? cursor.getString(numberIndex) : "");
                    contacts.put(row);
                }
            }
            JSObject out = new JSObject();
            out.put("denied", false);
            out.put("contacts", contacts);
            call.resolve(out);
        } catch (Exception e) {
            call.reject("Couldn't read the contact list.", e);
        }
    }
}
