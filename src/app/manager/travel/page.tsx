"use client";

/**
 * Travel & Allowance — the manager's side of the module: today's travel
 * across the workforce, trips waiting on a decision (route, distance, GPS
 * confidence, adjust-and-approve), the petrol and food rules that price
 * everything, per-project travel switches, and the two §25 reports.
 *
 * Like payroll, nothing computed is stored: every figure on this screen is
 * recomputed from sessions, attendance and rules, and the only writes are
 * judgements and configuration.
 */

import { useMemo, useState } from "react";
import { FeatureGate, useFeature } from "@/components/FeatureGate";
import { ScreenHeader } from "@/components/shell";
import {
  Avatar,
  BottomSheet,
  Chip,
  EmptyState,
  Field,
  KpiCard,
  SectionTitle,
  Segmented,
} from "@/components/ui";
import { TripDetail } from "@/app/employee/travel/page";
import {
  VEHICLE_LABEL,
  dayAllowances,
  fmtKmLabel,
  fmtMinute,
  travelAllowance,
  travelAllowancesForDay,
  travelKpis,
  type TravelAllowance,
} from "@/lib/allowances";
import { fmtDateLong, fmtTime, todayISO } from "@/lib/format";
import { fmtINR } from "@/lib/payroll";
import { downloadCSV, toCSV } from "@/lib/reports";
import { useWorkforce } from "@/lib/store";
import {
  MEAL_TYPES,
  type FoodRule,
  type MealType,
  type PetrolRule,
  type VehicleType,
} from "@/lib/types";
import {
  ICheckCircle,
  ICoffee,
  IDownload,
  INav,
  IPlus,
  ITrash,
} from "@/components/WfIcons";

type Tab = "approvals" | "rules" | "reports";

const toHM = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const fromHM = (v: string, fallback: number) => {
  const [h, m] = v.split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : fallback;
};

export default function ManagerTravel() {
  const wf = useWorkforce();
  const { state } = wf;
  const [tab, setTab] = useState<Tab>("approvals");
  const [reviewing, setReviewing] = useState<TravelAllowance | null>(null);

  const kpis = useMemo(() => travelKpis(state), [state]);

  const pending = useMemo(
    () =>
      state.travelSessions
        .filter((t) => t.status === "pending")
        .sort((a, b) => b.start.at - a.start.at)
        .map((t) => travelAllowance(state, t)),
    [state],
  );

  return (
    <div>
      <ScreenHeader title="Travel & Allowance" sub="Work travel, petrol and food rules" />
      <div className="flex flex-col gap-4 px-4">
        <FeatureGate feature="petrolAllowance">
          {/* today, across the workforce (spec §13) */}
          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
            <KpiCard
              label="Today's travel"
              value={fmtKmLabel(kpis.meters)}
              tone="blue"
              icon={<INav size={16} />}
              sub={`${kpis.trips} trip${kpis.trips === 1 ? "" : "s"} · ${kpis.travelling} running`}
            />
            <KpiCard label="Eligible" value={fmtKmLabel(kpis.eligibleMeters)} sub="after caps" />
            <KpiCard
              label="Est. allowance"
              value={fmtINR(kpis.amount)}
              tone="green"
              sub="approved today"
            />
            <KpiCard
              label="Pending approvals"
              value={kpis.pendingApprovals}
              tone={kpis.pendingApprovals ? "amber" : "neutral"}
              sub={
                kpis.flagged
                  ? `${kpis.flagged} flagged`
                  : kpis.pendingApprovals
                    ? "GPS clean"
                    : "nothing waiting"
              }
            />
          </div>

          <Segmented<Tab>
            ariaLabel="Travel sections"
            value={tab}
            onChange={setTab}
            size="sm"
            options={[
              { value: "approvals", label: `Approvals${pending.length ? ` (${pending.length})` : ""}` },
              { value: "rules", label: "Rules & settings" },
              { value: "reports", label: "Reports" },
            ]}
          />

          {tab === "approvals" && (
            <ApprovalsTab pending={pending} onReview={setReviewing} />
          )}
          {tab === "rules" && <RulesTab />}
          {tab === "reports" && <ReportsTab />}
        </FeatureGate>
      </div>

      <BottomSheet
        open={!!reviewing}
        onClose={() => setReviewing(null)}
        title={reviewing ? `Review — ${reviewing.session.purpose}` : ""}
        tall
      >
        {reviewing ? (
          <ReviewSheet trip={reviewing} onDone={() => setReviewing(null)} />
        ) : null}
      </BottomSheet>
    </div>
  );
}

