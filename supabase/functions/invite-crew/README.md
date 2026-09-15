# invite-crew

The letter somebody gets when they are added to a company, with both ways in:
the web address, and a download for the Android app.

Deployed to the Supabase project; the source of record for the running
function is this directory.

## Why it is not in the app

Inviting somebody creates an account, which is a service-role act. The app is
a static bundle handed to every user, so a service key in it is a service key
given away. The caller proves who they are with their own token, the function
checks they administer the company they name, and only then does the
privileged part happen.

The addresses come from that company's own records rather than from the
request, so the most a caller can ask for is that their own crew be invited.

## Both invite paths land here

There are two ways a person is invited in this app, and they used to behave
differently:

| where | what it writes | what it used to send |
|---|---|---|
| the onboarding wizard (`/start`) | a `users` row with no auth account | Supabase's own plain invitation mail |
| Team & Roles → Add, and the invite sheet | a `company_invitations` row | **nothing at all** |

The second is the one that mattered. `invite_member` recorded `member.invite`
in the audit trail and raised a notification telling the *other*
administrators that an invitation had been sent, while the person invited
heard nothing, ever. Both paths are gathered here now and both get the same
letter, merged by address so nobody receives two.

## What the letter says

One action, open Workfence, then the Android download, then four lines on what
the app actually does for the person holding the phone.

The company's own details are read from the database, not from the request:
its name, its first site, and the role the invitation was written for. A
caller cannot make this address a stranger or misdescribe who they are
joining.

Sent as HTML and plain text. The HTML is tables with inline colour, because an
email has to survive Gmail stripping the head and Outlook rendering through
Word, and it is read on a phone at a site gate.

## The app is linked, not attached

A release is about 38 MB. Base64-encoded into a message that is roughly 51 MB,
which is past Resend's 40 MB ceiling for a whole message and twice Gmail's
25 MB limit. Separately, Gmail and Outlook strip `.apk` attachments as malware
whatever their size. An attached build would not arrive; a link does.

The default points at a release asset whose name does not change between
builds, so the link keeps working after the next one:

```
https://github.com/rampradeepcs/app-site-track/releases/download/android-latest/workfence.apk
```

To publish a new build to that link:

```bash
gh release upload android-latest workfence.apk --clobber
```

The link is the filename, so the name is the contract: upload it as
`workfence.apk` or rename it first.

## Sending it

It needs one secret. **Without `RESEND_API_KEY` this falls back to Supabase's
own invitation mail**, which carries no web address of its own and no app, so
none of the above reaches anybody. The invite still goes out; it is just the
plain one.

```bash
supabase secrets set RESEND_API_KEY=re_... --project-ref fdxwxcwnzzcsnsxdhzjj
```

Optional:

| secret | default | why |
|---|---|---|
| `MAIL_FROM` | `Workfence <onboarding@resend.dev>` | Resend's shared sender is for testing only; real delivery needs a verified domain |
| `MAIL_REPLY_TO` | none | somewhere for a confused new employee to reply |
| `APP_URL` | the Vercel address | where the web button points |
| `APK_URL` | the release asset above | set it to `""` to drop the Android block from the letter entirely |
| `TENANT_BASE_DOMAIN` | none | with a wildcard domain the crew's address becomes `slug.yourdomain` instead of `/t/slug` |
| `INVITE_REDIRECT_URL` | the company's own address | where the one-time link lands |

## Who gets which link

`generateLink` is used rather than `inviteUserByEmail`, because the letter
around the link is ours: it returns the URL without mailing anything.

An address that already has an account cannot be invited again, so it gets a
magic link instead, the same door with a different key. Those are reported as
`already has an account` rather than as failures, because re-running an invite
for a crew of ten where two have already signed in should not look broken.

## Deploy

```bash
supabase functions deploy invite-crew --project-ref fdxwxcwnzzcsnsxdhzjj
```

## Recorded

Every send that actually happened writes `member.invite.sent` to the company's
audit trail, per person. A partial run can be retried, and what went out can be
read afterwards.
