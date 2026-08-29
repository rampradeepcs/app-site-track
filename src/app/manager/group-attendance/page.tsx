"use client";

/**
 * Group attendance for a labour team.
 *
 * The queue at a site gate is the problem this solves: forty men, one
 * phone, and a supervisor who wants to start work. One photograph of the
 * gang replaces forty check-ins.
 *
 * What it must never become is a button that marks forty people present.
 * So the flow is deliberately shaped around a review the supervisor cannot
 * skip: the software detects faces, proposes who they are with a distance
 * attached, and writes nothing until a person confirms. Detection and
 * identification are shown as separate claims throughout, because they are
 * separate claims — a found face is not a known man.
 *
 * The geofence check is the other half. A capture from the car park at
 * seven in the morning and a capture from home are different records, and
 * the flow says which one it is before the photo is even taken.
 */

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useRef, useState } from "react";
import { ScreenHeader } from "@/components/shell";
import { Avatar, BottomSheet, Chip, useNowTick } from "@/components/ui";
import { canCaptureGroupAttendance } from "@/lib/access";
import { checkGeofence } from "@/lib/geo";
import { likelySupported } from "@/lib/face/engine";
import { analysePhotos, type DetectedFace } from "@/lib/face/group";
import { activeMembers, teamsForProject } from "@/lib/teams";
import { useWorkforce } from "@/lib/store";
import { fmtTime, todayISO } from "@/lib/format";
import type { GeofenceCheck } from "@/lib/types";
import {
  ICamera,
  ICheck,
  IMapPin,
  IPlus,
  IRefresh,
  IX,
} from "@/components/WfIcons";

type Step = "setup" | "capture" | "review";

/** The reviewer's decision for one member of the gang. */
interface Decision {
  employeeId: string;
  detected: boolean;
  matched: boolean;
  lowConfidence: boolean;
  manual: boolean;
  present: boolean;
  touched: boolean;
  distance?: number;
  thumb?: string;
}

