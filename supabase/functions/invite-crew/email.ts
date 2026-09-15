/**
 * The letter somebody gets when they are added to a company.
 *
 * Written as one function returning a whole document, for the same reason
 * the welcome letter is: an email is not a component tree, it is a file that
 * has to survive Gmail stripping the head, Outlook rendering through Word,
 * and a phone held at a site gate in the sun. Tables, inline colour, and
 * nothing that depends on a style sheet arriving.
 *
 * It carries two ways in, because the people invited here are not office
 * staff with a laptop. The web address works on anything with a browser and
 * needs no install, and the Android build is a direct download for the
 * phones that will actually stand at the gate every morning.
 *
 * The app is linked, never attached. A release is nearly forty megabytes,
 * which is over Gmail's limit before encoding and over Resend's after it,
 * and every major provider strips an .apk attachment as malware regardless
 * of size. A link is the only form of this letter that arrives.
 */

export interface InviteInput {
  /** The person being invited. */
  name: string;
  /** The company they are joining. */
  company: string;
  /** Who added them, for a letter that is from a person and not a system. */
  invitedBy?: string;
  /** What they will be in it: employee, manager, admin. */
  role?: string;
  /** Their first site, when they have been put on one. */
  siteName?: string;
  /** Where the app lives on the web. */
  appUrl: string;
  /** Their company's own sign-in address, when there is one. */
  tenantUrl?: string;
  /** A one-time link that signs them in and accepts the invitation. */
  actionUrl?: string;
  /** The Android build. Omitted when no release is configured. */
  apkUrl?: string;
  /** The mark, as an absolute URL. Mail cannot fetch a relative path. */
  logoUrl?: string;
  /** Where the product lives on the web, for the foot of the letter. */
  siteUrl?: string;
}

const INK = "#111111";
const MUTED = "#6b6b6b";
const LINE = "#e6e6e6";
const PAPER = "#f6f6f4";
const AMBER = "#b45309";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** What the role actually means to the person holding it. */
function roleLine(role?: string): string | undefined {
  switch ((role ?? "").toLowerCase()) {
    case "admin":
      return "You can set up sites, manage people and run payroll.";
    case "manager":
      return "You can mark your crew present, approve travel and see your site live.";
    case "employee":
      return "You will start and end your shifts from your phone.";
    default:
      return undefined;
  }
}

export function inviteSubject(input: InviteInput): string {
  return `${input.invitedBy ? `${input.invitedBy} added you to ` : "You have been added to "}${input.company} on Workfence`;
}

/** The plain-text half. Never optional: some clients only ever show this. */
export function inviteText(input: InviteInput): string {
  const url = input.actionUrl ?? input.tenantUrl ?? input.appUrl;
  const rl = roleLine(input.role);
  const lines: string[] = [
    `${input.company} on Workfence`,
    "",
    `Hello ${input.name},`,
    "",
    `${input.invitedBy ? `${input.invitedBy} has added you to` : "You have been added to"} ${input.company}${
      input.siteName ? `, on ${input.siteName}` : ""
    }.`,
  ];
  if (rl) lines.push("", rl);
  lines.push(
    "",
    "OPEN IT IN YOUR BROWSER",
    url,
    "Works on any phone or computer. Nothing to install.",
  );
  if (input.apkUrl) {
    lines.push(
      "",
      "OR INSTALL THE ANDROID APP",
      input.apkUrl,
      "Tap the link on your Android phone and open the downloaded file. Your",
      "phone will ask whether to allow installing from your browser - say yes.",
      "The app adds background location for site tracking, which the browser",
      "cannot do.",
    );
  }
  lines.push(
    "",
    "WHAT YOU DO WITH IT",
    "  - Start and end your shift with a selfie, taken inside the site boundary.",
    "  - Your hours, lateness and the day's route are recorded as they happen.",
    "  - Trips to a supplier are measured and priced by your company's rules.",
    "  - Everything rolls into the monthly payroll run your office reviews.",
    "",
    "If you were not expecting this, you can ignore it - nothing happens until",
    "you sign in.",
    "",
    input.siteUrl ? `Workfence - site attendance - ${input.siteUrl}` : "Workfence",
  );
  return lines.join("\n");
}

