import Foundation

/// The phone's snapshot, as the watch holds it.
///
/// A hand-copy of `src/lib/watch/contract.ts`. Three codebases implement that
/// shape and two of them cannot import it, so it is kept small enough to hold
/// in your head and every field carries the reason it exists.
///
/// Decoding is total: a watch on an older build than the phone must show
/// something sensible rather than fail on a field it has never heard of, so
/// every value has a default and unknown keys are ignored.

let watchProtocol = 1

enum ShiftState: String {
    case off, on, breakTime

    init(wire: String) {
        switch wire {
        case "on": self = .on
        case "break": self = .breakTime
        default: self = .off
        }
    }
}

struct Notice: Identifiable, Equatable {
    let id: String
    let title: String
    /// critical rings; the rest are read when the wrist is raised.
    let severity: String
}

struct Capabilities: Equatable {
    var checkOut = false
    var breaks = false
    var travel = false
}

struct Trip: Equatable {
    var active = false
    var label = ""
}

struct WatchState: Equatable {
    var protocolVersion = watchProtocol
    var state: ShiftState = .off
    /// When the current state began. The watch counts up from this itself, so
    /// a wrist out of range keeps showing the right elapsed time and the phone
    /// is not woken once a second to say so.
    var since: Date?
    var workedMs: Double = 0
    var breakMs: Double = 0
    var asOf: Date?
    /// nil while no fix has been taken, which is not the same as being outside
    /// and must not be drawn as if it were.
    var onSite: Bool?
    var site = ""
    var company = ""
    var can = Capabilities()
    var trip: Trip?
    var notices: [Notice] = []
    /// False until the phone has said anything at all.
    var known = false

    /// The phone is speaking a shape this build cannot read.
    var outdated: Bool { known && protocolVersion > watchProtocol }

    /// Elapsed time in the current state, counted here. Clamped at zero: a
    /// watch whose clock trails the phone's should not render "-3m".
    func elapsed(at now: Date) -> TimeInterval {
        guard let since else { return 0 }
        return max(0, now.timeIntervalSince(since))
    }

    /// Worked time including the stretch since the snapshot was taken.
    func liveWorked(at now: Date) -> TimeInterval {
        let base = workedMs / 1000
        guard state == .on, let asOf else { return base }
        return base + max(0, now.timeIntervalSince(asOf))
    }

    /// Break time including the stretch since the snapshot was taken.
    func liveBreak(at now: Date) -> TimeInterval {
        let base = breakMs / 1000
        guard state == .breakTime, let asOf else { return base }
        return base + max(0, now.timeIntervalSince(asOf))
    }

    /// Build from the dictionary WatchConnectivity carries. Every read has a
    /// fallback, so a malformed payload yields the waiting screen rather than
    /// a crash — the two are the same thing to somebody looking at a wrist.
    static func parse(_ json: [String: Any]) -> WatchState {
        var s = WatchState()
        s.protocolVersion = json["v"] as? Int ?? watchProtocol
        s.state = ShiftState(wire: json["state"] as? String ?? "off")
        if let ms = json["since"] as? Double { s.since = Date(timeIntervalSince1970: ms / 1000) }
        s.workedMs = json["workedMs"] as? Double ?? 0
        s.breakMs = json["breakMs"] as? Double ?? 0
        if let ms = json["asOf"] as? Double, ms > 0 { s.asOf = Date(timeIntervalSince1970: ms / 1000) }
        s.onSite = json["onSite"] as? Bool
        s.site = json["site"] as? String ?? ""
        s.company = json["company"] as? String ?? ""
        if let can = json["can"] as? [String: Any] {
            s.can = Capabilities(
                checkOut: can["checkOut"] as? Bool ?? false,
                breaks: can["break"] as? Bool ?? false,
                travel: can["travel"] as? Bool ?? false
            )
        }
        if let t = json["travel"] as? [String: Any] {
            s.trip = Trip(active: t["active"] as? Bool ?? false, label: t["label"] as? String ?? "")
        }
        if let arr = json["notices"] as? [[String: Any]] {
            s.notices = arr.compactMap {
                guard let id = $0["id"] as? String else { return nil }
                return Notice(
                    id: id,
                    title: $0["title"] as? String ?? "",
                    severity: $0["severity"] as? String ?? "normal"
                )
            }
        }
        s.known = true
        return s
    }
}

/// What the wrist may ask for. Every one is reversible or additive; the
/// destructive edge of attendance is check-in, which is not offered because no
/// watch has a camera that can take the selfie it requires.
enum WatchCommand: String {
    case breakStart = "break.start"
    case breakEnd = "break.end"
    case checkout
    case tripEnd = "travel.end"
    case refresh
}

/// Clock formatting, in the one shape this product uses: 06h 12m.
func formatDuration(_ seconds: TimeInterval) -> String {
    let total = Int(max(0, seconds)) / 60
    let h = total / 60
    let m = total % 60
    return h > 0 ? String(format: "%02dh %02dm", h, m) : String(format: "%02dm", m)
}
