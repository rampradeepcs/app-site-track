import Capacitor
import Foundation
import WatchConnectivity

/// The phone's end of the watch link.
///
/// Two channels, because they answer different questions. The shift snapshot
/// goes out as application context, which WatchConnectivity replicates and
/// replaces: it survives the watch being away, so a wrist raised after an hour
/// in a basement shows the last thing that was true, and a newer snapshot
/// overwrites an older one rather than queueing behind it. Commands arrive as
/// messages with a reply handler, delivered now or not at all — the right
/// semantics for "end my break", where a request replayed twenty minutes later
/// would be worse than one that plainly failed.
///
/// Nothing here decides anything. The web layer owns the rules; this carries
/// the question to it and the answer back, so a company that turns breaks off
/// changes one place and the watch follows.
@objc(WatchPlugin)
public class WatchPlugin: CAPPlugin, CAPBridgedPlugin {

    public let identifier = "WatchPlugin"
    public let jsName = "Watch"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isReachable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "publish", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "reply", returnType: CAPPluginReturnPromise),
    ]

    private var session: WCSession?

    /// Commands waiting on the web layer, by the id it will answer with.
    /// Bounded in practice by how fast a thumb can press a watch.
    private var pending: [String: ([String: Any]) -> Void] = [:]
    private let lock = NSLock()

    override public func load() {
        guard WCSession.isSupported() else { return }
        let s = WCSession.default
        s.delegate = self
        session = s
        s.activate()
    }

    /// Is a watch paired and reachable?
    ///
    /// Also the probe the web layer uses to decide whether this plugin exists
    /// at all, so it must answer rather than throw on a phone with no watch.
    @objc func isReachable(_ call: CAPPluginCall) {
        let ok = session?.isPaired == true && session?.isWatchAppInstalled == true
        call.resolve(["reachable": ok])
    }

    /// Replace the snapshot the watch holds.
    ///
    /// The payload is a string rather than a dictionary of fields: one encoder
    /// on the web side is easier to keep in step with two decoders than three
    /// shapes are, and the whole snapshot is smaller than a single map tile.
    @objc func publish(_ call: CAPPluginCall) {
        guard let snapshot = call.getString("snapshot") else {
            call.reject("snapshot is required")
            return
        }
        guard let session, session.activationState == .activated else {
            // No watch listening is the normal case, not an error worth
            // failing a render over.
            call.resolve()
            return
        }
        do {
            try session.updateApplicationContext(["snapshot": snapshot])
        } catch {
            CAPLog.print("[Watch] updateApplicationContext failed: \(error)")
        }
        call.resolve()
    }

    /// The web layer's answer, sent back to the watch that asked.
    @objc func reply(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else {
            call.reject("id is required")
            return
        }
        let ok = call.getBool("ok") ?? false
        let reason = call.getString("reason") ?? ""

        lock.lock()
        let handler = pending.removeValue(forKey: id)
        lock.unlock()

        // An accepted command needs no words: the snapshot that follows is the
        // answer, and a watch that says "Done" over a screen already showing
        // the change is a tap nobody needed.
        let text = ok ? reason : (reason.isEmpty ? "Couldn't do that." : reason)
        handler?(["ok": ok, "reason": ok && reason.isEmpty ? "" : text])
        call.resolve()
    }
}

extension WatchPlugin: WCSessionDelegate {
    public func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {}

    public func sessionDidBecomeInactive(_ session: WCSession) {}

    /// A watch was unpaired or swapped. Reactivating is what keeps a second
    /// watch working without reinstalling the phone app.
    public func sessionDidDeactivate(_ session: WCSession) {
        session.activate()
    }

    public func session(
        _ session: WCSession,
        didReceiveMessage message: [String: Any],
        replyHandler: @escaping ([String: Any]) -> Void
    ) {
        guard let command = message["command"] as? String else {
            replyHandler(["ok": false, "reason": "Not supported."])
            return
        }
        let id = UUID().uuidString
        lock.lock()
        pending[id] = replyHandler
        lock.unlock()

        notifyListeners("command", data: ["command": command, "id": id])

        /*
         * WatchConnectivity gives a reply handler a limited life, and a web
         * layer that is suspended will never answer. Rather than leave the
         * watch spinning, answer for it after a beat — the watch then says the
         * phone could not be reached, which is true and actionable.
         */
        DispatchQueue.main.asyncAfter(deadline: .now() + 8) { [weak self] in
            guard let self else { return }
            self.lock.lock()
            let late = self.pending.removeValue(forKey: id)
            self.lock.unlock()
            late?(["ok": false, "reason": "Open Workfence on your phone."])
        }
    }
}
