/**
 * Capture real Workfence app screens from the running dev server via CDP.
 *
 * Signs in with the demo address (which seeds a complete fictional company),
 * then walks a shot list, switching the seeded session between personas by
 * patching the demo store's own session record — the same field the app's
 * persona switcher writes.
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";

/* Where the Workfence app dev server is. Override with APP_URL. */
const APP = process.env.APP_URL || "http://localhost:3000";
const OUT = process.argv[2] || "./shots";
const PROFILE = "/tmp/wf-capture-profile";
const PORT = 9333;
/* One iPhone screen (402x874pt) minus the 62pt the system reserves at the
   top; scripts/statusbar.py pastes a real status bar into that gap. 3x so
   the delivered 2x asset is supersampled rather than captured flat. */
/* Play caps a screenshot's long side at twice its short side, so the
   402x812 frame the marketing site uses (1:2.02) is a hair too tall.
   360x640 at 3x lands on 1080x1920 — exactly 9:16, the safe ratio. */
const W = 360, H = 640, DPR = 3;

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const PERSONAS = {
  employee: { userId: "demo-user-employee", role: "employee" },
  traveller: { userId: "demo-user-traveller", role: "employee" },
  supervisor: { userId: "demo-user-supervisor", role: "manager" },
  pm: { userId: "demo-user-pm", role: "manager" },
  payroll: { userId: "demo-user-payroll", role: "admin" },
  hr: { userId: "demo-user-hr", role: "admin" },
  clientOwner: { userId: "demo-user-client-owner", role: "admin" },
};

// name | persona | route | settle ms | scrollY
const SHOTS = [
  /* Eight, in the order the store shows them: what a worker does first,
     then what it costs them (nothing — it works offline), then what the
     person paying for it gets back. */
  ["01-check-in", "employee", "/employee", 2800, 0],
  ["02-attendance", "employee", "/employee/attendance", 2400, 0],
  ["03-history", "traveller", "/employee/history", 2800, 0],
  ["04-notices", "employee", "/employee/notes", 2200, 0],
  ["05-live-map", "pm", "/manager/live", 3600, 0],
  ["06-team-today", "pm", "/manager/attendance", 2600, 0],
  ["07-payroll", "payroll", "/manager/payroll", 2800, 0],
  ["08-shifts", "pm", "/manager/shifts", 2400, 0],
];

/* --------------------------------------------------------------- cdp glue */

let msgId = 0;
const pending = new Map();
let ws;

function send(method, params = {}, sessionId) {
  const id = ++msgId;
  const payload = { id, method, params };
  if (sessionId) payload.sessionId = sessionId;
  ws.send(JSON.stringify(payload));
  return new Promise((res, rej) => {
    pending.set(id, { res, rej });
    setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); rej(new Error(`timeout ${method}`)); }
    }, 60000);
  });
}

async function connect(url) {
  ws = new WebSocket(url);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) rej(new Error(JSON.stringify(m.error)));
      else res(m.result);
    }
  };
}

async function evalJs(sessionId, expression, awaitPromise = false) {
  const r = await send("Runtime.evaluate", {
    expression, awaitPromise, returnByValue: true,
  }, sessionId);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " :: " + expression.slice(0, 120));
  return r.result?.value;
}

/* ------------------------------------------------------------------- main */

/**
 * Freeze the demo at one fixed mid-morning.
 *
 * The seed builds its day from the wall clock, and so does every "is this
 * shift still open" test — so capturing in the evening gives empty live maps
 * and a workforce that has all gone home. Offsetting Date itself, before the
 * bundle loads, makes the seed AND the screens agree on a 10:42 workday.
 *
 * The moment is fixed rather than relative so the capture is reproducible:
 * the site quotes figures off these screens, and a floating date changes all
 * of them on every re-run.
 */
const TIME_TRAVEL = `
(() => {
  /* A FIXED moment, not "today at 10:42". The demo seed is generated from
     the clock, so capturing on a different day regenerates every figure —
     payroll totals, head counts, which days are present — and silently
     invalidates the copy on the site that quotes them. Pinned, a re-capture
     reproduces the same screens. */
  const target = new Date(2026, 8, 15, 10, 42, 17);
  const OFFSET = target.getTime() - Date.now();
  const RealDate = Date;
  const shift = (t) => t + OFFSET;
  function FakeDate(...args) {
    if (!(this instanceof FakeDate)) return new RealDate(shift(RealDate.now())).toString();
    return args.length === 0 ? new RealDate(shift(RealDate.now())) : new RealDate(...args);
  }
  FakeDate.prototype = RealDate.prototype;
  Object.setPrototypeOf(FakeDate, RealDate);
  FakeDate.now = () => shift(RealDate.now());
  FakeDate.parse = RealDate.parse;
  FakeDate.UTC = RealDate.UTC;
  window.Date = FakeDate;
  const perfNow = performance.now.bind(performance);
  performance.now = perfNow;
})()`;

