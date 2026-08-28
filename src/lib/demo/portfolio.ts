/**
 * The rest of Workfence's client book (spec §23).
 *
 * The Super Admin persona sells a platform, not a single account, so the
 * demo has to look like a business: a spread of clients across plans and
 * health states, renewals landing this month, trials about to lapse, and
 * invoices in every state a finance team actually sees.
 *
 * Every number the platform dashboard shows is derived from these records
 * rather than written into the dashboard — MRR is the sum of the
 * subscriptions, active employees the sum of the usage snapshots. So the
 * portfolio can be interrogated: open any client and the figures behind the
 * headline are there.
 *
 * The demonstration tenant (ABC Infrastructure) is seeded separately with
 * full operational data. These are its peers on the platform.
 */

import type {
  Invoice,
  Organization,
  Subscription,
  UsageSnapshot,
} from "../saas-types";

const DAY = 86_400_000;

/** Mulberry32, seeded apart from the workforce so one can change alone. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(r: () => number, xs: readonly T[]): T =>
  xs[Math.floor(r() * xs.length)];
const intBetween = (r: () => number, lo: number, hi: number) =>
  lo + Math.floor(r() * (hi - lo + 1));

/* ------------------------------------------------------------- vocabulary */

const PREFIX = [
  "Sterling", "Meridian", "Vaishnavi", "Kalpataru", "Prestige", "Shobha",
  "Ramky", "Navayuga", "Gammon", "Simplex", "Ahluwalia", "Capacite",
  "Ashoka", "Dilip", "PNC", "IRB", "Sadbhav", "Welspun", "GR Infra",
  "Rithwik", "Megha", "Transrail", "Kalpana", "Coastal", "Vishwa",
  "Anandha", "Sri Balaji", "Deccan", "Konark", "Sanjivini", "Trident",
  "Bluestone", "Greenfield", "Highland", "Northstar", "Southgate",
  "Pinnacle", "Cornerstone", "Ironbridge", "Granite", "Redfort",
  "Silverline", "Everest", "Nilgiri", "Sahyadri", "Aravalli", "Vindhya",
  "Godavari", "Kaveri", "Narmada", "Tapti", "Krishna", "Tungabhadra",
];

const SUFFIX = [
  "Constructions", "Infra Projects", "Builders", "Engineering",
  "Infrastructure", "Developers", "Civil Works", "Projects",
  "Contracting", "Structures", "Realty & Infra", "Industrial Services",
  "Facility Services", "Power & Utilities", "Roadways", "Foundations",
];

const KIND = ["Pvt. Ltd.", "Pvt. Ltd.", "Pvt. Ltd.", "Ltd.", "LLP"];

const INDUSTRY = [
  "Construction & Infrastructure",
  "Roads & Highways",
  "Metro & Rail",
  "Power & Transmission",
  "Industrial Construction",
  "Facility Management",
  "Real Estate Development",
  "Water & Irrigation",
  "Oil & Gas Services",
  "Mining & Quarrying",
  "Telecom Infrastructure",
  "Solar & Renewables",
];

const CITIES: Array<[city: string, state: string, pin: string, gst: string]> = [
  ["Chennai", "Tamil Nadu", "600002", "33"],
  ["Coimbatore", "Tamil Nadu", "641012", "33"],
  ["Madurai", "Tamil Nadu", "625001", "33"],
  ["Bengaluru", "Karnataka", "560001", "29"],
  ["Mysuru", "Karnataka", "570001", "29"],
  ["Hyderabad", "Telangana", "500032", "36"],
  ["Vijayawada", "Andhra Pradesh", "520010", "37"],
  ["Visakhapatnam", "Andhra Pradesh", "530016", "37"],
  ["Kochi", "Kerala", "682016", "32"],
  ["Thiruvananthapuram", "Kerala", "695001", "32"],
  ["Mumbai", "Maharashtra", "400051", "27"],
  ["Pune", "Maharashtra", "411014", "27"],
  ["Nagpur", "Maharashtra", "440010", "27"],
  ["Ahmedabad", "Gujarat", "380015", "24"],
  ["Surat", "Gujarat", "395007", "24"],
  ["Jaipur", "Rajasthan", "302018", "08"],
  ["Indore", "Madhya Pradesh", "452010", "23"],
  ["Bhopal", "Madhya Pradesh", "462016", "23"],
  ["Lucknow", "Uttar Pradesh", "226010", "09"],
  ["Noida", "Uttar Pradesh", "201301", "09"],
  ["Gurugram", "Haryana", "122002", "06"],
  ["New Delhi", "Delhi", "110019", "07"],
  ["Kolkata", "West Bengal", "700091", "19"],
  ["Bhubaneswar", "Odisha", "751024", "21"],
  ["Patna", "Bihar", "800001", "10"],
  ["Raipur", "Chhattisgarh", "492001", "22"],
  ["Chandigarh", "Punjab", "160017", "03"],
  ["Guwahati", "Assam", "781006", "18"],
];