export default function GroupAttendancePage() {
  const params = useSearchParams();
  const router = useRouter();
  const { state, fix, submitGroupAttendance } = useWorkforce();
  const now = useNowTick(30);
  const fileRef = useRef<HTMLInputElement>(null);

  const [projectId, setProjectId] = useState(
    params.get("project") ?? state.activeProjectId ?? state.projects[0]?.id ?? "",
  );
  const [teamId, setTeamId] = useState(params.get("team") ?? "");
  const [shiftId, setShiftId] = useState("");
  const [step, setStep] = useState<Step>("setup");
  const [photos, setPhotos] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [faces, setFaces] = useState<DetectedFace[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [assigning, setAssigning] = useState<DetectedFace | null>(null);
  const [saved, setSaved] = useState<{ groupId: string; marked: number } | null>(null);

  const project = state.projects.find((p) => p.id === projectId);
  const teams = useMemo(() => teamsForProject(state, projectId), [state, projectId]);
  /* Deriving beats synchronising: switching project just invalidates the
     pick, with no effect writing state back and re-rendering to do it. */
  const selectedTeamId = teams.some((t) => t.id === teamId) ? teamId : "";
  const team = state.labourTeams.find((t) => t.id === selectedTeamId);

  const mayCapture = canCaptureGroupAttendance(state, state.session?.userId, projectId);

  /* The roster is the gang, not the project — the whole anti-proxy point. */
  const roster = useMemo(() => {
    if (!team) return [];
    const ids = activeMembers(state, team.id).map((m) => m.employeeId);
    return state.users.filter((u) => ids.includes(u.id));
  }, [state, team]);

  const enrolled = useMemo(
    () => roster.filter((u) => u.face?.descriptors?.length),
    [roster],
  );

  const alreadyIn = useMemo(() => {
    const today = todayISO(now);
    return new Set(
      state.attendance.filter((a) => a.date === today).map((a) => a.employeeId),
    );
  }, [state.attendance, now]);

  const geofence: GeofenceCheck = useMemo(() => {
    if (!fix || !project) return "unknown";
    return checkGeofence(fix.coords, project.geofence).inside ? "inside" : "outside";
  }, [fix, project]);

  /* ------------------------------------------------------------ capture */

  const addPhoto = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => setPhotos((p) => [...p, String(reader.result)]);
    reader.readAsDataURL(file);
  };

  const analyse = useCallback(async () => {
    if (photos.length === 0) return;
    setBusy(true);
    setError("");
    try {
      const { detected } = await analysePhotos(photos, enrolled);
      setFaces(detected);

      const byUser = new Map<string, DetectedFace>();
      for (const d of detected) if (d.userId) byUser.set(d.userId, d);

      setDecisions(
        roster.map((u) => {
          const hit = byUser.get(u.id);
          return {
            employeeId: u.id,
            detected: !!hit,
            matched: !!hit,
            lowConfidence: !!hit && hit.distance > 0.45,
            manual: false,
            /*
             * Proposed, not decided. A matched face is a strong proposal;
             * everyone else starts absent and has to be argued for.
             *
             * Except a worker who already checked in themselves: they are
             * demonstrably here, the toggle is disabled for them, and
             * recording them as absent on the capture would make the
             * evidence contradict the register it sits beside.
             */
            present: !!hit || alreadyIn.has(u.id),
            touched: false,
            distance: hit?.distance,
            thumb: hit?.thumb,
          };
        }),
      );
      setStep("review");
    } catch {
      setError("Face detection failed on this device. You can still mark the team by hand.");
      setDecisions(
        roster.map((u) => ({
          employeeId: u.id,
          detected: false,
          matched: false,
          lowConfidence: false,
          manual: false,
          present: alreadyIn.has(u.id),
          touched: false,
        })),
      );
      setStep("review");
    } finally {
      setBusy(false);
    }
  }, [photos, enrolled, roster, alreadyIn]);

  /* ------------------------------------------------------------- review */

  const toggle = (employeeId: string) =>
    setDecisions((ds) =>
      ds.map((d) =>
        d.employeeId === employeeId
          ? { ...d, present: !d.present, touched: true }
          : d,
      ),
    );

  const assignFaceTo = (face: DetectedFace, employeeId: string) => {
    setDecisions((ds) =>
      ds.map((d) =>
        d.employeeId === employeeId
          ? {
              ...d,
              detected: true,
              matched: false,
              manual: true,
              present: true,
              touched: true,
              thumb: face.thumb,
            }
          : d,
      ),
    );
    setFaces((fs) => fs.map((f) => (f === face ? { ...f, userId: employeeId } : f)));
    setAssigning(null);
  };

  const unassignedFaces = faces.filter(
    (f) => !f.userId || !decisions.some((d) => d.employeeId === f.userId),
  );

  const presentCount = decisions.filter((d) => d.present).length;
  const matchedCount = decisions.filter((d) => d.matched).length;
  const notDetected = decisions.filter((d) => !d.detected).length;

  const confirm = () => {
    if (!team) return;
    const res = submitGroupAttendance({
      projectId,
      teamId: team.id,
      shiftId: shiftId || team.shiftId,
      photos,
      coords: fix?.coords,
      geofenceStatus: geofence,
      faceCount: faces.length,
      members: decisions.map((d) => ({
        employeeId: d.employeeId,
        detectionStatus: d.detected ? "detected" : "not-detected",
        matchStatus: d.manual
          ? "manual"
          : d.matched
            ? d.lowConfidence
              ? "low-confidence"
              : "matched"
            : "unmatched",
        attendanceStatus: d.present ? "present" : "absent",
        reviewStatus: d.touched ? "corrected" : "confirmed",
        distance: d.distance,
      })),
    });
    if (res.ok && res.groupId) setSaved({ groupId: res.groupId, marked: res.marked });
    else setError(res.reason ?? "Could not save this capture.");
  };

  /* --------------------------------------------------------------- view */

  if (!mayCapture) {
    return (
      <div>
        <ScreenHeader back title="Group attendance" sub="Not permitted" />
        <p className="wf-card2 mx-4 px-4 py-8 text-center text-sm text-[var(--wf-muted)]">
          Group attendance can be taken by a project manager, a supervisor, or the
          site engineer named on a team for this project.
        </p>
      </div>
    );
  }

  return (
    <div>
      <ScreenHeader
        back
        title="Group attendance"
        sub={
          step === "setup"
            ? "Pick the gang and check you're on site"
            : step === "capture"
              ? `${team?.name ?? "Team"} · ${roster.length} expected`
              : `${presentCount} of ${roster.length} present`
        }
      />

      <div className="flex flex-col gap-3 px-4">
        <Steps step={step} />

        {step === "setup" ? (
          <>
            <label className="block">
              <span className="wf-label">Project</span>
              <select
                className="wf-input"
                value={projectId}
                onChange={(e) => {
                  setProjectId(e.target.value);
                  setTeamId("");
                }}
              >
                {state.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="wf-label">Labour team</span>
              <select
                className="wf-input"
                value={selectedTeamId}
                onChange={(e) => setTeamId(e.target.value)}
              >
                <option value="">Choose a team…</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} · {t.code}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="wf-label">Shift</span>
              <select
                className="wf-input"
                value={shiftId}
                onChange={(e) => setShiftId(e.target.value)}
              >
                <option value="">{team?.shiftId ? "Team default" : "Project default"}</option>
                {state.shifts.map((sh) => (
                  <option key={sh.id} value={sh.id}>
                    {sh.name}
                  </option>
                ))}
              </select>
            </label>

            <GeofenceBanner status={geofence} projectName={project?.name} />

            {team ? (
              <div className="wf-card2 px-3.5 py-3">
                <p className="text-[0.8rem] font-semibold">
                  {roster.length} expected · {enrolled.length} with a face on file
                </p>
                <p className="mt-1 text-[0.72rem] leading-relaxed text-[var(--wf-muted)]">
                  {enrolled.length < roster.length
                    ? `${roster.length - enrolled.length} of this gang have no enrolled face, so they can't be matched from a photo — you'll mark them by hand on the review screen.`
                    : "Everyone on this gang has a face on file."}
                </p>
              </div>
            ) : null}

            <button
              className="wf-btn wf-btn-primary wf-btn-lg"
              disabled={!team || roster.length === 0}
              onClick={() => setStep("capture")}
            >
              Continue
            </button>
          </>
        ) : null}

        {step === "capture" ? (
          <>
            <GeofenceBanner status={geofence} projectName={project?.name} />

            <div className="grid grid-cols-3 gap-2">
              {photos.map((p, i) => (
                <div key={i} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p} alt={`Group photo ${i + 1}`} className="h-24 w-full rounded-lg object-cover" />
                  <button
                    className="absolute right-1 top-1 grid h-6 w-6 cursor-pointer place-items-center rounded-full bg-[rgba(0,0,0,0.6)] text-white"
                    aria-label={`Remove photo ${i + 1}`}
                    onClick={() => setPhotos((ps) => ps.filter((_, k) => k !== i))}
                  >
                    <IX size={12} />
                  </button>
                </div>
              ))}
              <button
                className="wf-card2 grid h-24 cursor-pointer place-items-center text-[var(--wf-muted)]"
                onClick={() => fileRef.current?.click()}
              >
                <span className="flex flex-col items-center gap-1">
                  {photos.length ? <IPlus size={18} /> : <ICamera size={20} />}
                  <span className="text-[0.66rem]">
                    {photos.length ? "Add another" : "Take photo"}
                  </span>
                </span>
              </button>
            </div>

            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) addPhoto(f);
                e.target.value = "";
              }}
            />

            <p className="text-[0.72rem] leading-relaxed text-[var(--wf-muted)]">
              A large gang will not fit in one frame. Take as many photos as you
              need — anyone appearing twice is counted once.
            </p>

            {error ? (
              <p className="wf-inset px-3.5 py-3 text-[0.78rem] text-[var(--wf-warn)]">{error}</p>
            ) : null}

            {!likelySupported() ? (
              <p className="wf-inset px-3.5 py-3 text-[0.76rem] leading-snug text-[var(--wf-muted)]">
                This phone can&apos;t run face detection. You can still take the photo
                as evidence and mark the gang by hand on the next screen.
              </p>
            ) : null}

            <button
              className="wf-btn wf-btn-primary wf-btn-lg"
              disabled={photos.length === 0 || busy}
              onClick={() => void analyse()}
            >
              {busy ? "Detecting faces…" : `Detect faces in ${photos.length || ""} photo${photos.length === 1 ? "" : "s"}`}
            </button>
          </>
        ) : null}

        {step === "review" ? (
          <>
            <div className="wf-card2 flex flex-wrap items-center gap-x-4 gap-y-1 px-3.5 py-3">
              <span className="text-[0.82rem] font-semibold">{team?.name}</span>
              <span className="text-[0.74rem] text-[var(--wf-muted)]">
                {faces.length} faces detected
              </span>
              <span className="text-[0.74rem] text-[var(--wf-green)]">
                {matchedCount} matched
              </span>
              {notDetected > 0 ? (
                <span className="text-[0.74rem] text-[var(--wf-muted)]">
                  {notDetected} not detected
                </span>
              ) : null}
              <span className="ml-auto text-[0.66rem] tabular-nums text-[var(--wf-faint)]">
                {fmtTime(now)}
              </span>
            </div>

            {/*
             * The claim this screen is careful about. "Detected" is what the
             * software saw; "matched" is who it thinks that was; present is
             * what the supervisor says. Three different things.
             */}
            <p className="text-[0.7rem] leading-relaxed text-[var(--wf-faint)]">
              Face matching is a proposal, not proof of identity. Check each row
              before confirming — nothing is recorded until you do.
            </p>

            <div className="flex flex-col gap-2">
              {decisions.map((d) => {
                const u = state.users.find((x) => x.id === d.employeeId);
                if (!u) return null;
                const already = alreadyIn.has(u.id);
                return (
                  <div key={d.employeeId} className="wf-card2 flex items-center gap-3 px-3.5 py-2.5">
                    {d.thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={d.thumb} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
                    ) : (
                      <Avatar name={u.name} hue={u.avatarHue} size={40} />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[0.84rem] font-semibold">{u.name}</span>
                      <span className="block truncate text-[0.68rem] text-[var(--wf-muted)]">
                        {u.employeeCode} · {u.designation}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-1">
                        {already ? (
                          <Chip tone="blue">Already checked in</Chip>
                        ) : d.manual ? (
                          <Chip tone="amber">Placed by you</Chip>
                        ) : d.matched ? (
                          <Chip tone={d.lowConfidence ? "amber" : "green"}>
                            {d.lowConfidence ? "Low confidence" : "Matched"}
                          </Chip>
                        ) : (
                          <Chip tone="neutral">Not detected</Chip>
                        )}
                        {d.distance !== undefined && Number.isFinite(d.distance) ? (
                          <span className="text-[0.6rem] tabular-nums text-[var(--wf-faint)]">
                            d {d.distance.toFixed(2)}
                          </span>
                        ) : null}
                      </span>
                    </span>
                    <button
                      className={`wf-btn wf-btn-sm ${d.present ? "wf-btn-primary" : "wf-btn-ghost"}`}
                      onClick={() => toggle(d.employeeId)}
                      aria-pressed={d.present}
                      disabled={already}
                      title={already ? "This worker already has a day recorded today" : undefined}
                    >
                      {d.present ? <ICheck size={14} /> : null}
                      {already ? "In" : d.present ? "Present" : "Absent"}
                    </button>
                  </div>
                );
              })}
            </div>

            {unassignedFaces.length ? (
              <>
                <p className="mt-1 text-[0.66rem] font-bold uppercase tracking-wider text-[var(--wf-muted)]">
                  {unassignedFaces.length} face
                  {unassignedFaces.length === 1 ? "" : "s"} nobody could be put to
                </p>
                <div className="wf-scroll-x flex gap-2 pb-1">
                  {unassignedFaces.map((f, i) => (
                    <button
                      key={i}
                      className="shrink-0 cursor-pointer"
                      onClick={() => setAssigning(f)}
                      aria-label={`Assign face ${i + 1}`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={f.thumb} alt="" className="h-16 w-16 rounded-lg object-cover" />
                    </button>
                  ))}
                </div>
                <p className="text-[0.68rem] leading-snug text-[var(--wf-faint)]">
                  These could be workers from another gang, or visitors. Tap one to
                  place it against a member of this team.
                </p>
              </>
            ) : null}

            <div className="flex gap-2">
              <button
                className="wf-btn wf-btn-ghost flex-1"
                onClick={() => {
                  setStep("capture");
                  setFaces([]);
                }}
              >
                <IRefresh size={15} /> Retake
              </button>
              <button className="wf-btn wf-btn-primary flex-1" onClick={confirm}>
                <ICheck size={16} /> Confirm attendance
              </button>
            </div>

            {error ? (
              <p className="wf-inset px-3.5 py-3 text-[0.78rem] text-[var(--wf-red)]">{error}</p>
            ) : null}
          </>
        ) : null}
      </div>

      {/* place an unmatched face */}
      <BottomSheet
        open={!!assigning}
        onClose={() => setAssigning(null)}
        title="Who is this?"
      >
        {assigning ? (
          <div className="flex flex-col gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={assigning.thumb}
              alt=""
              className="mx-auto h-28 w-28 rounded-xl object-cover"
            />
            <p className="text-center text-[0.74rem] text-[var(--wf-muted)]">
              Only members of {team?.name} can be placed here.
            </p>
            {decisions
              .filter((d) => !d.detected)
              .map((d) => {
                const u = state.users.find((x) => x.id === d.employeeId);
                return u ? (
                  <button
                    key={u.id}
                    className="wf-card2 flex cursor-pointer items-center gap-3 px-3.5 py-2.5 text-left"
                    onClick={() => assignFaceTo(assigning, u.id)}
                  >
                    <Avatar name={u.name} hue={u.avatarHue} size={30} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[0.82rem] font-semibold">{u.name}</span>
                      <span className="block text-[0.68rem] text-[var(--wf-muted)]">
                        {u.employeeCode}
                      </span>
                    </span>
                  </button>
                ) : null;
              })}
            {decisions.every((d) => d.detected) ? (
              <p className="px-1 text-center text-[0.76rem] text-[var(--wf-muted)]">
                Everyone on this gang has already been placed.
              </p>
            ) : null}
          </div>
        ) : null}
      </BottomSheet>

      {/* done */}
      <BottomSheet
        open={!!saved}
        onClose={() => router.replace(`/manager/team?id=${selectedTeamId}`)}
        title="Attendance recorded"
      >
        {saved ? (
          <div className="flex flex-col gap-3">
            <div className="wf-card2 px-4 py-3">
              <p className="text-[1.1rem] font-bold tabular-nums">{saved.marked} marked present</p>
              <p className="mt-0.5 text-[0.74rem] text-[var(--wf-muted)]">
                {team?.name} · {saved.groupId}
              </p>
            </div>
            <p className="text-[0.76rem] leading-relaxed text-[var(--wf-muted)]">
              These are ordinary attendance records — they flow into the register,
              payroll and reports exactly like an individual check-in, and each one
              points back at this photograph.
            </p>
            <button
              className="wf-btn wf-btn-primary wf-btn-lg"
              onClick={() => router.replace(`/manager/team?id=${selectedTeamId}`)}
            >
              Back to {team?.name ?? "team"}
            </button>
          </div>
        ) : null}
      </BottomSheet>
    </div>
  );
}