const HIDE_CHROME = `
(() => {
  let s = document.getElementById('__cap_hide');
  if (!s) { s = document.createElement('style'); s.id = '__cap_hide'; document.head.appendChild(s); }
  s.textContent = \`
    nextjs-portal, #__next-build-watcher, [data-nextjs-toast],
    .wf-demo-chip,
    /* Toasts are transient runtime state — a backend permission error frozen
       into a marketing screenshot is not the product. */
    .wf-toast { display: none !important; }
    * { scrollbar-width: none !important; }
    ::-webkit-scrollbar { display: none !important; }
  \`;
  // The demo's GPS simulator card: the smallest element holding both its
  // label and its "Jump on site" button is the card — hide that.
  const all = [...document.querySelectorAll('div, section, article')];
  const hits = all.filter(el => /simulated gps/i.test(el.textContent || '') && /jump on site/i.test(el.textContent || ''));
  let card = null;
  for (const el of hits) if (!card || el.textContent.length < card.textContent.length) card = el;
  if (card) card.style.display = 'none';

  /* The floating action bar carries real page actions on most screens —
     "Mark calculated", "Export", "+ Team" — and those stay. On a few it holds
     nothing but a bare notifications bell, which is a shortcut rather than an
     action, and it lands on top of a card's caption and slices it mid-word.
     Hide it only when it has no label at all. */
  for (const bar of document.querySelectorAll('.wf-fabbar')) {
    if (!(bar.textContent || '').trim()) bar.style.display = 'none';
  }

  // "Switch persona" is demo scaffolding, not product UI — hide the row it
  // sits in wherever it appears.
  for (const el of document.querySelectorAll('span, div')) {
    if (el.children.length === 0 && /^switch persona$/i.test((el.textContent || '').trim())) {
      const row = el.closest('.wf-card, .wf-list, button') || el.parentElement;
      if (row) (row.closest('.wf-card') || row).style.display = 'none';
      break;
    }
  }
  return true;
})()`;

