import Foundation
import WatchConnectivity

/// The wire to the phone.
///
/// Two channels, because they answer different questions. State arrives as
/// application context, which WatchConnectivity replicates and replaces: it
/// survives the watch being away, so a wrist raised after an hour in a
/// basement shows the last thing that was true rather than nothing, and a
/// newer snapshot simply overwrites an older one instead of queueing behind
/// it. Commands go out as messages, delivered now or not at all — the right
/// semantics for "end my break", where a request replayed twenty minutes
/// later would be worse than one that plainly failed.
@MainActor
final class PhoneLink: NSObject, ObservableObject {

    @Published private(set) var state = WatchState()
    /// What the phone said when it refused, shown where the action was.
    @Published var reply: String?
    /// True while a command is in flight, so a thumb cannot send it twice.
    @Published private(set) var busy = false

    private var session: WCSession?

    func start() {
        guard WCSession.isSupported() else { return }
        let s = WCSession.default
        s.delegate = self
        session = s
        s.activate()
        // The context already holds whatever the phone last said, so read it
        // rather than waiting for a change that may not come for hours.
        apply(s.receivedApplicationContext)
    }

    /// Ask the phone for something.
    ///
    /// `isReachable` is the honest gate: when it is false the phone is not
    /// listening, and saying so is more useful than a spinner that never
    /// resolves.
    func send(_ command: WatchCommand) {
        guard !busy else { return }
        guard let session, session.isReachable else {
            reply = "Phone not connected."
            return
        }
        busy = true
        session.sendMessage(
            ["command": command.rawValue],
            replyHandler: { [weak self] answer in
                Task { @MainActor in
                    guard let self else { return }
                    self.busy = false
                    // An accepted command needs no words: the snapshot that
                    // follows is the answer, and a watch that says "Done" over
                    // a screen already showing the change is a tap nobody
                    // needed.
                    if let text = answer["reason"] as? String, !text.isEmpty {
                        self.reply = text
                    }
                }
            },
            errorHandler: { [weak self] _ in
                Task { @MainActor in
                    self?.busy = false
                    self?.reply = "Couldn't reach your phone."
                }
            }
        )
    }

    func clearReply() { reply = nil }

    private func apply(_ context: [String: Any]) {
        guard let json = context["snapshot"] as? String,
              let data = json.data(using: .utf8),
              let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return }
        state = WatchState.parse(dict)
    }
}

extension PhoneLink: WCSessionDelegate {
    nonisolated func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {
        guard activationState == .activated else { return }
        let context = session.receivedApplicationContext
        Task { @MainActor [weak self] in
            self?.apply(context)
            // Ask for something current: the stored context can be an hour old
            // and the boundary may have changed since.
            self?.send(.refresh)
        }
    }

    nonisolated func session(_ session: WCSession, didReceiveApplicationContext context: [String: Any]) {
        Task { @MainActor [weak self] in self?.apply(context) }
    }
}
