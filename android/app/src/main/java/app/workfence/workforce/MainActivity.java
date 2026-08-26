package app.workfence.workforce;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // App-local plugins are not auto-discovered the way node_modules ones
        // are — capacitor.plugins.json only lists packages — so this has to be
        // registered by hand, and before super.onCreate builds the bridge.
        registerPlugin(ContactPickerPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
