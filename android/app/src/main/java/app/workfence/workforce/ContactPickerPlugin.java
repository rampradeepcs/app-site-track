package app.workfence.workforce;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.ContactsContract;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * One contact, chosen by the person, with no permission asked for.
 *
 * The obvious route — @capacitor-community/contacts — gates every call,
 * pick included, behind an alias that groups READ_CONTACTS *and*
 * WRITE_CONTACTS, and Capacitor grants an alias only when every permission in
 * it is granted. Adding a crew would therefore have meant declaring write
 * access to the address book on a screen that only ever reads one name and one
 * number, and asking a worker to hand over their whole contact list to do it.
 *
 * ACTION_PICK against the phone-number table is the smaller thing that does
 * the same job. The system draws the picker, the user chooses, and Android
 * hands back a content URI carrying a one-shot read grant for that single row
 * — so nothing is declared in the manifest, nothing is requested at runtime,
 * and the app never has access to a contact the user did not pick.
 *
 * The trade is single-select: the system picker returns one contact per
 * invocation. That is why the UI invites another tap rather than a
 * multi-select, and it is the right trade — the alternative buys bulk
 * selection with a permission prompt for the entire address book.
 */
@CapacitorPlugin(name = "ContactPicker")
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
}
