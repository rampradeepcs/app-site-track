"use client";

/**
 * Employee home — the whole daily loop lives here:
 *  pre-shift: geofence status + distance-to-site + gated Check In,
 *  check-in: location validation → selfie → confirmation,
 *  on shift: live map, working clock, distance, quick actions,
 *  checkout: selfie → summary → daily work update prompt.
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import { SiteMap, type MapMarker } from "@/components/SiteMap";
import { SelfieCapture } from "@/components/SelfieCapture";
import { FaceSetupCard } from "@/components/FaceSetupCard";
import { matchAgainst, readFace } from "@/lib/face/engine";
import { VoiceRecorder, type RecordedNote } from "@/components/VoiceRecorder";
import { WorkUpdateForm } from "@/components/WorkUpdateForm";
import { useFeature } from "@/components/FeatureGate";
import { NotificationBell } from "@/components/shell";
import {
  Avatar,
  BottomSheet,
  Chip,
  Segmented,
  StatusChip,
  useNowTick,
} from "@/components/ui";
import {
  fmtDistance,
  fmtDuration,
  fmtShiftTime,
  fmtTime,
  initialsOf,
  todayISO,
} from "@/lib/format";
import { dayMetrics, shiftFor } from "@/lib/payroll";
import {
  dayAllowances,
  fmtKmLabel,
  sanitiseTrack,
  travelPoints,
} from "@/lib/allowances";
import { TRAVEL_PURPOSES, type TravelPurpose } from "@/lib/types";
import { resolvePlace } from "@/lib/geo";
import {
  assignedPremises,
  nearestPremise,
  premiseAt,
  type PremiseFix,
} from "@/lib/premises";
import type { Project } from "@/lib/types";
import { useWorkforce, type SimScenario } from "@/lib/store";
import {
  ICamera,
  ICheckCircle,
  IClipboard,
  IClock,
  ICoffee,
  ICrosshair,
  IMapPin,
  INav,
  IRoute,
  IAlert,
  IShield,
} from "@/components/WfIcons";

type Flow =
  | null
  | { step: "validating"; dir: "in" | "out" }
  | { step: "selfie"; dir: "in" | "out" }
  | { step: "review"; selfie: string }
  | { step: "done-in"; at: number }
  | { step: "done-out"; at: number; summary: { inAt: number; outAt: number; minutes: number; distance: number } }
  | { step: "daily-update" }
  | { step: "blocked"; reason: string };

export default function EmployeeHome() {
  const wf = useWorkforce();
  const {
    state,
    currentUser,
    fix,
    fence,
    openShift,
    liveTrail,
    checkIn,
    checkOut,
    startBreak,
    endBreak,
    activeTravel,
    startTravel,
    endTravel,
    simScenario,
    setSimScenario,
    setActiveProject,
  } = wf;
  const [flow, setFlow] = useState<Flow>(null);
  const [updateSheet, setUpdateSheet] = useState(false);
  const [voiceNote, setVoiceNote] = useState<RecordedNote | null>(null);
  const [breakError, setBreakError] = useState<string | null>(null);
  const now = useNowTick(5);
  const breaksEnabled = useFeature("breaks");
  const voiceEnabled = useFeature("voiceNotes");
  const petrolEnabled = useFeature("petrolAllowance");
  const [travelSheet, setTravelSheet] = useState(false);
  const [travelPurpose, setTravelPurpose] = useState<TravelPurpose>("Material Pickup");
  const [travelNote, setTravelNote] = useState("");
  const [travelError, setTravelError] = useState<string | null>(null);

  const project = useMemo(() => {
    const pid = state.activeProjectId ?? currentUser?.projectIds[0];
    return state.projects.find((p) => p.id === pid) ?? null;
  }, [state.projects, state.activeProjectId, currentUser]);

  const greeting = useMemo(() => {
    const h = new Date(now).getHours();
    return h < 12 ? "Good Morning" : h < 17 ? "Good Afternoon" : "Good Evening";
  }, [now]);

  const place = useMemo(() => {
    if (!fix || !project) return "Locating…";
    return resolvePlace(fix.coords, project.zones, project.location);
  }, [fix, project]);

  /* The assigned shift and today's live measurements against it. */
  const shiftDef = useMemo(
    () => (currentUser ? shiftFor(state, currentUser.id, todayISO(now)) : null),
    [state, currentUser, now],
  );
  const liveMetrics = useMemo(
    () => (openShift && shiftDef ? dayMetrics(openShift, shiftDef, now) : null),
    [openShift, shiftDef, now],
  );
  const openBreak = openShift?.breaks?.find((b) => !b.end) ?? null;

  /* Travel: live measured distance of the running session, and the day's
     allowances for the checkout summary. */
  const travelEnabled = petrolEnabled && !!project?.travelTracking;
  const liveTravelMeters = useMemo(() => {
    if (!activeTravel) return 0;
    return sanitiseTrack(travelPoints(state, activeTravel.id)).meters;
  }, [state, activeTravel]);
  const allowances = useMemo(
    () => (openShift ? dayAllowances(state, openShift) : null),
    [state, openShift],
  );

  if (!currentUser || !project) {
    return (
      <div className="grid min-h-[60dvh] place-items-center px-6 text-center">
        <div>
          <IAlert size={30} className="mx-auto mb-3 text-[var(--wf-faint)]" />
          <p className="font-semibold">No project assigned</p>
          <p className="mt-1 text-sm text-[var(--wf-muted)]">
            Ask your manager to assign you to a project to start checking in.
          </p>
        </div>
      </div>
    );
  }

  const distance = fence ? Math.max(0, Math.round(fence.distance)) : null;
  const canCheckIn = !!fence?.inside && !!fix && !fix.degraded;

  /* ------------------------------------------- off-site tracking policy */

  // On this project the boundary is a privacy line: nothing is recorded while
  // the worker is inside it, and the shift can only be closed at a premise.
  const offsiteOnly = project.trackingMode === "outside-only";
  const premises = assignedPremises(state.projects, currentUser);
  const atPremise = fix ? premiseAt(fix.coords, premises) : null;
  const nearest = fix ? nearestPremise(fix.coords, premises) : null;
  const canCheckOut = !offsiteOnly || !!atPremise;
  const recording = !offsiteOnly || (!!fence && !fence.inside);

  /*
   * Both flows pause on a "validating" sheet before advancing. The timer that
   * advances it has to check that the worker is still there: dismissing the
   * sheet used to be silently overruled a moment later by a selfie step
   * opening on its own, which is the app arguing with someone who already
   * said no. The functional update is what makes that check race-free — it
   * sees the state at the moment it lands, not at the moment it was queued.
   */
  const startCheckIn = () => {
    setFlow({ step: "validating", dir: "in" });
    window.setTimeout(() => {
      const inside = wf.fence?.inside;
      setFlow((cur) =>
        cur?.step !== "validating" || cur.dir !== "in"
          ? cur
          : inside
            ? { step: "selfie", dir: "in" }
            : {
                step: "blocked",
                reason:
                  "You're outside the project site. Please move inside the site boundary to check in.",
              },
      );
    }, 900);
  };

  const startCheckOut = () => {
    setFlow({ step: "validating", dir: "out" });
    window.setTimeout(
      () =>
        setFlow((cur) =>
          cur?.step !== "validating" || cur.dir !== "out"
            ? cur
            : { step: "selfie", dir: "out" },
        ),
      700,
    );
  };

  const completeSelfie = async (dir: "in" | "out", dataUrl: string) => {
    if (dir === "in") {
      /*
       * Verify the selfie against the enrolled face, when there is one and
       * the phone can run the model.
       *
       * A failure to *run* is not a failure to match: no enrolment, an
       * unsupported device, or a reading the model could not take all leave
       * the verdict absent, and the check-in proceeds exactly as it did
       * before. Only an actual comparison that disagreed records
       * `verified: false`, which the supervisor sees — nobody is stopped at
       * the gate by a dusty lens.
       */
      let faceCheck: { verified: boolean; distance: number } | undefined;
      const enrolled = currentUser?.face?.descriptors;
      if (enrolled?.length) {
        const reading = await readFace(dataUrl);
        if (reading) {
          const m = matchAgainst(reading.descriptor, enrolled);
          faceCheck = { verified: m.matched, distance: Number(m.distance.toFixed(4)) };
        }
      }
      const res = checkIn(dataUrl, faceCheck);
      if (!res.ok) {
        setFlow({ step: "blocked", reason: res.reason ?? "Check-in failed." });
        return;
      }
      setFlow({ step: "done-in", at: Date.now() });
    } else {
      // The selfie is captured first, then the day is reviewed — summary,
      // optional voice note — and only "Check Out" on that sheet closes it.
      setVoiceNote(null);
      setFlow({ step: "review", selfie: dataUrl });
    }
  };

  const confirmCheckOut = (selfie: string) => {
    const inAt = openShift?.checkIn?.at ?? Date.now();
    const dist = openShift?.distanceMeters ?? 0;
    const res = checkOut(selfie, voiceNote ? { voiceNote } : undefined);
    if (!res.ok) {
      setFlow({ step: "blocked", reason: res.reason ?? "Checkout failed." });
      return;
    }
    const outAt = Date.now();
    setVoiceNote(null);
    setFlow({
      step: "done-out",
      at: outAt,
      summary: {
        inAt,
        outAt,
        minutes: Math.round((outAt - inAt) / 60000),
        distance: dist,
      },
    });
  };

  const markers: MapMarker[] = [];
  if (fix) {
    markers.push({
      id: "me",
      coords: fix.coords,
      kind: "worker",
      hue: currentUser.avatarHue,
      initials: initialsOf(currentUser.name),
      label: openShift ? place : undefined,
      pulse: !!openShift,
    });
  }
  if (openShift?.checkIn) {
    markers.push({
      id: "start",
      coords: openShift.checkIn.coords,
      kind: "point",
      color: "var(--wf-green)",
      label: `In ${fmtTime(openShift.checkIn.at)}`,
    });
  }

  /* ------------------------------------------------------- active shift */
  if (openShift?.checkIn) {
    const onBreak = !!openBreak;
    const breakMinutes = liveMetrics?.breaks.totalMinutes ?? 0;
    const workingMinutes = liveMetrics
      ? liveMetrics.netMinutes
      : (now - openShift.checkIn.at) / 60000;
    const otMinutes = liveMetrics?.overtimeMinutes ?? 0;
    return (
      <div className="flex flex-col gap-4 px-4 pt-4">
        <FaceSetupCard />
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Avatar
              name={currentUser.name}
              hue={currentUser.avatarHue}
              size={42}
              ring={onBreak ? "amber" : "green"}
            />
            <div>
              <p
                className="text-[0.72rem] font-bold uppercase tracking-wider"
                style={{ color: onBreak ? "var(--wf-amber)" : "var(--wf-green)" }}
              >
                {onBreak ? "On break" : "Shift active"}
              </p>
              <h1 className="wf-display text-lg leading-tight">
                {project.name}
              </h1>
            </div>
          </div>
          <NotificationBell role="employee" />
        </div>

        {/* the shift this day is measured against */}
        {shiftDef ? (
          <div className="wf-card2 flex items-center justify-between px-4 py-3">
            <div>
              <p className="text-[0.64rem] font-bold uppercase tracking-[0.09em] text-[var(--wf-muted)]">
                {shiftDef.name}
              </p>
              <p className="text-[0.95rem] font-semibold tabular-nums">
                {shiftDef.kind === "flexible"
                  ? `${Math.round(shiftDef.requiredMinutes / 60)} working hours`
                  : `${fmtShiftTime(shiftDef.startMinute)} – ${fmtShiftTime(shiftDef.endMinute)}`}
              </p>
            </div>
            {onBreak ? (
              <div className="text-right">
                <p className="text-[0.64rem] font-bold uppercase tracking-wider text-[var(--wf-amber)]">
                  Break
                </p>
                <p className="text-[0.95rem] font-semibold tabular-nums">
                  Started {fmtTime(openBreak!.start)}
                </p>
              </div>
            ) : (
              <div className="text-right">
                <p className="text-[0.64rem] font-bold uppercase tracking-wider text-[var(--wf-muted)]">
                  Checked in
                </p>
                <p className="text-[0.95rem] font-semibold tabular-nums">
                  {fmtTime(openShift.checkIn.at)}
                </p>
              </div>
            )}
          </div>
        ) : null}

        <SiteMap
          project={project}
          trail={liveTrail.map((p) => ({ lat: p.lat, lng: p.lng, at: p.at, segmentStart: p.segmentStart }))}
          markers={markers}
          follow={fix?.coords ?? null}
          accuracy={fix?.accuracy}
          heightClass="h-[300px]"
        />

        <div className="grid grid-cols-3 gap-2.5">
          <ShiftStat
            label="Working"
            value={fmtDuration(workingMinutes)}
            tone="var(--wf-green)"
          />
          <ShiftStat
            label="Break"
            value={fmtDuration(breakMinutes)}
            tone={onBreak ? "var(--wf-amber)" : "var(--wf-fg)"}
          />
          <ShiftStat
            label="Overtime"
            value={otMinutes > 0 ? fmtDuration(otMinutes) : "—"}
            tone={otMinutes > 0 ? "var(--wf-blue)" : "var(--wf-faint)"}
          />
        </div>

        <div className="wf-card2 flex items-center gap-2.5 px-3.5 py-2.5">
          <IMapPin size={16} className="shrink-0 text-[var(--wf-blue)]" />
          <div className="min-w-0 flex-1">
            <p className="text-[0.66rem] font-bold uppercase tracking-wider text-[var(--wf-muted)]">
              Current location
            </p>
            <p className="truncate text-[0.92rem] font-semibold">{place}</p>
          </div>
          {fix?.degraded ? (
            <Chip tone="amber">GPS weak</Chip>
          ) : offsiteOnly ? (
            // What matters here is not where they are but whether the app is
            // writing a trail — that is the whole promise of this policy.
            <Chip tone={recording ? "amber" : "green"}>
              {recording ? "Recording" : "Not recording"}
            </Chip>
          ) : fence && !fence.inside ? (
            <Chip tone="red">Off site</Chip>
          ) : (
            <Chip tone="green">On site</Chip>
          )}
        </div>

        {offsiteOnly ? (
          <OffsitePolicyNote
            recording={recording}
            atPremise={atPremise}
            nearest={nearest}
          />
        ) : fence && !fence.inside ? (
          <div className="wf-inset flex items-start gap-2.5 border-[var(--wf-amber-edge)] px-3.5 py-3 text-[0.8rem] leading-snug text-[var(--wf-amber-hi)]">
            <IAlert size={16} className="mt-0.5 shrink-0" />
            You&apos;ve left the site boundary. Your shift stays open and the exit has
            been recorded — return to the site or check out when done.
          </div>
        ) : null}

        <SimulatedLocationControls value={simScenario} onChange={setSimScenario} onShift />

        {travelEnabled ? (
          activeTravel ? (
            <div className="wf-card2 flex items-center gap-3 px-3.5 py-3">
              <span className="wf-pulse-dot shrink-0" style={{ background: "var(--wf-blue)" }} />
              <div className="min-w-0 flex-1">
                <p className="text-[0.66rem] font-bold uppercase tracking-wider text-[var(--wf-blue)]">
                  Travel tracking active
                </p>
                <p className="truncate text-[0.88rem] font-semibold">
                  {activeTravel.purpose} · {fmtKmLabel(liveTravelMeters)}
                </p>
              </div>
              <button
                className="wf-btn wf-btn-primary wf-btn-sm"
                onClick={() => {
                  setTravelError(null);
                  const res = endTravel();
                  if (!res.ok) setTravelError(res.reason ?? "Couldn't end travel.");
                }}
              >
                End travel
              </button>
            </div>
          ) : (
            <button
              className="wf-btn wf-btn-ghost"
              onClick={() => {
                setTravelError(null);
                setTravelSheet(true);
              }}
            >
              <INav size={16} /> Start Travel — material run, client visit…
            </button>
          )
        ) : null}

        {travelError ? (
          <p
            role="alert"
            className="rounded-xl bg-[var(--wf-red-soft)] px-3 py-2 text-[0.78rem] text-[var(--wf-red)]"
          >
            {travelError}
          </p>
        ) : null}

        {breakError ? (
          <p
            role="alert"
            className="rounded-xl bg-[var(--wf-red-soft)] px-3 py-2 text-[0.78rem] text-[var(--wf-red)]"
          >
            {breakError}
          </p>
        ) : null}

        <div className="grid grid-cols-2 gap-2.5">
          {breaksEnabled ? (
            onBreak ? (
              <button
                className="wf-btn wf-btn-success flex-col gap-1 py-3 text-[0.72rem]"
                onClick={() => {
                  setBreakError(null);
                  const res = endBreak();
                  if (!res.ok) setBreakError(res.reason ?? "Couldn't end the break.");
                }}
              >
                <IClock size={19} /> End break
              </button>
            ) : (
              <button
                className="wf-btn wf-btn-ghost flex-col gap-1 py-3 text-[0.72rem]"
                onClick={() => {
                  setBreakError(null);
                  const res = startBreak();
                  if (!res.ok) setBreakError(res.reason ?? "Couldn't start a break.");
                }}
              >
                <ICoffee size={19} /> Start break
              </button>
            )
          ) : (
            <Link href="/employee/history" className="wf-btn wf-btn-ghost flex-col gap-1 py-3 text-[0.72rem]">
              <IRoute size={19} /> View route
            </Link>
          )}
          <button
            className="wf-btn wf-btn-ghost flex-col gap-1 py-3 text-[0.72rem]"
            onClick={() => setUpdateSheet(true)}
          >
            <IClipboard size={19} /> Work update
          </button>
          {breaksEnabled ? (
            <Link href="/employee/history" className="wf-btn wf-btn-ghost flex-col gap-1 py-3 text-[0.72rem]">
              <IRoute size={19} /> View shift
            </Link>
          ) : null}
          <button
            className={`wf-btn wf-btn-danger flex-col gap-1 py-3 text-[0.72rem] ${breaksEnabled ? "" : "col-span-2"}`}
            disabled={!canCheckOut || onBreak}
            title={
              onBreak
                ? "End your break before checking out"
                : canCheckOut
                  ? undefined
                  : "Checkout is only accepted at one of your sites or the office"
            }
            onClick={startCheckOut}
          >
            <ICamera size={19} /> Check out
          </button>
        </div>

        <FlowSheets
          flow={flow}
          setFlow={setFlow}
          onSelfie={completeSelfie}
          projectName={project.name}
        />

        {/* checkout review: summary → optional voice note → Check Out */}
        <BottomSheet
          open={flow?.step === "review"}
          onClose={() => setFlow(null)}
          title="Today's Shift Summary"
          tall
        >
          {flow?.step === "review" && (
            <div className="flex flex-col gap-4">
              <div className="wf-card2 divide-y divide-[var(--wf-line)]">
                {(
                  [
                    [
                      "Shift",
                      shiftDef
                        ? shiftDef.kind === "flexible"
                          ? `${Math.round(shiftDef.requiredMinutes / 60)} working hours`
                          : `${fmtShiftTime(shiftDef.startMinute)} – ${fmtShiftTime(shiftDef.endMinute)}`
                        : "—",
                    ],
                    ["Check-in", fmtTime(openShift.checkIn.at)],
                    ["Check-out", fmtTime(now)],
                    ["Break", fmtDuration(breakMinutes)],
                    ["Working", fmtDuration(workingMinutes)],
                    ["Overtime", otMinutes > 0 ? fmtDuration(otMinutes) : "—"],
                    [
                      "Work updates",
                      String(
                        state.updates.filter((u) => u.attendanceId === openShift.id)
                          .length,
                      ),
                    ],
                    ["Distance", fmtDistance(openShift.distanceMeters)],
                    ...(allowances && allowances.travel.length > 0
                      ? ([
                          ["Travel", fmtKmLabel(allowances.travelMeters)],
                          [
                            "Petrol allowance",
                            allowances.travelAmount > 0
                              ? `₹${allowances.travelAmount.toLocaleString("en-IN")}`
                              : allowances.pending > 0
                                ? "Pending approval"
                                : "—",
                          ],
                        ] as Array<[string, string]>)
                      : []),
                    ...(allowances && allowances.food.some((f) => f.eligible)
                      ? ([
                          [
                            "Food allowance",
                            allowances.foodAmount > 0
                              ? `₹${allowances.foodAmount.toLocaleString("en-IN")}`
                              : "Pending approval",
                          ],
                        ] as Array<[string, string]>)
                      : []),
                    ...(allowances && allowances.total > 0
                      ? ([
                          [
                            "Total allowances",
                            `₹${allowances.total.toLocaleString("en-IN")}`,
                          ],
                        ] as Array<[string, string]>)
                      : []),
                  ] as Array<[string, string]>
                ).map(([label, value]) => (
                  <div
                    key={label}
                    className="flex items-center justify-between px-4 py-2.5"
                  >
                    <span className="text-[0.8rem] text-[var(--wf-muted)]">{label}</span>
                    <span className="text-[0.88rem] font-semibold tabular-nums">
                      {value}
                    </span>
                  </div>
                ))}
              </div>

              {voiceEnabled ? (
                <div>
                  <p className="mb-2 text-[0.86rem] font-semibold">
                    Anything to add about today&apos;s work?
                  </p>
                  <VoiceRecorder value={voiceNote} onChange={setVoiceNote} />
                </div>
              ) : null}

              <button
                className="wf-btn wf-btn-primary wf-btn-lg"
                onClick={() => confirmCheckOut(flow.selfie)}
              >
                Check Out
              </button>
              <p className="text-center text-[0.72rem] text-[var(--wf-muted)]">
                You&apos;ll be asked for a short work summary after checkout.
              </p>
            </div>
          )}
        </BottomSheet>

        <BottomSheet
          open={travelSheet}
          onClose={() => setTravelSheet(false)}
          title="Start Travel"
          tall
        >
          <div className="flex flex-col gap-4">
            <div className="wf-card2 flex items-center gap-3 px-4 py-3">
              <IMapPin size={18} className="shrink-0 text-[var(--wf-blue)]" />
              <div className="min-w-0 flex-1">
                <p className="text-[0.66rem] font-bold uppercase tracking-wider text-[var(--wf-muted)]">
                  Current location
                </p>
                <p className="truncate text-[0.92rem] font-semibold">{place}</p>
                <p className="text-[0.7rem] tabular-nums text-[var(--wf-muted)]">
                  {fmtTime(now)} · GPS ±{fix ? Math.round(fix.accuracy) : "—"}m
                </p>
              </div>
            </div>

            <div>
              <p className="mb-2 text-[0.8rem] font-medium text-[var(--wf-muted)]">
                Travel purpose
              </p>
              <div className="flex flex-wrap gap-2">
                {TRAVEL_PURPOSES.map((purpose) => (
                  <button
                    key={purpose}
                    className="wf-btn wf-btn-sm"
                    style={{
                      background:
                        travelPurpose === purpose
                          ? "var(--wf-amber)"
                          : "var(--wf-fill-3)",
                      color:
                        travelPurpose === purpose
                          ? "var(--wf-on-amber)"
                          : "var(--wf-fg)",
                    }}
                    onClick={() => setTravelPurpose(purpose)}
                  >
                    {purpose}
                  </button>
                ))}
              </div>
            </div>

            <input
              className="wf-input"
              placeholder="Purpose / notes (optional)"
              value={travelNote}
              onChange={(e) => setTravelNote(e.target.value)}
            />

            <p className="text-[0.74rem] leading-relaxed text-[var(--wf-muted)]">
              Your route is recorded from here until you end the travel — this
              run, nothing else. Distance and allowance are worked out for you.
            </p>

            <button
              className="wf-btn wf-btn-primary wf-btn-lg"
              onClick={() => {
                const res = startTravel(travelPurpose, travelNote);
                if (!res.ok) {
                  setTravelError(res.reason ?? "Couldn't start travel.");
                } else {
                  setTravelNote("");
                }
                setTravelSheet(false);
              }}
            >
              <INav size={17} /> Start Travel
            </button>
          </div>
        </BottomSheet>

        <BottomSheet open={updateSheet} onClose={() => setUpdateSheet(false)} title="Add work update" tall>
          <WorkUpdateForm kind="shift" onDone={() => setUpdateSheet(false)} />
        </BottomSheet>
      </div>
    );
  }

  /* --------------------------------------------------------- pre-shift */
  const todayRec = state.attendance.find(
    (a) =>
      a.employeeId === currentUser.id &&
      a.checkIn &&
      a.date === todayISO(now),
  );

  return (
    <div className="flex flex-col gap-4 px-4 pt-4">
      <FaceSetupCard />
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[0.8rem] text-[var(--wf-muted)]">{greeting},</p>
          <h1 className="wf-display text-[1.45rem] leading-tight">
            {currentUser.name.split(" ")[0]}
          </h1>
        </div>
        <NotificationBell role="employee" />
      </div>

      {/* project card */}
      <div className="wf-card overflow-hidden">
        <div className="flex items-start justify-between gap-3 p-4 pb-3">
          <div className="min-w-0">
            <p className="text-[0.68rem] font-bold uppercase tracking-[0.09em] text-[var(--wf-muted)]">
              Assigned project
            </p>
            <h2 className="wf-display mt-0.5 truncate text-[1.15rem]">
              {project.name}
            </h2>
            <p className="mt-0.5 flex min-w-0 items-center gap-1 text-[0.76rem] text-[var(--wf-muted)]">
              <IMapPin size={12} className="shrink-0" />
              <span className="truncate">{project.address}</span>
            </p>
            {offsiteOnly && (
              <p className="mt-1.5 flex min-w-0 items-center gap-1 text-[0.72rem] font-semibold text-[var(--wf-green)]">
                <IShield size={12} className="shrink-0" />
                <span className="truncate">On-site movement isn&apos;t tracked</span>
              </p>
            )}
          </div>
          {todayRec?.checkOut ? (
            <StatusChip status="present" label="Done today" />
          ) : (
            <StatusChip status="not-in" label="Not checked in" />
          )}
        </div>
        {currentUser.projectIds.length > 1 && (
          <div className="px-4 pb-3">
            <Segmented
              size="sm"
              ariaLabel="Choose project"
              value={project.id}
              onChange={(id) => setActiveProject(id)}
              options={currentUser.projectIds
                .map((pid) => state.projects.find((p) => p.id === pid))
                .filter((p): p is NonNullable<typeof p> => !!p)
                .map((p) => ({ value: p.id, label: p.name.split(" ")[0] }))}
            />
          </div>
        )}
        <SiteMap
          project={project}
          markers={markers}
          heightClass="h-56 rounded-none border-x-0 border-b-0"
          accuracy={fix?.accuracy}
        />
        <div className="flex items-center gap-3 border-t border-[var(--wf-line)] p-4">
          <span
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl"
            style={{
              background: fence?.inside
                ? "var(--wf-green-soft)"
                : "var(--wf-amber-soft)",
              color: fence?.inside ? "var(--wf-green)" : "var(--wf-amber)",
            }}
          >
            {fence?.inside ? <ICheckCircle size={20} /> : <INav size={20} />}
          </span>
          <div className="min-w-0 flex-1">
            {!fix ? (
              <p className="text-sm font-semibold">Getting your location…</p>
            ) : fence?.inside ? (
              <>
                <p className="text-sm font-bold text-[var(--wf-green)]">
                  You&apos;re inside the site boundary
                </p>
                <p className="text-[0.74rem] text-[var(--wf-muted)]">
                  Near {place} · GPS ±{Math.round(fix.accuracy)}m
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-bold">
                  You are {distance != null ? fmtDistance(distance) : "—"} away from the site
                </p>
                <p className="text-[0.74rem] text-[var(--wf-muted)]">
                  Move inside the site boundary to check in
                </p>
              </>
            )}
          </div>
          {fix?.degraded && <Chip tone="amber">GPS weak</Chip>}
        </div>
      </div>

      {/* shift info */}
      <div className="wf-card2 flex items-center justify-between px-4 py-3">
        <div>
          <p className="text-[0.66rem] font-bold uppercase tracking-wider text-[var(--wf-muted)]">
            {shiftDef ? shiftDef.name : "Today's shift"}
          </p>
          <p className="text-[0.95rem] font-semibold tabular-nums">
            {shiftDef
              ? shiftDef.kind === "flexible"
                ? `${Math.round(shiftDef.requiredMinutes / 60)} working hours`
                : `${fmtShiftTime(shiftDef.startMinute)} — ${fmtShiftTime(shiftDef.endMinute)}`
              : `${fmtShiftTime(project.rules.shiftStart)} — ${fmtShiftTime(project.rules.shiftEnd)}`}
          </p>
        </div>
        {todayRec?.checkIn ? (
          <div className="text-right">
            <p className="text-[0.66rem] font-bold uppercase tracking-wider text-[var(--wf-muted)]">
              Worked today
            </p>
            <p className="text-[0.95rem] font-semibold tabular-nums text-[var(--wf-green)]">
              {todayRec.workedMinutes != null ? fmtDuration(todayRec.workedMinutes) : "—"}
            </p>
          </div>
        ) : (
          <Chip tone="blue">{fmtTime(now)}</Chip>
        )}
      </div>

      <SimulatedLocationControls value={simScenario} onChange={setSimScenario} />

      <button
        className="wf-btn wf-btn-lg wf-btn-primary sticky bottom-3 shadow-2xl"
        disabled={!canCheckIn}
        onClick={startCheckIn}
      >
        <ICamera size={20} />
        {todayRec?.checkOut ? "Check in again" : "Check In"}
        {!canCheckIn && fix ? " — move inside site" : ""}
      </button>

      <FlowSheets
        flow={flow}
        setFlow={setFlow}
        onSelfie={completeSelfie}
        projectName={project.name}
      />
    </div>
  );
}