export function inviteHtml(input: InviteInput): string {
  const url = input.actionUrl ?? input.tenantUrl ?? input.appUrl;
  const rl = roleLine(input.role);

  const androidBlock = input.apkUrl
    ? `
      <tr>
        <td style="padding:0 28px 4px 28px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
                 style="border:1px solid ${LINE};border-radius:10px;background:${PAPER};">
            <tr>
              <td style="padding:16px 18px;">
                <p style="margin:0 0 4px 0;font:600 14px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${INK};">
                  On an Android phone, install the app
                </p>
                <p style="margin:0 0 12px 0;font:400 13px/1.55 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${MUTED};">
                  It adds background location for site tracking, which a browser cannot do.
                </p>
                <a href="${esc(input.apkUrl)}"
                   style="display:inline-block;padding:10px 18px;border:1px solid ${INK};border-radius:8px;
                          font:700 13px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
                          color:${INK};text-decoration:none;background:#ffffff;">
                  Download for Android
                </a>
                <p style="margin:12px 0 0 0;font:400 12px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${MUTED};">
                  Open the downloaded file. Your phone will ask whether to allow installing
                  from your browser - say yes.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>`
    : "";

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${esc(inviteSubject(input))}</title>
  </head>
  <body style="margin:0;padding:0;background:${PAPER};">
    <!-- Preheader: the grey line a client shows beside the subject. -->
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">
      ${esc(input.company)} runs site attendance on Workfence. Open it in your browser, or install the Android app.
    </div>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${PAPER};">
      <tr>
        <td align="center" style="padding:28px 12px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
                 style="max-width:560px;background:#ffffff;border:1px solid ${LINE};border-radius:14px;">

            <!-- The mark, with the name as its alt text: a client that
                 blocks images still says who this is from, which is the
                 only job the top of the letter has. Width and height are
                 attributes as well as style, because Outlook sizes from
                 the attributes. -->
            <tr>
              <td style="padding:26px 28px 8px 28px;">
                ${
                  input.logoUrl
                    ? `<img src="${esc(input.logoUrl)}" width="104" height="43" alt="Workfence"
                         style="display:block;border:0;outline:none;text-decoration:none;width:104px;height:43px;" />`
                    : `<p style="margin:0;font:700 13px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.14em;text-transform:uppercase;color:${AMBER};">Workfence</p>`
                }
              </td>
            </tr>

            <tr>
              <td style="padding:10px 28px 0 28px;">
                <h1 style="margin:0;font:700 23px/1.25 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${INK};">
                  ${esc(input.invitedBy ? `${input.invitedBy} added you to ${input.company}` : `You have been added to ${input.company}`)}
                </h1>
              </td>
            </tr>

            <tr>
              <td style="padding:14px 28px 0 28px;">
                <p style="margin:0;font:400 15px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${INK};">
                  Hello ${esc(input.name)},
                </p>
                <p style="margin:10px 0 0 0;font:400 15px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${INK};">
                  ${esc(input.company)} records site attendance on Workfence${
                    input.siteName ? `, and you are on ${esc(input.siteName)}` : ""
                  }.${rl ? ` ${esc(rl)}` : ""}
                </p>
              </td>
            </tr>

            <!-- The one action. -->
            <tr>
              <td style="padding:22px 28px 6px 28px;">
                <a href="${esc(url)}"
                   style="display:inline-block;padding:14px 26px;border-radius:10px;background:${INK};
                          font:700 15px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
                          color:#ffffff;text-decoration:none;">
                  Open Workfence
                </a>
                <p style="margin:10px 0 0 0;font:400 13px/1.55 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${MUTED};">
                  Works on any phone or computer. Nothing to install.
                </p>
                <p style="margin:8px 0 0 0;font:400 12px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${MUTED};word-break:break-all;">
                  ${esc(url)}
                </p>
              </td>
            </tr>

            <tr><td style="padding:16px 28px 0 28px;"><div style="height:1px;background:${LINE};line-height:1px;">&nbsp;</div></td></tr>
            <tr><td style="height:16px;line-height:16px;">&nbsp;</td></tr>

            ${androidBlock}

            <tr><td style="height:18px;line-height:18px;">&nbsp;</td></tr>

            <tr>
              <td style="padding:0 28px;">
                <p style="margin:0 0 10px 0;font:700 13px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
                          letter-spacing:0.08em;text-transform:uppercase;color:${MUTED};">
                  What you do with it
                </p>
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                  ${[
                    "Start and end your shift with a selfie, taken inside the site boundary.",
                    "Your hours, lateness and the day's route are recorded as they happen.",
                    "Trips to a supplier are measured and priced by your company's rules.",
                    "Everything rolls into the monthly payroll run your office reviews.",
                  ]
                    .map(
                      (b) => `
                  <tr>
                    <td width="14" valign="top" style="padding:0 0 8px 0;font:400 15px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${AMBER};">&bull;</td>
                    <td style="padding:0 0 8px 0;font:400 14px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${INK};">${b}</td>
                  </tr>`,
                    )
                    .join("")}
                </table>
              </td>
            </tr>

            <tr><td style="padding:20px 28px 0 28px;"><div style="height:1px;background:${LINE};line-height:1px;">&nbsp;</div></td></tr>

            <tr>
              <td style="padding:16px 28px 26px 28px;">
                <p style="margin:0;font:400 13px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${MUTED};">
                  If you were not expecting this, you can ignore it - nothing happens until you sign in.
                </p>
              </td>
            </tr>
          </table>

          <p style="margin:14px 0 0 0;font:400 12px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${MUTED};">
            Workfence - site attendance${
              input.siteUrl
                ? ` &nbsp;·&nbsp; <a href="https://${esc(input.siteUrl)}" style="color:${MUTED};text-decoration:underline;">${esc(input.siteUrl)}</a>`
                : ""
            }
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
