# invite-crew

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

## Deploy

```bash
supabase functions deploy invite-crew --project-ref fdxwxcwnzzcsnsxdhzjj
```

## Delivery

Invitations go out through whatever email channel the project has configured
under Authentication → Emails. Supabase's built-in sender is rate-limited and
meant for testing; a real crew needs SMTP configured, or invitations past the
first few will come back as failures — which the app reports rather than
swallows.