const FIRST = [
  "Rajesh", "Suresh", "Anand", "Vikram", "Prakash", "Mahesh", "Ganesh",
  "Ramesh", "Naveen", "Sanjay", "Deepak", "Arvind", "Manoj", "Rakesh",
  "Sunil", "Ashok", "Vinod", "Harish", "Girish", "Satish", "Meera",
  "Lakshmi", "Priya", "Kavitha", "Sudha", "Anitha", "Revathi", "Shalini",
  "Nandini", "Deepa", "Farhan", "Imran", "Zubair", "Rehman", "Sameer",
  "Joseph", "Thomas", "George", "Alex", "Daniel",
];

const LAST = [
  "Kumar", "Reddy", "Nair", "Menon", "Iyer", "Sharma", "Verma", "Gupta",
  "Patel", "Shah", "Desai", "Joshi", "Rao", "Naidu", "Pillai", "Krishnan",
  "Subramanian", "Chandran", "Bose", "Banerjee", "Mukherjee", "Singh",
  "Chauhan", "Yadav", "Mehta", "Kulkarni", "Deshpande", "Prabhu",
];

const PAY_METHOD = [
  "NEFT · HDFC ••4417", "Auto-debit · ICICI ••8823", "UPI mandate · axis@ybl",
  "NEFT · SBI ••1190", "Card · Visa ••4242", "Auto-debit · Kotak ••7761",
  "RTGS · Yes Bank ••3308", "Card · Mastercard ••5510",
];

/* --------------------------------------------------------------- profiles */

/**
 * How a client behaves, in the terms a platform owner thinks in. The mix
 * decides plan, size and payment health together, so a tiny client never
 * turns up on an enterprise contract with 400 employees.
 */
type Shape = {
  planId: string;
  weight: number;
  employees: [number, number];
  projects: [number, number];
  managers: [number, number];
};

const SHAPES: Shape[] = [
  { planId: "plan_starter", weight: 44, employees: [8, 45], projects: [1, 3], managers: [1, 3] },
  { planId: "plan_growth", weight: 38, employees: [40, 190], projects: [2, 8], managers: [2, 9] },
  { planId: "plan_enterprise", weight: 18, employees: [180, 900], projects: [6, 24], managers: [8, 32] },
];

function shapeFor(r: () => number): Shape {
  const total = SHAPES.reduce((t, s) => t + s.weight, 0);
  let n = r() * total;
  for (const s of SHAPES) {
    n -= s.weight;
    if (n <= 0) return s;
  }
  return SHAPES[0];
}

const LIST_PRICE: Record<string, { monthly: number; annual: number }> = {
  plan_starter: { monthly: 7_500, annual: 75_000 },
  plan_growth: { monthly: 24_000, annual: 240_000 },
  plan_enterprise: { monthly: 68_000, annual: 690_000 },
};

/** Clients still inside their 14-day trial — the top of the funnel. */
const TRIALS = 9;

export interface Portfolio {
  organizations: Organization[];
  subscriptions: Subscription[];
  invoices: Invoice[];
  usage: UsageSnapshot[];
}

/**
 * Build the client book that surrounds the demonstration tenant.
 *
 * `count` clients are generated deterministically, so a demo given twice
 * shows the same platform both times — a presenter can rehearse against a
 * number and trust it will still be there.
 */