/* -------------------------------------------------------------- approvals */

function ApprovalsTab({
  pending,
  onReview,
}: {
  pending: TravelAllowance[];
  onReview: (t: TravelAllowance) => void;
}) {
  const { state } = useWorkforce();
  if (pending.length === 0) {
    return (
      <EmptyState
        icon={<ICheckCircle size={26} />}
        title="Nothing waiting"
        body="Trips that need a decision appear here with their route, distance and GPS confidence."
      />
    );
  }
  return (
    <div className="flex flex-col gap-2.5">
      {pending.map((trip) => {
        const user = state.users.find((u) => u.id === trip.session.employeeId);
        return (
          <button
            key={trip.session.id}
            className="wf-card flex w-full cursor-pointer items-center gap-3 p-3.5 text-left transition hover:border-[var(--wf-line-strong)]"
            onClick={() => onReview(trip)}
          >
            {user ? <Avatar name={user.name} hue={user.avatarHue} size={36} /> : null}
            {/* Who and how much own the top line; the route and the GPS
                verdict sit under it, so a full name never has to compete
                with a chip for the same 110 pixels. */}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[0.9rem] font-semibold">
                {user?.name} · {trip.session.purpose}
              </span>
              <span className="block truncate text-[0.72rem] tabular-nums text-[var(--wf-muted)]">
                {fmtDateLong(trip.session.date)} · {trip.session.start.name} →{" "}
                {trip.session.end?.name ?? "…"} · {fmtKmLabel(trip.meters)}
              </span>
              <span className="mt-1.5 flex">
                {trip.session.flags.length > 0 ? (
                  <Chip tone="amber">
                    {trip.session.flags.length} flag
                    {trip.session.flags.length === 1 ? "" : "s"}
                  </Chip>
                ) : (
                  <Chip tone="green">GPS clean</Chip>
                )}
              </span>
            </span>
            <span className="shrink-0 font-bold tabular-nums">{fmtINR(trip.amount)}</span>
          </button>
        );
      })}
    </div>
  );
}

function ReviewSheet({ trip, onDone }: { trip: TravelAllowance; onDone: () => void }) {
  const wf = useWorkforce();
  const { state } = wf;
  const user = state.users.find((u) => u.id === trip.session.employeeId);
  const [km, setKm] = useState(() => Number((trip.meters / 1000).toFixed(1)));
  const edited = Math.abs(km - trip.meters / 1000) > 0.05;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        {user ? <Avatar name={user.name} hue={user.avatarHue} size={38} /> : null}
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{user?.name}</p>
          <p className="text-[0.72rem] text-[var(--wf-muted)]">
            {VEHICLE_LABEL[trip.session.vehicleType]}
            {trip.rule ? ` · ₹${trip.rule.ratePerKm}/km (${trip.rule.name})` : " · no rule applies"}
          </p>
        </div>
        <Chip tone={trip.session.flags.length ? "amber" : "green"}>
          {trip.session.flags.length ? "Check GPS notes" : "GPS clean"}
        </Chip>
      </div>

      <TripDetail trip={trip}>
        <div className="flex items-center gap-2 border-t border-[var(--wf-line)] pt-4">
          <Field label="Approved distance (km)">
            <input
              className="wf-input wf-input-num shrink-0"
              type="number"
              min={0}
              step={0.1}
              value={km}
              onChange={(e) => setKm(Number(e.target.value) || 0)}
            />
          </Field>
          <div className="ml-auto flex gap-2 self-end">
            <button
              className="wf-btn wf-btn-success"
              onClick={() => {
                wf.decideTravel(
                  trip.session.id,
                  "approved",
                  edited ? km : undefined,
                  edited ? "Distance adjusted on approval" : undefined,
                );
                onDone();
              }}
            >
              Approve{edited ? ` ${km.toFixed(1)} km` : ""}
            </button>
            <button
              className="wf-btn wf-btn-ghost wf-btn-danger-text"
              onClick={() => {
                wf.decideTravel(trip.session.id, "rejected");
                onDone();
              }}
            >
              Reject
            </button>
          </div>
        </div>
      </TripDetail>
    </div>
  );
}

