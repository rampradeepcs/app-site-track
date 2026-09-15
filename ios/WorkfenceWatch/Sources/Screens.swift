import SwiftUI

/*
 * The watch screens.
 *
 * Written for an arm at a site gate in the sun: one thing per screen, the
 * number large enough to read without stopping, and the action a thumb can
 * hit through a glove.
 *
 * The palette is the phone's, reduced to what an OLED watch should draw —
 * black ground, because on this hardware black is off, and a shift lasts
 * longer than a battery that is not.
 */

extension Color {
    static let wfInk = Color(white: 0.97)
    static let wfMuted = Color(white: 0.60)
    static let wfAmber = Color(red: 0.91, green: 0.64, blue: 0.24)
    static let wfGreen = Color(red: 0.25, green: 0.78, blue: 0.52)
    static let wfRed = Color(red: 0.89, green: 0.34, blue: 0.30)
    static let wfSurface = Color(white: 0.09)
}

// MARK: - The glance

/// The one screen most people will ever see: state, elapsed time, and whether
/// they are inside the boundary, then the single action that makes sense from
/// where they are standing.
struct ShiftScreen: View {
    let state: WatchState
    let now: Date
    let busy: Bool
    let onBreakStart: () -> Void
    let onBreakEnd: () -> Void
    let onCheckOut: () -> Void

    private var accent: Color {
        switch state.state {
        case .breakTime: return .wfAmber
        case .on: return .wfGreen
        case .off: return .wfMuted
        }
    }

    private var heading: String {
        switch state.state {
        case .breakTime: return "ON BREAK"
        case .on: return "ON SHIFT"
        case .off: return "NOT CHECKED IN"
        }
    }

    var body: some View {
        VStack(spacing: 3) {
            Text(heading)
                .font(.system(size: 11, weight: .bold))
                .kerning(1.3)
                .foregroundStyle(accent)

            // The number is the message: elapsed in this state, counted on the
            // watch so it keeps running out of range.
            Text(state.state == .off ? "--" : formatDuration(state.elapsed(at: now)))
                .font(.system(size: 34, weight: .bold, design: .rounded))
                .foregroundStyle(Color.wfInk)
                .minimumScaleFactor(0.6)
                .lineLimit(1)

            if !state.site.isEmpty {
                Text(state.site)
                    .font(.system(size: 12))
                    .foregroundStyle(Color.wfMuted)
                    .lineLimit(1)
            }

            SiteBadge(onSite: state.onSite)
                .padding(.top, 2)

            Spacer(minLength: 6)

            if busy {
                ProgressView().tint(accent)
            } else {
                actions
            }
        }
        .padding(.horizontal, 6)
    }

    @ViewBuilder private var actions: some View {
        switch state.state {
        case .off:
            // Never a button: no watch has a camera that can take the selfie a
            // check-in requires, so offering it would offer something that
            // always fails.
            Text("Check in on your phone")
                .font(.system(size: 12))
                .foregroundStyle(Color.wfMuted)
                .multilineTextAlignment(.center)

        case .breakTime:
            WatchAction(label: "End break", fill: .wfAmber, ink: .black, action: onBreakEnd)

        case .on:
            VStack(spacing: 5) {
                if state.can.breaks {
                    WatchAction(label: "Break", fill: .wfSurface, ink: .wfInk, action: onBreakStart)
                }
                if state.can.checkOut {
                    WatchAction(label: "Check out", fill: .wfRed, ink: .black, action: onCheckOut)
                }
            }
        }
    }
}

private struct WatchAction: View {
    let label: String
    let fill: Color
    let ink: Color
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(label)
                .font(.system(size: 14, weight: .bold))
                .lineLimit(1)
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(.plain)
        .padding(.vertical, 10)
        .background(fill, in: Capsule())
        .foregroundStyle(ink)
    }
}

/// Inside, outside, or not known yet — three states, drawn as three.
private struct SiteBadge: View {
    let onSite: Bool?

    var body: some View {
        let (dot, label): (Color, String) = switch onSite {
        case .some(true): (.wfGreen, "On site")
        case .some(false): (.wfAmber, "Off site")
        case nil: (.wfMuted, "Locating…")
        }
        return HStack(spacing: 5) {
            Circle().fill(dot).frame(width: 6, height: 6)
            Text(label).font(.system(size: 12)).foregroundStyle(Color.wfMuted)
        }
    }
}