/* ------------------------------------------------------------- pieces */

/**
 * The whole `outside-only` policy, said plainly to the person it applies to.
 *
 * Two facts matter to a worker on this policy and neither is obvious from a
 * map: whether their location is being written down right now, and where they
 * are allowed to end the day. Leaving either to be inferred is how a worker
 * ends up stranded at 6pm unable to close a shift.
 */
function OffsitePolicyNote({
  recording,
  atPremise,
  nearest,
}: {
  recording: boolean;
  atPremise: Project | null;
  nearest: PremiseFix | null;
}) {
  if (!recording) {
    return (
      <div className="wf-inset flex items-start gap-2.5 border-[var(--wf-green-edge)] px-3.5 py-3 text-[0.8rem] leading-snug">
        <IShield size={16} className="mt-0.5 shrink-0 text-[var(--wf-green)]" />
        <span className="min-w-0">
          <span className="font-semibold text-[var(--wf-green)]">
            Your location isn&apos;t being recorded.
          </span>{" "}
          <span className="text-[var(--wf-muted)]">
            On this project only trips away from the boundary are tracked.
            Recording starts if you leave{atPremise ? ` ${atPremise.name}` : ""}.
          </span>
        </span>
      </div>
    );
  }
  return (
    <div className="wf-inset flex items-start gap-2.5 border-[var(--wf-amber-edge)] px-3.5 py-3 text-[0.8rem] leading-snug">
      <IRoute size={16} className="mt-0.5 shrink-0 text-[var(--wf-amber)]" />
      <span className="min-w-0">
        <span className="font-semibold text-[var(--wf-amber-hi)]">
          You&apos;re off site — your route is being recorded.
        </span>{" "}
        <span className="text-[var(--wf-muted)]">
          {nearest
            ? `Recording stops when you get back. Check out at a site or the office — nearest is ${nearest.premise.name}, ${fmtDistance(nearest.distance)} away.`
            : "Recording stops when you get back. Check out at a site or the office."}
        </span>
      </span>
    </div>
  );
}


function ShiftStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  tone: string;
}) {
  return (
    <div className="wf-card2 px-2 py-3 text-center">
      <div className="wf-display text-[1.02rem] tabular-nums" style={{ color: tone }}>
        {value}
      </div>
      <div className="mt-0.5 text-[0.6rem] font-bold uppercase tracking-[0.07em] text-[var(--wf-faint)]">
        {label}
      </div>
    </div>
  );
}

/**
 * The simulator's controls, shown only while Settings has GPS set to
 * simulated. It is not a demo prop: a foreman setting the app up from an
 * office, or a worker checking the boundary is drawn where they think it is,
 * needs to move without driving to the site.
 */
function SimulatedLocationControls({
  value,
  onChange,
  onShift,
}: {
  value: SimScenario;
  onChange: (s: SimScenario) => void;
  onShift?: boolean;
}) {
  const { state } = useWorkforce();
  if (state.settings.locationSource === "device") return null;
  return (
    <div className="wf-inset px-3.5 py-3">
      <p className="mb-2 flex items-center gap-1.5 text-[0.66rem] font-bold uppercase tracking-wider text-[var(--wf-faint)]">
        <ICrosshair size={12} /> Simulated GPS — walk around your site
      </p>
      <Segmented
        size="sm"
        ariaLabel="Simulated location scenario"
        value={onShift && value !== "wander-out" ? "onsite" : value}
        onChange={onChange}
        options={
          onShift
            ? [
                { value: "onsite", label: "Roam site" },
                { value: "wander-out", label: "Walk off site" },
              ]
            : [
                { value: "outside", label: "Stay away" },
                { value: "approach", label: "Walk to gate" },
                { value: "onsite", label: "Jump on site" },
              ]
        }
      />
    </div>
  );
}