async function main() {
  await rm(PROFILE, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  const chrome = spawn(CHROME, [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    "--no-first-run", "--no-default-browser-check",
    "--hide-scrollbars",
    "--force-device-scale-factor=" + DPR,
    `--window-size=${W},${H}`,
    "about:blank",
  ], { stdio: "ignore" });

  process.on("exit", () => chrome.kill());

  // wait for devtools
  let wsUrl;
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      wsUrl = (await r.json()).webSocketDebuggerUrl;
      break;
    } catch { await sleep(300); }
  }
  if (!wsUrl) throw new Error("chrome devtools never came up");
  await connect(wsUrl);

  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });

  await send("Page.enable", {}, sessionId);
  await send("Runtime.enable", {}, sessionId);
  await send("Emulation.setDeviceMetricsOverride", {
    width: W, height: H, deviceScaleFactor: DPR, mobile: true,
  }, sessionId);

  await send("Page.addScriptToEvaluateOnNewDocument", { source: TIME_TRAVEL }, sessionId);

  const go = async (url, settle = 1500) => {
    await send("Page.navigate", { url }, sessionId);
    await sleep(settle);
  };

  /* 1 — land on the app, skip the highlight reel, start from no demo data
         so the seed regenerates against the travelled clock */
  await go(APP, 2500);
  await evalJs(sessionId, `
    localStorage.setItem('workfence.highlights-seen','1');
    localStorage.removeItem('workfence.demo.v6');
    localStorage.removeItem('workfence.demo.platform.v6');
    localStorage.removeItem('workfence.demo.active');
    true`);
  await go(APP, 2500);

  /* 1b — dismiss the highlight reel if it is still up */
  for (let i = 0; i < 6; i++) {
    const hasEmail = await evalJs(sessionId, `!!document.querySelector('input[type=email]')`);
    if (hasEmail) break;
    await evalJs(sessionId, `
      (() => {
        const b = [...document.querySelectorAll('button')]
          .find(b => /^(skip|get started|continue|next)$/i.test((b.textContent||'').trim()));
        if (b) b.click();
        return !!b;
      })()`);
    await sleep(900);
  }

  /* 2 — sign in with the demo address (seeds the fictional company) */
  await evalJs(sessionId, `
    (() => {
      const el = document.querySelector('input[type=email]');
      if (!el) return 'no-input';
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, 'rampradeepux@gmail.com');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return 'ok';
    })()`);
  await sleep(600);
  const clicked = await evalJs(sessionId, `
    (() => {
      const b = [...document.querySelectorAll('button')]
        .find(b => /send code/i.test(b.textContent||''));
      if (!b) return 'no-button';
      b.click();
      return 'clicked';
    })()`);
  if (clicked !== 'clicked') {
    const dump = await evalJs(sessionId, `JSON.stringify({
      path: location.pathname,
      buttons: [...document.querySelectorAll('button')].map(b=>(b.textContent||'').trim()).slice(0,20),
      inputs: [...document.querySelectorAll('input')].map(i=>i.type+':'+i.placeholder).slice(0,10),
      text: (document.body.innerText||'').slice(0,600)
    })`);
    console.log("PAGE DUMP:", dump);
  }
  console.log("sign-in:", clicked);
  await sleep(4000);

  /* 2b — the demo address opens a persona picker; choosing one seeds the company */
  for (let i = 0; i < 8; i++) {
    const seededYet = await evalJs(sessionId, `localStorage.getItem('workfence.demo.active')==='1'`);
    if (seededYet) break;
    const picked = await evalJs(sessionId, `
      (() => {
        const b = [...document.querySelectorAll('button')]
          .find(b => /client owner/i.test(b.textContent||''));
        if (!b) return false;
        b.click();
        return true;
      })()`);
    if (!picked) break;
    await sleep(2500);
  }

  const where = await evalJs(sessionId, `location.pathname`);
  console.log("landed on:", where);
  if (where === '/') {
    console.log("POST-CLICK DUMP:", await evalJs(sessionId, `JSON.stringify({
      buttons: [...document.querySelectorAll('button')].map(b=>({t:(b.textContent||'').trim(), d:b.disabled})),
      value: (document.querySelector('input[type=email]')||{}).value,
      text: (document.body.innerText||'').slice(0,400),
      ls: Object.keys(localStorage)
    })`));
  }

  const seeded = await evalJs(sessionId,
    `!!localStorage.getItem('workfence.demo.v6') && localStorage.getItem('workfence.demo.active')==='1'`);
  if (!seeded) throw new Error("demo data was not seeded — sign-in flow changed");

  /* 3 — walk the shot list */
  const done = [];
  const only = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
  for (const [name, personaKey, route, settle] of SHOTS) {
    if (only && !only.test(name)) continue;
    const p = PERSONAS[personaKey];
    await evalJs(sessionId, `
      (() => {
        const k = 'workfence.demo.v6';
        const s = JSON.parse(localStorage.getItem(k));
        s.session = { userId: ${JSON.stringify(p.userId)}, role: ${JSON.stringify(p.role)}, at: Date.now() };
        const u = (s.users||[]).find(u => u.id === ${JSON.stringify(p.userId)});
        if (u && u.projectIds && u.projectIds[0]) s.activeProjectId = u.projectIds[0];
        localStorage.setItem(k, JSON.stringify(s));
        return true;
      })()`);

    let url = APP + route;
    if (route === "/manager/project") {
      const pid = await evalJs(sessionId, `
        (() => {
          const s = JSON.parse(localStorage.getItem('workfence.demo.v6'));
          const p = (s.projects||[]).find(p => /chennai/i.test(p.name||'')) || (s.projects||[])[0];
          return p ? p.id : '';
        })()`);
      if (pid) url += "?id=" + encodeURIComponent(pid);
    }
    await go(url, settle);
    // The Face ID nudge sits on top of the employee home; "Later" is the
    // app's own way past it, so the screen below is the real one.
    await evalJs(sessionId, `
      (() => {
        const b = [...document.querySelectorAll('button')]
          .find(b => /^later$/i.test((b.textContent||'').trim()));
        if (b) b.click();
        return !!b;
      })()`);
    if (name === "manager-group-attendance") {
      await evalJs(sessionId, `
        (() => {
          const sel = [...document.querySelectorAll('select')]
            .find(s => /choose a team/i.test(s.options[s.selectedIndex]?.text || ''));
          if (!sel || sel.options.length < 2) return false;
          const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
          setter.call(sel, sel.options[1].value);
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        })()`);
      await sleep(900);
    }
    await evalJs(sessionId, HIDE_CHROME);
    await sleep(700);

    const path = await evalJs(sessionId, `location.pathname`);
    const { data } = await send("Page.captureScreenshot", {
      format: "png", captureBeyondViewport: false,
    }, sessionId);
    await writeFile(`${OUT}/${name}.png`, Buffer.from(data, "base64"));
    const redirected = path !== route;
    done.push({ name, route, landed: path, redirected });
    console.log(`${redirected ? "!" : "✓"} ${name.padEnd(28)} ${path}`);
  }

  await writeFile(`${OUT}/_manifest.json`, JSON.stringify(done, null, 2));
  chrome.kill();
  console.log("\ncaptured", done.length, "screens →", OUT);
  console.log("redirected:", done.filter(d => d.redirected).map(d => d.name).join(", ") || "none");
  process.exit(0);
}

main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