export function buildPortfolio(now: number, count = 127): Portfolio {
  const r = rng(90_210);
  const month = new Date(now).toISOString().slice(0, 7);

  const organizations: Organization[] = [];
  const subscriptions: Subscription[] = [];
  const invoices: Invoice[] = [];
  const usage: UsageSnapshot[] = [];

  const usedNames = new Set<string>();
  let invoiceSeq = 1_000;

  for (let i = 0; i < count; i++) {
    /* ------------------------------------------------------------ identity */

    let name = "";
    for (let attempt = 0; attempt < 12; attempt++) {
      const candidate = `${pick(r, PREFIX)} ${pick(r, SUFFIX)}`;
      if (!usedNames.has(candidate)) {
        name = candidate;
        break;
      }
    }
    if (!name) name = `${pick(r, PREFIX)} ${pick(r, SUFFIX)} ${i}`;
    usedNames.add(name);

    const legalName = `${name} ${pick(r, KIND)}`;
    const [city, state, pin, gstState] = pick(r, CITIES);
    const contact = `${pick(r, FIRST)} ${pick(r, LAST)}`;
    const slug = name.toLowerCase().replace(/[^a-z]+/g, "");
    const code = `${name.slice(0, 3).toUpperCase()}-${String(i + 100).padStart(4, "0")}`;
    const orgId = `demo-org-${i + 1}`;

    /* -------------------------------------------------- size & commercials */

    const shape = shapeFor(r);
    const employees = intBetween(r, shape.employees[0], shape.employees[1]);
    const managers = Math.min(
      employees,
      intBetween(r, shape.managers[0], shape.managers[1]),
    );
    const projects = intBetween(r, shape.projects[0], shape.projects[1]);

    // Age drives everything downstream: a client onboarded last week has no
    // year of invoices behind it and is probably still on trial. The first
    // few are deliberately days old, so the platform always has a live trial
    // cohort to talk about rather than a zero that depends on the dice.
    const ageDays = i < TRIALS ? intBetween(r, 1, 13) : intBetween(r, 30, 980);
    const createdAt = now - ageDays * DAY;
    const annual = ageDays > 120 ? r() < 0.55 : r() < 0.2;
    const cycle: Subscription["cycle"] = annual ? "annual" : "monthly";

    /* -------------------------------------------------------------- health */

    // Trials are only plausible while the client is genuinely new.
    const roll = r();
    let orgStatus: Organization["status"];
    let subStatus: Subscription["status"];
    if (i < TRIALS) {
      orgStatus = "trial";
      subStatus = "trial";
    } else if (ageDays <= 21 && roll < 0.72) {
      orgStatus = "trial";
      subStatus = "trial";
    } else if (roll < 0.04) {
      orgStatus = "payment-hold";
      subStatus = "past-due";
    } else if (roll < 0.06) {
      orgStatus = "suspended";
      subStatus = "suspended";
    } else if (roll < 0.08) {
      orgStatus = "cancelled";
      subStatus = "cancelled";
    } else {
      orgStatus = "active";
      subStatus = "active";
    }

    const trialEndsAt =
      subStatus === "trial" ? createdAt + 14 * DAY : undefined;

    // Renewal falls on the anniversary of the last billed period, so some
    // land inside this month and show up under "renewals".
    const period = cycle === "annual" ? 365 : 30;
    let renewsAt = createdAt;
    while (renewsAt < now) renewsAt += period * DAY;
    // Nudge a handful into this month so the renewals KPI is never empty.
    if (r() < 0.12) renewsAt = now + intBetween(r, 1, 20) * DAY;

    const discountPercent = r() < 0.22 ? pick(r, [5, 10, 12, 15, 20]) : undefined;
    const list = LIST_PRICE[shape.planId];
    const customPrice =
      shape.planId === "plan_enterprise" && r() < 0.35
        ? Math.round(
            (cycle === "annual" ? list.annual : list.monthly) *
              (1 + intBetween(r, 1, 6) / 10),
          )
        : undefined;

    const paymentMethod = pick(r, PAY_METHOD);

    organizations.push({
      id: orgId,
      name: legalName,
      code,
      industry: pick(r, INDUSTRY),
      website: `${slug}.demo`,
      contactName: contact,
      contactEmail: `${contact.split(" ")[0].toLowerCase()}@${slug}.demo`,
      contactPhone: `9${intBetween(r, 400_000_000, 899_999_999)}`,
      country: "India",
      timezone: "Asia/Kolkata",
      status: orgStatus,
      billing: {
        legalName,
        contactName: contact,
        email: `accounts@${slug}.demo`,
        phone: `9${intBetween(r, 400_000_000, 899_999_999)}`,
        addressLine: `${intBetween(r, 1, 240)}, ${pick(r, ["Industrial Estate", "Ring Road", "Main Road", "Tech Park", "Trade Centre", "Business Bay"])}`,
        city,
        state,
        postcode: pin,
        country: "India",
        taxIdLabel: "GSTIN",
        taxId: `${gstState}${String.fromCharCode(65 + Math.floor(r() * 26))}${String.fromCharCode(65 + Math.floor(r() * 26))}${String.fromCharCode(65 + Math.floor(r() * 26))}${String.fromCharCode(65 + Math.floor(r() * 26))}${intBetween(r, 1000, 9999)}${String.fromCharCode(65 + Math.floor(r() * 26))}1Z${intBetween(r, 1, 9)}`,
        taxPercent: 18,
        currency: "INR",
        paymentMethod,
      },
      branding: {
        appName: "Workfence",
        accent: "#000000",
        logoText: name.slice(0, 3).toUpperCase(),
      },
      createdAt,
      suspendedReason:
        orgStatus === "suspended"
          ? "Non-payment — suspended after three failed collection attempts."
          : orgStatus === "payment-hold"
            ? "Mandate declined by bank. Awaiting updated payment method."
            : undefined,
    });

    const subId = `demo-sub-${i + 1}`;
    subscriptions.push({
      id: subId,
      orgId,
      planId: shape.planId,
      status: subStatus,
      cycle,
      startedAt: createdAt,
      trialEndsAt,
      renewsAt,
      cancelledAt: subStatus === "cancelled" ? now - intBetween(r, 5, 90) * DAY : undefined,
      limitOverrides:
        shape.planId === "plan_enterprise" && r() < 0.4
          ? { employees: Math.ceil((employees * 1.4) / 50) * 50 }
          : {},
      featureOverrides: {},
      customPrice,
      discountPercent,
      creditBalance: r() < 0.08 ? intBetween(r, 1, 20) * 500 : 0,
      onLimitReached: pick(r, ["warn", "warn", "block", "overage"] as const),
    });

    /* ------------------------------------------------------------- usage */

    // A client on trial has barely used anything; a mature one is busy.
    const adoption =
      subStatus === "trial"
        ? 0.25 + r() * 0.35
        : subStatus === "active"
          ? 0.72 + r() * 0.26
          : 0.15 + r() * 0.4;
    const activeEmployees = Math.max(1, Math.round(employees * adoption));
    const workingDays = 26;
    const checkIns = Math.round(activeEmployees * workingDays * (0.82 + r() * 0.16));

    usage.push({
      orgId,
      month,
      employees,
      activeEmployees,
      managers,
      projects,
      storageGb: Math.round(employees * (0.6 + r() * 2.4)),
      checkIns,
      trackingSessions: Math.round(checkIns * (0.88 + r() * 0.1)),
      locationPoints: checkIns * intBetween(r, 900, 2_400),
      workUpdates: Math.round(checkIns * (0.1 + r() * 0.35)),
      apiCalls: shape.planId === "plan_starter" ? 0 : intBetween(r, 2_000, 90_000),
      reportRuns: intBetween(r, 4, 340),
      activeManagerDays: Math.min(26, Math.round(managers * (0.5 + r() * 0.5) * 6)),
      gpsErrors: Math.round(checkIns * r() * 0.02),
    });

    /* ---------------------------------------------------------- invoices */

    // Only bill what has actually elapsed, and never bill a trial.
    if (subStatus !== "trial") {
      const gross =
        customPrice ?? (cycle === "annual" ? list.annual : list.monthly);
      const net = Math.round(gross * (1 - (discountPercent ?? 0) / 100));
      const issuedCount = Math.min(
        cycle === "annual" ? 2 : 4,
        Math.max(1, Math.floor(ageDays / period)),
      );

      for (let k = 0; k < issuedCount; k++) {
        const issued = now - (k * period + intBetween(r, 1, 8)) * DAY;
        if (issued < createdAt) break;

        // The newest invoice carries the account's current health; older
        // ones are settled, because an unpaid year is a lost client.
        let status: Invoice["status"];
        if (k > 0) status = r() < 0.03 ? "refunded" : "paid";
        else if (subStatus === "past-due") status = r() < 0.5 ? "overdue" : "failed";
        else if (subStatus === "suspended") status = "overdue";
        else if (subStatus === "cancelled") status = r() < 0.5 ? "refunded" : "paid";
        else status = r() < 0.09 ? "pending" : "paid";

        invoiceSeq += 1;
        invoices.push({
          id: `demo-inv-p${invoiceSeq}`,
          number: `INV-2026-${String(invoiceSeq).padStart(5, "0")}`,
          orgId,
          subscriptionId: subId,
          amount: net,
          taxAmount: Math.round(net * 0.18),
          currency: "INR",
          issuedAt: issued,
          dueAt: issued + 15 * DAY,
          paidAt: status === "paid" ? issued + intBetween(r, 1, 12) * DAY : undefined,
          status,
          periodLabel: new Date(issued).toLocaleDateString("en-IN", {
            month: "long",
            year: "numeric",
          }),
          paymentMethod,
          failureReason:
            status === "failed"
              ? pick(r, [
                  "Bank declined the mandate — retry scheduled.",
                  "Insufficient funds. Collection retries in 3 days.",
                  "Card expired. Client notified to update payment method.",
                ])
              : undefined,
        });
      }
    }
  }

  return { organizations, subscriptions, invoices, usage };
}