// MARK: - The day

/// The numbers, for somebody who wants more than the glance.
struct TodayScreen: View {
    let state: WatchState
    let now: Date

    var body: some View {
        VStack(spacing: 8) {
            Text("TODAY")
                .font(.system(size: 11, weight: .bold))
                .kerning(1.3)
                .foregroundStyle(Color.wfMuted)

            Stat(label: "Worked", value: formatDuration(state.liveWorked(at: now)), tint: .wfGreen)
            Stat(label: "Break", value: formatDuration(state.liveBreak(at: now)), tint: .wfAmber)

            if !state.company.isEmpty {
                Text(state.company)
                    .font(.system(size: 11))
                    .foregroundStyle(Color.wfMuted)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
            }
        }
        .padding(.horizontal, 8)
    }

    private struct Stat: View {
        let label: String
        let value: String
        let tint: Color

        var body: some View {
            VStack(spacing: 0) {
                Text(value)
                    .font(.system(size: 24, weight: .bold, design: .rounded))
                    .foregroundStyle(tint)
                Text(label)
                    .font(.system(size: 11))
                    .foregroundStyle(Color.wfMuted)
            }
        }
    }
}

// MARK: - The trip

/// Only reachable while a trip is running. Starting one asks for a purpose and
/// a vehicle, and a form does not belong on a watch.
struct TripScreen: View {
    let state: WatchState
    let busy: Bool
    let onEnd: () -> Void

    var body: some View {
        VStack(spacing: 6) {
            Text("TRIP")
                .font(.system(size: 11, weight: .bold))
                .kerning(1.3)
                .foregroundStyle(Color.wfAmber)

            if let trip = state.trip, trip.active {
                Text(trip.label.isEmpty ? "In progress" : trip.label)
                    .font(.system(size: 18, weight: .bold))
                    .foregroundStyle(Color.wfInk)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)

                if busy {
                    ProgressView().tint(.wfAmber).padding(.top, 6)
                } else {
                    WatchAction(label: "End trip", fill: .wfAmber, ink: .black, action: onEnd)
                        .padding(.top, 6)
                }
            } else {
                Text("No trip running.\nStart one on your phone.")
                    .font(.system(size: 13))
                    .foregroundStyle(Color.wfMuted)
                    .multilineTextAlignment(.center)
            }
        }
        .padding(.horizontal, 8)
    }
}

// MARK: - The notices

/// Pinned site notices, newest first. The only scrolling screen.
struct NoticesScreen: View {
    let notices: [Notice]

    var body: some View {
        if notices.isEmpty {
            VStack(spacing: 6) {
                Text("NOTICES")
                    .font(.system(size: 11, weight: .bold))
                    .kerning(1.3)
                    .foregroundStyle(Color.wfMuted)
                Text("Nothing pinned.")
                    .font(.system(size: 13))
                    .foregroundStyle(Color.wfMuted)
            }
        } else {
            List(notices) { n in
                HStack(alignment: .top, spacing: 8) {
                    Circle()
                        .fill(colour(for: n.severity))
                        .frame(width: 8, height: 8)
                        .padding(.top, 4)
                    // Reading is the whole interaction; the detail is on the
                    // phone, where there is room for it.
                    Text(n.title)
                        .font(.system(size: 13))
                        .foregroundStyle(Color.wfInk)
                        .lineLimit(3)
                }
                .listRowBackground(
                    RoundedRectangle(cornerRadius: 10).fill(Color.wfSurface)
                )
            }
            .listStyle(.carousel)
        }
    }

    private func colour(for severity: String) -> Color {
        switch severity {
        case "critical": return .wfRed
        case "important": return .wfAmber
        default: return .wfMuted
        }
    }
}

// MARK: - Nothing to show

/// The phone has never spoken, or is not there. Said plainly: a spinner that
/// never resolves is the worst possible answer to "is this working?".
struct WaitingScreen: View {
    let outdated: Bool

    var body: some View {
        VStack(spacing: 8) {
            Text("WORKFENCE")
                .font(.system(size: 12, weight: .bold))
                .kerning(1.5)
                .foregroundStyle(Color.wfAmber)
            Text(outdated ? "Update Workfence on this watch." : "Open Workfence on your phone.")
                .font(.system(size: 13))
                .foregroundStyle(Color.wfMuted)
                .multilineTextAlignment(.center)
        }
        .padding(.horizontal, 10)
    }
}
