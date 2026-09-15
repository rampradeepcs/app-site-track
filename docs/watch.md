# The watch

Wear OS and Apple Watch, both companions to the phone.

## Why a companion and not a second app

The phone holds the session, the offline outbox and the camera, and it is the
only thing that decides whether an action is allowed. The watch renders what
it is told and asks for the handful of things a worker reaches for without
taking a phone out of a jacket at a site gate.

Making the watch standalone would mean duplicating authentication, the
geofence and the outbox on two more platforms, and it still could not do the
one thing that matters most.

## Check-in is deliberately missing

A check-in requires a selfie taken inside the site boundary. Apple Watch has
no camera at all, and a Wear OS camera — where one exists — is not a front
camera. Neither can take the photograph the record needs.

So the watch never offers it and says where to go instead. A button that
always fails is worse than no button.

Check-*out* is offered, and sends a null selfie. The phone already accepts
that: it is how an auto-closed day looks. The alternative is making somebody
dig a phone out at the end of a shift.

## One contract, three implementations

| where | file |
|---|---|
| the written shape | `src/lib/watch/contract.ts` |
| Wear OS | `android/wear/.../WatchState.kt` |
| Apple Watch | `ios/WorkfenceWatch/Sources/WatchState.swift` |

Kotlin and Swift cannot import TypeScript, so the shape is copied by hand.
That only stays honest if it is small enough to hold in your head, which is
why it is small. Every field carries the reason it exists.

Decoding on both watches is total: every value has a default and unknown keys
are ignored, so a watch older than the phone shows the waiting screen rather
than failing on a field it has not heard of. `v` is the protocol number; when
the phone's is higher, the watch says to update rather than misread numbers.

## Two channels, because they answer different questions

**State** goes over a replicated store — the Data Layer on Wear, application
context on Apple. Both survive the watch being out of range, so a wrist raised
after an hour in a basement shows the last thing that was true. A newer
snapshot replaces an older one rather than queueing behind it.

**Commands** are messages, delivered now or not at all. That is the right
semantics for "end my break": a request replayed twenty minutes later is worse
than one that plainly failed.

## The watch counts its own seconds

The snapshot carries `since`, the instant the current state began, and the
watch counts up from it. A shift that is merely running produces no traffic at
all — the phone is never woken to say a second passed. That is the difference
between a watch that lasts the shift and one that does not.

`asOf` does the same job for today's totals: the watch adds the time since the
snapshot rather than asking for a new one.

## What is on it

Four faces, swiped rather than buried in a menu.

| screen | what it is for |
|---|---|
| Shift | the glance: state, elapsed, on or off site, and the one action that makes sense |
| Today | worked and break totals |
| Trip | only present while a trip is running; starting one is a form and belongs on the phone |
| Notices | pinned site notices, the only screen that scrolls |

The phone decides which actions appear, through the `can` block. A company
that turns breaks off changes one setting and the watch follows without a
release.

## Building

Wear OS, alongside the phone app:

```bash
cd android && ./gradlew :wear:assembleDebug
```

Apple Watch, in the Xcode project the iOS app already uses:

```bash
cd ios/App && xcodebuild -scheme WorkfenceWatch -sdk watchsimulator build
```

## What still needs a person

**A signing team.** `DEVELOPMENT_TEAM` is deliberately empty in the watch
target. Putting the app on a real Apple Watch needs a paid Apple Developer
account, which belongs to whoever ships this. Until then it runs in the
simulator.

**A Wear OS device or emulator to test the pairing.** The module compiles and
the contract is verified on both sides, but two radios talking to each other
is the kind of thing that is only truly proven on hardware.