/* ------------------------------------------------------------------ rules */

function RulesTab() {
  const wf = useWorkforce();
  const { state } = wf;
  const foodOn = useFeature("foodAllowance");
  const [petrolSheet, setPetrolSheet] = useState<PetrolRule | "new" | null>(null);
  const [foodSheet, setFoodSheet] = useState<FoodRule | "new" | null>(null);

  const petrol = state.petrolRules.filter((r) => r.status === "active");
  const food = state.foodRules.filter((r) => r.status === "active");

  return (
    <div className="flex flex-col gap-5">
      {/* per-project travel switches — the §7 privacy dial */}
      <div>
        <SectionTitle>Travel tracking, per project</SectionTitle>
        <div className="wf-card wf-list overflow-hidden">
          {state.projects.map((p) => (
            <div key={p.id} className="wf-row">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[0.88rem] font-semibold">{p.name}</span>
                <span className="block text-[0.7rem] text-[var(--wf-muted)]">
                  On-site movement:{" "}
                  {p.trackingMode === "outside-only" ? "not recorded" : "recorded"} · travel:{" "}
                  {p.travelTracking ? "on" : "off"}
                </span>
              </span>
              <span
                className="wf-switch"
                data-on={!!p.travelTracking}
                role="switch"
                aria-checked={!!p.travelTracking}
                aria-label={`Travel tracking on ${p.name}`}
                tabIndex={0}
                onClick={() => wf.setProjectTravelTracking(p.id, !p.travelTracking)}
                onKeyDown={(e) =>
                  e.key === "Enter" && wf.setProjectTravelTracking(p.id, !p.travelTracking)
                }
              />
            </div>
          ))}
        </div>
      </div>

      {/* petrol rules (spec §9) */}
      <div>
        <SectionTitle
          action={
            <button className="wf-btn wf-btn-ghost wf-btn-sm" onClick={() => setPetrolSheet("new")}>
              <IPlus size={13} /> Rule
            </button>
          }
        >
          Petrol allowance rules
        </SectionTitle>
        {petrol.length === 0 ? (
          <p className="wf-card2 p-4 text-[0.8rem] text-[var(--wf-muted)]">
            No petrol rules yet — travel is measured but earns nothing until a
            rate exists.
          </p>
        ) : (
          <div className="wf-card wf-list overflow-hidden">
            {petrol.map((r) => (
              <div
                key={r.id}
                role="button"
                tabIndex={0}
                className="wf-row w-full cursor-pointer text-left hover:bg-[var(--wf-fill-3)]"
                onClick={() => setPetrolSheet(r)}
                onKeyDown={(e) => e.key === "Enter" && setPetrolSheet(r)}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[0.88rem] font-semibold">
                    {r.name} — ₹{r.ratePerKm}/km
                  </span>
                  <span className="block text-[0.7rem] text-[var(--wf-muted)]">
                    {VEHICLE_LABEL[r.vehicleType]}
                    {r.maxDailyKm !== null ? ` · max ${r.maxDailyKm} km/day` : ""}
                    {r.maxDailyAmount !== null ? ` · max ₹${r.maxDailyAmount}/day` : ""}
                    {" · "}
                    {r.approval === "auto" ? "auto approve" : "manager approval"}
                  </span>
                </span>
                <button
                  className="cursor-pointer p-1.5 text-[var(--wf-faint)] hover:text-[var(--wf-red)]"
                  aria-label={`Archive ${r.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    wf.archiveAllowanceRule("petrol", r.id);
                  }}
                >
                  <ITrash size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* food rules (spec §17) */}
      {foodOn ? (
        <div>
          <SectionTitle
            action={
              <button className="wf-btn wf-btn-ghost wf-btn-sm" onClick={() => setFoodSheet("new")}>
                <IPlus size={13} /> Rule
              </button>
            }
          >
            Food allowance rules
          </SectionTitle>
          {food.length === 0 ? (
            <p className="wf-card2 p-4 text-[0.8rem] text-[var(--wf-muted)]">
              No food rules yet. Example: check-in between 06:30 – 07:00 am
              earns a ₹100 breakfast allowance.
            </p>
          ) : (
            <div className="wf-card wf-list overflow-hidden">
              {food.map((r) => (
                <div
                  key={r.id}
                  role="button"
                  tabIndex={0}
                  className="wf-row w-full cursor-pointer text-left hover:bg-[var(--wf-fill-3)]"
                  onClick={() => setFoodSheet(r)}
                  onKeyDown={(e) => e.key === "Enter" && setFoodSheet(r)}
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--wf-fill-2)]">
                    <ICoffee size={16} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[0.88rem] font-semibold">
                      {r.name} — ₹{r.amount}
                    </span>
                    <span className="block text-[0.7rem] text-[var(--wf-muted)]">
                      {r.meal} · {r.trigger === "check-in" ? "check-in" : "checkout"}{" "}
                      {fmtMinute(r.startMinute)} – {fmtMinute(r.endMinute)}
                      {r.shiftIds.length ? ` · ${r.shiftIds.length} shift${r.shiftIds.length === 1 ? "" : "s"}` : ""}
                    </span>
                  </span>
                  <button
                    className="cursor-pointer p-1.5 text-[var(--wf-faint)] hover:text-[var(--wf-red)]"
                    aria-label={`Archive ${r.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      wf.archiveAllowanceRule("food", r.id);
                    }}
                  >
                    <ITrash size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      <BottomSheet
        open={!!petrolSheet}
        onClose={() => setPetrolSheet(null)}
        title={petrolSheet === "new" ? "New petrol rule" : "Edit petrol rule"}
        tall
      >
        {petrolSheet ? (
          <PetrolRuleForm
            base={petrolSheet === "new" ? null : petrolSheet}
            onDone={() => setPetrolSheet(null)}
          />
        ) : null}
      </BottomSheet>
      <BottomSheet
        open={!!foodSheet}
        onClose={() => setFoodSheet(null)}
        title={foodSheet === "new" ? "New food rule" : "Edit food rule"}
        tall
      >
        {foodSheet ? (
          <FoodRuleForm
            base={foodSheet === "new" ? null : foodSheet}
            onDone={() => setFoodSheet(null)}
          />
        ) : null}
      </BottomSheet>
    </div>
  );
}

function PetrolRuleForm({ base, onDone }: { base: PetrolRule | null; onDone: () => void }) {
  const wf = useWorkforce();
  const { state } = wf;
  const [name, setName] = useState(base?.name ?? "");
  const [vehicleType, setVehicleType] = useState<VehicleType>(base?.vehicleType ?? "two-wheeler");
  const [rate, setRate] = useState(base?.ratePerKm ?? 5);
  const [maxKm, setMaxKm] = useState<number | null>(base?.maxDailyKm ?? null);
  const [maxAmount, setMaxAmount] = useState<number | null>(base?.maxDailyAmount ?? null);
  const [approval, setApproval] = useState<"auto" | "manager">(base?.approval ?? "manager");
  const [projectIds, setProjectIds] = useState<string[]>(base?.projectIds ?? []);
  return (
    <div className="flex flex-col gap-4">
      <Field label="Rule name" required>
        <input
          className="wf-input"
          placeholder="e.g. Two wheeler"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Vehicle type">
          <Segmented
            size="sm"
            ariaLabel="Vehicle type"
            value={vehicleType}
            onChange={(v) => setVehicleType(v as VehicleType)}
            options={[
              { value: "two-wheeler", label: "Two wheeler" },
              { value: "four-wheeler", label: "Four wheeler" },
            ]}
          />
        </Field>
        <Field label="Rate (₹ / km)" required>
          <input
            className="wf-input"
            type="number"
            min={0}
            step={0.5}
            value={rate}
            onChange={(e) => setRate(Number(e.target.value) || 0)}
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Max km / day" hint="Blank = uncapped">
          <input
            className="wf-input"
            type="number"
            min={0}
            value={maxKm ?? ""}
            onChange={(e) => setMaxKm(e.target.value === "" ? null : Number(e.target.value) || 0)}
          />
        </Field>
        <Field label="Max ₹ / day" hint="Blank = uncapped">
          <input
            className="wf-input"
            type="number"
            min={0}
            value={maxAmount ?? ""}
            onChange={(e) =>
              setMaxAmount(e.target.value === "" ? null : Number(e.target.value) || 0)
            }
          />
        </Field>
      </div>
      <Field label="Approval">
        <Segmented
          size="sm"
          ariaLabel="Approval"
          value={approval}
          onChange={(v) => setApproval(v as "auto" | "manager")}
          options={[
            { value: "manager", label: "Manager approval" },
            { value: "auto", label: "Auto approve" },
          ]}
        />
      </Field>
      <Field label="Projects" hint="None selected = every project">
        <div className="flex flex-wrap gap-2">
          {state.projects.map((p) => (
            <button
              key={p.id}
              className="wf-btn wf-btn-sm"
              style={{
                background: projectIds.includes(p.id) ? "var(--wf-amber)" : "var(--wf-fill-3)",
                color: projectIds.includes(p.id) ? "var(--wf-on-amber)" : "var(--wf-fg)",
              }}
              onClick={() =>
                setProjectIds((ids) =>
                  ids.includes(p.id) ? ids.filter((x) => x !== p.id) : [...ids, p.id],
                )
              }
            >
              {p.name}
            </button>
          ))}
        </div>
      </Field>
      <button
        className="wf-btn wf-btn-primary wf-btn-lg"
        disabled={!name.trim() || rate <= 0}
        onClick={() => {
          wf.savePetrolRule(
            {
              name: name.trim(),
              vehicleType,
              ratePerKm: rate,
              maxDailyKm: maxKm,
              maxDailyAmount: maxAmount,
              approval,
              projectIds,
            },
            base?.id,
          );
          onDone();
        }}
      >
        {base ? "Save rule" : "Create rule"}
      </button>
    </div>
  );
}

function FoodRuleForm({ base, onDone }: { base: FoodRule | null; onDone: () => void }) {
  const wf = useWorkforce();
  const { state } = wf;
  const [name, setName] = useState(base?.name ?? "");
  const [meal, setMeal] = useState<MealType>(base?.meal ?? "Breakfast");
  const [start, setStart] = useState(base?.startMinute ?? 6 * 60 + 30);
  const [end, setEnd] = useState(base?.endMinute ?? 7 * 60);
  const [amount, setAmount] = useState(base?.amount ?? 100);
  const [approval, setApproval] = useState<"auto" | "manager">(base?.approval ?? "auto");
  const [projectIds, setProjectIds] = useState<string[]>(base?.projectIds ?? []);
  const [shiftIds, setShiftIds] = useState<string[]>(base?.shiftIds ?? []);
  const shifts = state.shifts.filter((x) => x.status === "active");
  return (
    <div className="flex flex-col gap-4">
      <Field label="Rule name" required>
        <input
          className="wf-input"
          placeholder="e.g. Breakfast Allowance"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Meal">
          <select
            className="wf-input"
            value={meal}
            onChange={(e) => setMeal(e.target.value as MealType)}
          >
            {MEAL_TYPES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Amount (₹)" required>
          <input
            className="wf-input"
            type="number"
            min={0}
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value) || 0)}
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Window opens">
          <input
            className="wf-input"
            type="time"
            value={toHM(start)}
            onChange={(e) => setStart(fromHM(e.target.value, start))}
          />
        </Field>
        <Field label="Window closes">
          <input
            className="wf-input"
            type="time"
            value={toHM(end)}
            onChange={(e) => setEnd(fromHM(e.target.value, end))}
          />
        </Field>
      </div>
      <Field
        label="Eligibility event"
        hint="Only a verified geofenced record counts — never a typed-in time."
      >
        <p className="wf-card2 px-3.5 py-2.5 text-[0.82rem]">
          Site check-in inside the window
        </p>
      </Field>
      <Field label="Approval">
        <Segmented
          size="sm"
          ariaLabel="Approval"
          value={approval}
          onChange={(v) => setApproval(v as "auto" | "manager")}
          options={[
            { value: "auto", label: "Auto approve" },
            { value: "manager", label: "Manager approval" },
          ]}
        />
      </Field>
      <Field label="Projects" hint="None selected = every project (project-level overrides)">
        <div className="flex flex-wrap gap-2">
          {state.projects.map((p) => (
            <button
              key={p.id}
              className="wf-btn wf-btn-sm"
              style={{
                background: projectIds.includes(p.id) ? "var(--wf-amber)" : "var(--wf-fill-3)",
                color: projectIds.includes(p.id) ? "var(--wf-on-amber)" : "var(--wf-fg)",
              }}
              onClick={() =>
                setProjectIds((ids) =>
                  ids.includes(p.id) ? ids.filter((x) => x !== p.id) : [...ids, p.id],
                )
              }
            >
              {p.name}
            </button>
          ))}
        </div>
      </Field>
      {shifts.length > 0 ? (
        <Field label="Shifts" hint="None selected = every shift">
          <div className="flex flex-wrap gap-2">
            {shifts.map((sh) => (
              <button
                key={sh.id}
                className="wf-btn wf-btn-sm"
                style={{
                  background: shiftIds.includes(sh.id) ? "var(--wf-amber)" : "var(--wf-fill-3)",
                  color: shiftIds.includes(sh.id) ? "var(--wf-on-amber)" : "var(--wf-fg)",
                }}
                onClick={() =>
                  setShiftIds((ids) =>
                    ids.includes(sh.id) ? ids.filter((x) => x !== sh.id) : [...ids, sh.id],
                  )
                }
              >
                {sh.name}
              </button>
            ))}
          </div>
        </Field>
      ) : null}
      <button
        className="wf-btn wf-btn-primary wf-btn-lg"
        disabled={!name.trim() || amount <= 0 || end <= start}
        onClick={() => {
          wf.saveFoodRule(
            {
              name: name.trim(),
              meal,
              startMinute: start,
              endMinute: end,
              amount,
              approval,
              projectIds,
              shiftIds,
            },
            base?.id,
          );
          onDone();
        }}
      >
        {base ? "Save rule" : "Create rule"}
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------- reports */

function ReportsTab() {
  const wf = useWorkforce();
  const { state } = wf;
  const [month, setMonth] = useState(() => todayISO().slice(0, 7));

  const travelRows = useMemo(() => {
    const dates = [
      ...new Set(
        state.travelSessions
          .filter((t) => t.date.startsWith(month))
          .map((t) => `${t.employeeId}|${t.date}`),
      ),
    ];
    return dates
      .flatMap((key) => {
        const [employeeId, date] = key.split("|");
        return travelAllowancesForDay(state, employeeId, date);
      })
      .sort((a, b) => b.session.start.at - a.session.start.at);
  }, [state, month]);

  const foodRows = useMemo(
    () =>
      state.attendance
        .filter((a) => a.date.startsWith(month) && a.checkIn)
        .flatMap((att) =>
          dayAllowances(state, att)
            .food.filter((f) => f.eligible || f.status === "not-eligible")
            .map((f) => ({ att, f })),
        )
        .filter(({ f }) => f.eligible)
        .sort((a, b) => (a.att.date < b.att.date ? 1 : -1)),
    [state, month],
  );

  const exportTravel = () => {
    downloadCSV(
      `petrol-allowance-${month}.csv`,
      toCSV(
        ["Employee", "Date", "Project", "Start Point", "End Point", "Distance (km)", "Eligible (km)", "Rate", "Amount", "Status"],
        travelRows.map((t) => {
          const u = state.users.find((x) => x.id === t.session.employeeId);
          const p = state.projects.find((x) => x.id === t.session.projectId);
          return [
            u?.name,
            t.session.date,
            p?.name,
            t.session.start.name,
            t.session.end?.name ?? "",
            (t.meters / 1000).toFixed(1),
            (t.eligibleMeters / 1000).toFixed(1),
            t.ratePerKm,
            t.amount,
            t.session.status,
          ];
        }),
      ),
    );
    wf.logAudit("allowance.export", month, "Petrol CSV");
  };

  const exportFood = () => {
    downloadCSV(
      `food-allowance-${month}.csv`,
      toCSV(
        ["Employee", "Date", "Project", "Check-in Time", "Meal Type", "Eligibility Window", "Amount", "Status"],
        foodRows.map(({ att, f }) => {
          const u = state.users.find((x) => x.id === att.employeeId);
          const p = state.projects.find((x) => x.id === att.projectId);
          return [
            u?.name,
            att.date,
            p?.name,
            att.checkIn ? fmtTime(att.checkIn.at) : "",
            f.rule.meal,
            `${fmtMinute(f.rule.startMinute)} - ${fmtMinute(f.rule.endMinute)}`,
            f.payable ? f.amount : 0,
            f.status,
          ];
        }),
      ),
    );
    wf.logAudit("allowance.export", month, "Food CSV");
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end gap-3">
        <Field label="Month">
          <input
            className="wf-input"
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
        </Field>
        <button className="wf-btn wf-btn-ghost wf-btn-sm mb-1" onClick={exportTravel}>
          <IDownload size={13} /> Petrol CSV
        </button>
        <button className="wf-btn wf-btn-ghost wf-btn-sm mb-1" onClick={exportFood}>
          <IDownload size={13} /> Food CSV
        </button>
      </div>

      <div>
        <SectionTitle>Petrol allowance — {travelRows.length} trips</SectionTitle>
        <div className="wf-card overflow-hidden">
          <div className="wf-scroll-x">
            <table className="wf-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Date</th>
                  <th>Route</th>
                  <th className="text-right">Km</th>
                  <th className="text-right">Eligible</th>
                  <th className="text-right">Amount</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {travelRows.map((t) => {
                  const u = state.users.find((x) => x.id === t.session.employeeId);
                  return (
                    <tr key={t.session.id}>
                      <td className="font-semibold">{u?.name}</td>
                      <td className="whitespace-nowrap tabular-nums">{t.session.date.slice(5)}</td>
                      <td className="max-w-[180px] truncate">
                        {t.session.start.name} → {t.session.end?.name ?? "…"}
                      </td>
                      <td className="text-right tabular-nums">{(t.meters / 1000).toFixed(1)}</td>
                      <td className="text-right tabular-nums">
                        {(t.eligibleMeters / 1000).toFixed(1)}
                      </td>
                      <td className="text-right font-semibold tabular-nums">{fmtINR(t.amount)}</td>
                      <td>
                        <Chip
                          tone={
                            t.session.status === "approved"
                              ? "green"
                              : t.session.status === "rejected"
                                ? "red"
                                : "amber"
                          }
                        >
                          {t.session.status}
                        </Chip>
                      </td>
                    </tr>
                  );
                })}
                {travelRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-6 text-center text-[var(--wf-muted)]">
                      No travel this month.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div>
        <SectionTitle>Food allowance — {foodRows.length} entries</SectionTitle>
        <div className="wf-card overflow-hidden">
          <div className="wf-scroll-x">
            <table className="wf-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Date</th>
                  <th>Check-in</th>
                  <th>Meal</th>
                  <th>Window</th>
                  <th className="text-right">Amount</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {foodRows.map(({ att, f }) => {
                  const u = state.users.find((x) => x.id === att.employeeId);
                  return (
                    <tr key={`${att.id}_${f.rule.id}`}>
                      <td className="font-semibold">{u?.name}</td>
                      <td className="whitespace-nowrap tabular-nums">{att.date.slice(5)}</td>
                      <td className="tabular-nums">
                        {att.checkIn ? fmtTime(att.checkIn.at) : "—"}
                      </td>
                      <td>{f.rule.meal}</td>
                      <td className="whitespace-nowrap tabular-nums">
                        {fmtMinute(f.rule.startMinute)} – {fmtMinute(f.rule.endMinute)}
                      </td>
                      <td className="text-right font-semibold tabular-nums">
                        {f.payable ? fmtINR(f.amount) : "—"}
                      </td>
                      <td>
                        <Chip
                          tone={
                            f.status === "auto" || f.status === "approved"
                              ? "green"
                              : f.status === "rejected"
                                ? "red"
                                : "amber"
                          }
                        >
                          {f.status}
                        </Chip>
                      </td>
                    </tr>
                  );
                })}
                {foodRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-6 text-center text-[var(--wf-muted)]">
                      No eligible food allowances this month.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
