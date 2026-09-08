# welcome-email

The letter a new administrator gets when their company is created.

## What it says

One action — open your dashboard — then six things the product does that are
theirs from today: attendance from a selfie inside the boundary, the live
site map, per-site tracking modes, marking a whole gang present from one
photograph, travel and allowances, and payroll that agrees with the gate.

The company's own details are read from the database, not from the request:
its name, its first site, how many people are still waiting to accept, and
how many days of trial remain. A caller cannot make it address a stranger or
misdescribe who they are joining.

Sent as HTML and plain text. The HTML is tables with inline colour, because
an email has to survive Gmail stripping the head and Outlook rendering
through Word.

## Sending it

It needs one secret. Without it the function returns `{ sent: false, reason }`
and the signup carries on — a welcome that cannot be sent is not a reason to
fail somebody's company.

```bash
supabase secrets set RESEND_API_KEY=re_... --project-ref fdxwxcwnzzcsnsxdhzjj
```

Optional, and worth setting before real customers see it:

| secret | default | why |
|---|---|---|
| `MAIL_FROM` | `Workfence <onboarding@resend.dev>` | Resend's shared sender works for testing only; a verified domain is needed for real delivery |
| `MAIL_REPLY_TO` | none | the letter says "reply to this message — it reaches a person", so give it somewhere to reach |
| `APP_URL` | the Vercel address | where the dashboard button points |
| `TENANT_BASE_DOMAIN` | none | with a wildcard domain, the crew's sign-in address becomes `slug.yourdomain` instead of `/t/slug` |

## Sent once

The send is recorded in the company's audit trail as `company.welcome`, and
a second call finds that record and does nothing. Signing up is a moment
people retry — a slow network, a button tapped twice — and none of those
should put two letters in an inbox.

## Deploy

```bash
supabase functions deploy welcome-email --project-ref fdxwxcwnzzcsnsxdhzjj
```
