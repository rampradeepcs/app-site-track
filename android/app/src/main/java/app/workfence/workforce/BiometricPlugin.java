package app.workfence.workforce;

import android.os.Build;

import androidx.annotation.NonNull;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The phone's own face or fingerprint, asked for at the gate.
 *
 * This proves the phone is in the hands of the person who set it up. That is
 * a different question from the one the selfie answers — whether the face at
 * the boundary is the enrolled worker's — and it is asked first because it is
 * instant and because a phone handed to a mate fails it before a camera is
 * ever opened.
 *
 * It never replaces the selfie. A biometric says yes or no and leaves nothing
 * behind; attendance needs a record somebody can look at later, and that is
 * the photograph and the descriptor comparison.
 *
 * DEVICE_CREDENTIAL is deliberately allowed alongside. A fingerprint sensor
 * on a site is read through dust, cement and rain, and a worker locked out of
 * their own day by a wet thumb would simply stop using the app. The PIN they
 * set is the same proof of possession, slower.
 */
@CapacitorPlugin(name = "Biometric")
public class BiometricPlugin extends Plugin {

    /**
     * BIOMETRIC_WEAK rather than STRONG: face unlock on a great many Android
     * phones is classed weak, and requiring STRONG would report "no biometric"
     * to exactly the users who think they have one. Nothing is being
     * encrypted here — the answer is a yes or no about who is holding the
     * phone, and weak is the right bar for that.
     */
    private static final int AUTHENTICATORS =
            BiometricManager.Authenticators.BIOMETRIC_WEAK
                    | BiometricManager.Authenticators.DEVICE_CREDENTIAL;

    /**
     * What this device can do, asked before anything is shown.
     *
     * The web layer uses this to decide whether to put a step in front of
     * check-in at all. A phone with no sensor and no PIN must not be given a
     * gate it can never pass.
     */
    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject out = new JSObject();
        try {
            BiometricManager manager = BiometricManager.from(getContext());
            int status = manager.canAuthenticate(AUTHENTICATORS);
            out.put("available", status == BiometricManager.BIOMETRIC_SUCCESS);
            out.put("reason", describe(status));
            // Whether a face is what they will be shown, so the prompt can say
            // the word the person expects rather than a generic one.
            out.put(
                    "face",
                    Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                            && getContext()
                                    .getPackageManager()
                                    .hasSystemFeature(android.content.pm.PackageManager.FEATURE_FACE));
        } catch (Exception e) {
            out.put("available", false);
            out.put("reason", "unavailable");
            out.put("face", false);
        }
        call.resolve(out);
    }

    private String describe(int status) {
        switch (status) {
            case BiometricManager.BIOMETRIC_SUCCESS:
                return "ready";
            case BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED:
                return "nothing enrolled";
            case BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE:
                return "no hardware";
            case BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE:
                return "hardware busy";
            default:
                return "unavailable";
        }
    }

    /**
     * Ask, and answer with what happened rather than only whether it worked.
     *
     * The caller has to tell a refusal from a broken sensor: somebody who
     * cancelled can try again, and somebody whose phone has no working sensor
     * should be let through to the selfie rather than held at a door that
     * will not open.
     */
    @PluginMethod
    public void verify(PluginCall call) {
        final String title = call.getString("title", "Confirm it's you");
        final String subtitle = call.getString("subtitle", "");

        FragmentActivity activity = (FragmentActivity) getActivity();
        if (activity == null) {
            call.resolve(result(false, "unavailable"));
            return;
        }

        BiometricPrompt prompt =
                new BiometricPrompt(
                        activity,
                        ContextCompat.getMainExecutor(getContext()),
                        new BiometricPrompt.AuthenticationCallback() {
                            @Override
                            public void onAuthenticationSucceeded(
                                    @NonNull BiometricPrompt.AuthenticationResult r) {
                                call.resolve(result(true, "ok"));
                            }

                            @Override
                            public void onAuthenticationError(int code, @NonNull CharSequence msg) {
                                // A cancel is a person saying no; the rest is a
                                // device saying it cannot. The web layer treats
                                // them differently and so must this.
                                boolean cancelled =
                                        code == BiometricPrompt.ERROR_USER_CANCELED
                                                || code == BiometricPrompt.ERROR_NEGATIVE_BUTTON
                                                || code == BiometricPrompt.ERROR_CANCELED;
                                call.resolve(result(false, cancelled ? "cancelled" : "failed"));
                            }

                            // Deliberately not resolving on a single bad read:
                            // the prompt stays up and lets them try again, which
                            // is what somebody with a dusty thumb needs.
                            @Override
                            public void onAuthenticationFailed() {}
                        });

        BiometricPrompt.PromptInfo.Builder info =
                new BiometricPrompt.PromptInfo.Builder()
                        .setTitle(title)
                        .setAllowedAuthenticators(AUTHENTICATORS);
        if (!subtitle.isEmpty()) {
            info.setSubtitle(subtitle);
        }

        try {
            activity.runOnUiThread(() -> prompt.authenticate(info.build()));
        } catch (Exception e) {
            call.resolve(result(false, "failed"));
        }
    }

    private JSObject result(boolean ok, String outcome) {
        JSObject out = new JSObject();
        out.put("ok", ok);
        out.put("outcome", outcome);
        return out;
    }
}
