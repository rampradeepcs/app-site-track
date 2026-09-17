import Capacitor
import Foundation
import LocalAuthentication

/// The phone's own Face ID or Touch ID, asked for at the gate.
///
/// This proves the phone is in the hands of the person who set it up — a
/// different question from the one the selfie answers, which is whether the
/// face at the boundary belongs to the enrolled worker. It is asked first
/// because it is instant, and because a phone handed to a mate fails it
/// before a camera is ever opened.
///
/// It never replaces the selfie. A biometric says yes or no and leaves
/// nothing behind; attendance needs a record somebody can look at later.
///
/// `deviceOwnerAuthentication` rather than `...WithBiometrics`, so a passcode
/// is accepted when Face ID will not read. A site is dust, glare and a helmet
/// pulled low, and a worker locked out of their own day would simply stop
/// using the app. The passcode is the same proof of possession, slower.
@objc(BiometricPlugin)
public class BiometricPlugin: CAPPlugin, CAPBridgedPlugin {

    public let identifier = "BiometricPlugin"
    public let jsName = "Biometric"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "verify", returnType: CAPPluginReturnPromise),
    ]

    /// What this device can do, asked before anything is shown.
    ///
    /// The web layer uses this to decide whether to put a step in front of
    /// check-in at all. A phone with nothing enrolled must not be given a
    /// gate it can never pass.
    @objc func isAvailable(_ call: CAPPluginCall) {
        let context = LAContext()
        var error: NSError?
        let ok = context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error)

        var isFace = false
        if ok {
            // Reading biometryType before canEvaluatePolicy returns .none, so
            // the order here matters.
            isFace = context.biometryType == .faceID
        }

        call.resolve([
            "available": ok,
            "face": isFace,
            "reason": ok ? "ready" : Self.describe(error),
        ])
    }

    private static func describe(_ error: NSError?) -> String {
        guard let code = error.map({ LAError.Code(rawValue: $0.code) }) ?? nil else {
            return "unavailable"
        }
        switch code {
        case .biometryNotEnrolled, .passcodeNotSet: return "nothing enrolled"
        case .biometryNotAvailable: return "no hardware"
        case .biometryLockout: return "hardware busy"
        default: return "unavailable"
        }
    }

    /// Ask, and answer with what happened rather than only whether it worked.
    ///
    /// The caller has to tell a refusal from a sensor that cannot read:
    /// somebody who cancelled can try again, and somebody whose Face ID is
    /// locked out should be let through to the selfie rather than held at a
    /// door that will not open.
    @objc func verify(_ call: CAPPluginCall) {
        let reason = call.getString("subtitle").flatMap { $0.isEmpty ? nil : $0 }
            ?? call.getString("title")
            ?? "Confirm it's you"

        let context = LAContext()
        // The system sheet's fallback button. Named for what it does here
        // rather than left as "Enter Password", which reads like a different
        // account's password on a screen about a shift.
        context.localizedFallbackTitle = "Use passcode"

        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else {
            call.resolve(["ok": false, "outcome": "unavailable"])
            return
        }

        context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) { ok, err in
            var outcome = "ok"
            if !ok {
                let code = (err as NSError?).map { LAError.Code(rawValue: $0.code) } ?? nil
                switch code {
                case .userCancel, .appCancel, .systemCancel:
                    outcome = "cancelled"
                case .biometryNotAvailable, .biometryNotEnrolled, .passcodeNotSet:
                    outcome = "unavailable"
                default:
                    outcome = "failed"
                }
            }
            // Back to the main thread: the caller resumes a React render.
            DispatchQueue.main.async {
                call.resolve(["ok": ok, "outcome": outcome])
            }
        }
    }
}
