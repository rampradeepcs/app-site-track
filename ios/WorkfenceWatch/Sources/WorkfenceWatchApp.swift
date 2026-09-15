import SwiftUI

/// The Workfence watch.
///
/// Four faces on a page strip, swiped the way watchOS expects rather than
/// buried behind a menu: a worker reaches Today or the notices with a thumb,
/// without reading anything.
@main
struct WorkfenceWatchApp: App {
    @StateObject private var link = PhoneLink()

    var body: some Scene {
        WindowGroup {
            RootView(link: link)
                .onAppear { link.start() }
        }
    }
}

struct RootView: View {
    @ObservedObject var link: PhoneLink

    /// The clock the elapsed numbers are drawn from, ticked here rather than
    /// pushed from the phone: the watch owns its own seconds, so a shift that
    /// is merely running costs no radio at all.
    @State private var now = Date()
    private let tick = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    var body: some View {
        Group {
            if let reply = link.reply {
                ReplyBanner(text: reply) { link.clearReply() }
            } else if !link.state.known || link.state.outdated {
                WaitingScreen(outdated: link.state.outdated)
            } else {
                pages
            }
        }
        .background(Color.black)
        .onReceive(tick) { now = $0 }
    }

    private var pages: some View {
        let state = link.state
        // The trip earns a page only while one is running, so nobody swipes
        // past a screen with nothing to say.
        return TabView {
            ShiftScreen(
                state: state,
                now: now,
                busy: link.busy,
                onBreakStart: { link.send(.breakStart) },
                onBreakEnd: { link.send(.breakEnd) },
                onCheckOut: { link.send(.checkout) }
            )

            TodayScreen(state: state, now: now)

            if state.trip?.active == true {
                TripScreen(state: state, busy: link.busy) { link.send(.tripEnd) }
            }

            NoticesScreen(notices: state.notices)
        }
        .tabViewStyle(.verticalPage)
    }
}

/// What the phone said when it refused, in the phone's own words, because it
/// is the thing that knows the rule.
struct ReplyBanner: View {
    let text: String
    let onDismiss: () -> Void

    var body: some View {
        VStack(spacing: 10) {
            Text(text)
                .font(.system(size: 14))
                .foregroundStyle(Color.wfInk)
                .multilineTextAlignment(.center)
                .lineLimit(5)
            Button("OK", action: onDismiss)
                .font(.system(size: 13))
        }
        .padding(14)
    }
}