function Steps({ step }: { step: Step }) {
  const order: Step[] = ["setup", "capture", "review"];
  const labels: Record<Step, string> = {
    setup: "Team",
    capture: "Photo",
    review: "Review",
  };
  const at = order.indexOf(step);
  return (
    <div className="flex items-center gap-1.5">
      {order.map((s, i) => (
        <div key={s} className="flex flex-1 items-center gap-1.5">
          <span
            className="h-1 flex-1 rounded-full"
            style={{
              background: i <= at ? "var(--wf-amber)" : "var(--wf-fill-2)",
            }}
          />
          <span
            className="text-[0.62rem] uppercase tracking-wider"
            style={{ color: i <= at ? "var(--wf-fg)" : "var(--wf-faint)" }}
          >
            {labels[s]}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Where the phone is, said plainly.
 *
 * Outside the fence does not block the capture — a gate can sit outside its
 * own geofence, and a supervisor with a job to do should not be stuck. It is
 * recorded on the capture instead, which is the honest outcome: the record
 * says where it was taken, and a manager can judge it.
 */
function GeofenceBanner({
  status,
  projectName,
}: {
  status: GeofenceCheck;
  projectName?: string;
}) {
  const tone =
    status === "inside"
      ? "var(--wf-green)"
      : status === "outside"
        ? "var(--wf-warn)"
        : "var(--wf-muted)";
  return (
    <div className="wf-inset flex items-start gap-2.5 px-3.5 py-3">
      <IMapPin size={15} style={{ color: tone }} className="mt-0.5 shrink-0" />
      <p className="text-[0.76rem] leading-snug">
        <span style={{ color: tone }} className="font-semibold">
          {status === "inside"
            ? `On site at ${projectName ?? "this project"}`
            : status === "outside"
              ? "Outside the project geofence"
              : "Site location not confirmed"}
        </span>
        <span className="block text-[var(--wf-muted)]">
          {status === "inside"
            ? "This capture will be recorded as taken on site."
            : status === "outside"
              ? "You can still record it — the capture will say it was taken off site."
              : "No GPS fix yet. The capture will record that location was unknown."}
        </span>
      </p>
    </div>
  );
}