function FlowSheets({
  flow,
  setFlow,
  onSelfie,
  projectName,
}: {
  flow: Flow;
  setFlow: (f: Flow) => void;
  onSelfie: (dir: "in" | "out", dataUrl: string) => void;
  projectName: string;
}) {
  return (
    <>
      {/* validating */}
      <BottomSheet
        open={flow?.step === "validating"}
        onClose={() => setFlow(null)}
        title="Verifying location"
      >
        <div className="flex flex-col items-center gap-4 py-6">
          <div className="h-11 w-11 animate-spin rounded-full border-[3px] border-white/10 border-t-[var(--wf-amber)]" />
          <div className="text-center">
            <p className="font-semibold">Checking GPS & geofence…</p>
            <p className="mt-1 text-sm text-[var(--wf-muted)]">
              Confirming you&apos;re {flow?.step === "validating" && flow.dir === "out" ? "on record" : "inside the site boundary"}
            </p>
          </div>
        </div>
      </BottomSheet>

      {/* blocked */}
      <BottomSheet
        open={flow?.step === "blocked"}
        onClose={() => setFlow(null)}
        title="Can't continue"
      >
        <div className="flex flex-col items-center gap-4 py-4 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-full bg-[var(--wf-red-soft)] text-[var(--wf-red)]">
            <IAlert size={28} />
          </span>
          <p className="max-w-xs text-[0.95rem] leading-relaxed">
            {flow?.step === "blocked" ? flow.reason : ""}
          </p>
          <button className="wf-btn wf-btn-primary w-full" onClick={() => setFlow(null)}>
            Got it
          </button>
        </div>
      </BottomSheet>

      {/* selfie */}
      <BottomSheet
        open={flow?.step === "selfie"}
        onClose={() => setFlow(null)}
        title={flow?.step === "selfie" && flow.dir === "out" ? "Checkout selfie" : "Check-in selfie"}
        tall
      >
        {flow?.step === "selfie" && (
          <SelfieCapture
            label={flow.dir === "out" ? "Checkout" : "Check-in"}
            onCapture={(url) => onSelfie(flow.dir, url)}
            onCancel={() => setFlow(null)}
          />
        )}
      </BottomSheet>

      {/* success: check-in */}
      <BottomSheet open={flow?.step === "done-in"} onClose={() => setFlow(null)}>
        <div className="flex flex-col items-center gap-4 py-4 text-center">
          <span className="wf-pop-in grid h-16 w-16 place-items-center rounded-full bg-[var(--wf-green-soft)] text-[var(--wf-green)]">
            <ICheckCircle size={34} />
          </span>
          <div>
            <h3 className="wf-display text-xl">Check-in successful</h3>
            <p className="mt-1 text-sm text-[var(--wf-muted)]">
              {flow?.step === "done-in" ? fmtTime(flow.at) : ""} · {projectName}
            </p>
          </div>
          <div className="wf-inset flex w-full items-center justify-center gap-2 px-3 py-2.5 text-[0.78rem] font-bold text-[var(--wf-green)]">
            <span className="wf-pulse-dot" style={{ background: "var(--wf-red)", width: 8, height: 8 }} />
            Live location tracking started
          </div>
          <button className="wf-btn wf-btn-primary w-full" onClick={() => setFlow(null)}>
            Start working
          </button>
        </div>
      </BottomSheet>

      {/* success: checkout */}
      <BottomSheet
        open={flow?.step === "done-out"}
        onClose={() => setFlow({ step: "daily-update" })}
      >
        {flow?.step === "done-out" && (
          <div className="flex flex-col items-center gap-4 py-4 text-center">
            <span className="wf-pop-in grid h-16 w-16 place-items-center rounded-full bg-[var(--wf-green-soft)] text-[var(--wf-green)]">
              <ICheckCircle size={34} />
            </span>
            <div>
              <h3 className="wf-display text-xl">Checkout successful</h3>
              <p className="mt-1 text-sm tabular-nums text-[var(--wf-muted)]">
                {fmtTime(flow.summary.inAt)} — {fmtTime(flow.summary.outAt)}
              </p>
            </div>
            <div className="grid w-full grid-cols-2 gap-2.5">
              <div className="wf-card2 px-3 py-3">
                <div className="wf-display text-lg text-[var(--wf-green)]">
                  {fmtDuration(flow.summary.minutes)}
                </div>
                <div className="text-[0.62rem] font-bold uppercase tracking-wider text-[var(--wf-faint)]">
                  worked
                </div>
              </div>
              <div className="wf-card2 px-3 py-3">
                <div className="wf-display text-lg text-[var(--wf-blue)]">
                  {fmtDistance(flow.summary.distance)}
                </div>
                <div className="text-[0.62rem] font-bold uppercase tracking-wider text-[var(--wf-faint)]">
                  travelled
                </div>
              </div>
            </div>
            <p className="text-[0.74rem] text-[var(--wf-muted)]">
              Tracking stopped. Your route has been saved.
            </p>
            <button
              className="wf-btn wf-btn-primary w-full"
              onClick={() => setFlow({ step: "daily-update" })}
            >
              Add today&apos;s work update
            </button>
          </div>
        )}
      </BottomSheet>

      {/* daily update after checkout */}
      <BottomSheet
        open={flow?.step === "daily-update"}
        onClose={() => setFlow(null)}
        title="What did you work on today?"
        tall
      >
        <WorkUpdateForm
          kind="daily"
          onDone={() => setFlow(null)}
          onSkip={() => setFlow(null)}
        />
      </BottomSheet>
    </>
  );
}
