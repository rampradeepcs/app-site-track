/**
 * The letter somebody gets on the day they start.
 *
 * Written as one function returning a whole document, because an email is
 * not a component tree: it is a file that has to survive Gmail stripping the
 * head, Outlook rendering through Word, and a phone at a site gate. So the
 * layout is tables, every colour is inline, and nothing depends on a style
 * sheet arriving.
 *
 * What it says is chosen the same way. A new administrator does not want a
 * feature list; they want to know the first thing to do and what the product
 * will do for them once they have. So: one action, then the handful of
 * things that are actually theirs now, in the order they will meet them.
 */

export interface WelcomeInput {
  name: string;
  company: string;
  appUrl: string;
  /** Their company's own sign-in address, when there is one. */
  tenantUrl?: string;
  crewInvited: number;
  siteName?: string;
  trialDays?: number;
}

const INK = "#111111";
const MUTED = "#6b6b6b";
const LINE = "#e6e6e6";
const PAPER = "#f6f6f4";

interface Feature {
  title: string;
  body: string;
}

function features(input: WelcomeInput): Feature[] {
  return [
    {
      title: "Attendance that writes itself",
      body:
        "A shift starts with a selfie taken inside the site boundary, and ends the " +
        "same way. Hours, lateness and the day's route are recorded as they happen " +
        "— no paper register, and nobody signing in for a mate.",
    },
    {
      title: "The whole site, live",
      body:
        `Every crew member on one map while their shift is open: who is on ${
          input.siteName ? input.siteName : "site"
        }, who has left the boundary, and when they went.`,
    },
    {
      title: "Track what matters, not everything",
      body:
        "Per site, choose whether movement inside the boundary is recorded at all. " +
        "Turn it off and only trips away from the site are logged.",
    },
    {
      title: "Whole gangs in one photograph",
      body:
        "Mark a labour team present from a single group photo, matched face by " +
        "face — the way a site actually counts people.",
    },
    {
      title: "Travel, fuel and food",
      body:
        "Runs to a supplier are recorded with their distance and priced by your " +
        "own rules, then approved or trimmed by a manager. Allowances follow.",
    },
    {
      title: "Payroll that agrees with the gate",
      body:
        "Shifts, overtime and approved allowances roll into a monthly run you " +
        "review and lock. Corrections are appended, never quietly overwritten.",
    },
  ];
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function welcomeSubject(input: WelcomeInput): string {
  return `${input.company} is live on Workfence`;
}

/** The plain-text half. Never optional: some clients only ever show this. */
export function welcomeText(input: WelcomeInput): string {
  const lines = [
    `${input.company} is live on Workfence.`,
    "",
    `Hello ${input.name},`,
    "",
    "Your company is set up and you can record a shift today." +
      (input.crewInvited > 0
        ? ` ${input.crewInvited} ${input.crewInvited === 1 ? "person has" : "people have"} been invited and will appear as they accept.`
        : ""),
    "",
    `Open your dashboard: ${input.tenantUrl ?? input.appUrl}`,
    "",
    "What you can do now:",
    ...features(input).map((f) => `  • ${f.title} — ${f.body}`),
    "",
    input.trialDays
      ? `Your trial runs for ${input.trialDays} days. Nothing stops working without warning.`
      : "",
    "",
    "If you get stuck, reply to this message.",
    "",
    "Workfence",
  ];
  return lines.filter((l) => l !== undefined).join("\n");
}

export function welcomeHtml(input: WelcomeInput): string {
  const url = input.tenantUrl ?? input.appUrl;
  const rows = features(input)
    .map(
      (f) => `
        <tr>
          <td style="padding:0 0 22px 0;">
            <div style="font:600 15px/1.35 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${INK};">
              ${esc(f.title)}
            </div>
            <div style="font:400 14px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${MUTED};padding-top:5px;">
              ${esc(f.body)}
            </div>
          </td>
        </tr>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(welcomeSubject(input))}</title>
</head>
<body style="margin:0;padding:0;background:${PAPER};">
  <!-- The line a phone shows beside the subject. Worth writing, because the
       alternative is the first words of the letter read out of context. -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">
    Your company is set up. Here is what you can do from today.
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAPER};">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
               style="max-width:560px;background:#ffffff;border:1px solid ${LINE};border-radius:14px;">

          <tr>
            <td style="padding:28px 28px 0 28px;">
              <div style="font:700 13px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:${INK};">
                Workfence
              </div>
            </td>
          </tr>

          <tr>
            <td style="padding:22px 28px 0 28px;">
              <h1 style="margin:0;font:700 24px/1.25 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${INK};">
                ${esc(input.company)} is live
              </h1>
              <p style="margin:12px 0 0 0;font:400 15px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${MUTED};">
                Hello ${esc(input.name)} — your company is set up${
                  input.siteName ? ` and ${esc(input.siteName)} has a boundary` : ""
                }. You can record a shift today.${
                  input.crewInvited > 0
                    ? ` ${input.crewInvited} ${input.crewInvited === 1 ? "person has" : "people have"} been invited; they will appear on your team as they accept.`
                    : ""
                }
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:24px 28px 0 28px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="background:${INK};border-radius:999px;">
                    <a href="${esc(url)}"
                       style="display:inline-block;padding:13px 26px;font:600 15px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#ffffff;text-decoration:none;">
                      Open your dashboard
                    </a>
                  </td>
                </tr>
              </table>
              ${
                input.tenantUrl
                  ? `<p style="margin:10px 0 0 0;font:400 12px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${MUTED};">
                       Your crew signs in at <span style="color:${INK};">${esc(input.tenantUrl)}</span>
                     </p>`
                  : ""
              }
            </td>
          </tr>

          <tr>
            <td style="padding:28px 28px 0 28px;">
              <div style="height:1px;background:${LINE};line-height:1px;font-size:0;">&nbsp;</div>
            </td>
          </tr>

          <tr>
            <td style="padding:24px 28px 0 28px;">
              <div style="font:700 12px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:${MUTED};padding-bottom:18px;">
                What you can do now
              </div>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                ${rows}
              </table>
            </td>
          </tr>

          ${
            input.trialDays
              ? `<tr>
                   <td style="padding:4px 28px 0 28px;">
                     <div style="background:${PAPER};border-radius:10px;padding:14px 16px;font:400 13px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${MUTED};">
                       Your trial runs for ${input.trialDays} days. Nothing stops
                       working without warning, and we will tell you before it ends.
                     </div>
                   </td>
                 </tr>`
              : ""
          }

          <tr>
            <td style="padding:24px 28px 30px 28px;">
              <p style="margin:0;font:400 13px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${MUTED};">
                Stuck on something? Reply to this message — it reaches a person.
              </p>
            </td>
          </tr>
        </table>

        <p style="margin:16px 0 0 0;font:400 11px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${MUTED};">
          You are receiving this because ${esc(input.company)} was created on Workfence.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
