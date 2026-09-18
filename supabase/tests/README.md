# Database tests

Scenarios that need several identities and several companies, run against a
real Postgres inside one transaction that is rolled back at the end — so they
invent people and companies freely and leave nothing behind.

```bash
PGPW='<database password>' python3 supabase/tests/multi_company_test.py
```

`notify_test.py` covers the notification raised by each membership and
company event, and who may read it.

`company_admin_test.py` covers a company editing itself, which of its
membership rows have a person behind them yet, and the invitations still
waiting — including the ones for people who have no row at all and so appear
on no other list.

`multi_company_test.py` covers the multi-company model end to end: inviting,
accepting, isolation by active company, removal and what survives it,
re-joining, and founding a second company. It asserts refusals as often as it
asserts successes, because the interesting half of a tenancy model is what it
will not do.

`replay.sh` is the one to run after adding a migration. It replays the whole
tree onto an empty Postgres in Docker and stops at the first file that fails,
which is the check nothing else performs — the scenario tests all run against a
database that already exists, so a tree that cannot build one passes them all.

```bash
./supabase/tests/replay.sh                                   # does it apply?
PGURL='<database url>' ./supabase/tests/replay.sh --diff      # does it build THIS database?
```

The `--diff` form is the more valuable half. A tree can apply cleanly and still
produce a different database — a helper left at an older definition, a policy
rewritten in production and never committed — and nothing errors when it does.
That is how this repository came to describe a system with an unordered
`limit 1` deciding which company a request belonged to, months after production
had stopped doing that. `replay_diff.py` compares function bodies, policy
expressions, constraints, indexes, columns, enums, RLS, triggers and sequences,
and distinguishes a genuine difference from one that is only comments.

`provision_client_test.py` covers onboarding a client from the platform
console: who may call the RPC, that the client comes out whole — organisation,
subscription and an administrator row waiting to be claimed — that the
negotiated plan and overrides survive, and the subdomain rules, which matter
because a slug becomes a hostname and an operator can type one in. It applies
its own migration first, so it also proves that file replays.

`project_roster_test.py` covers `set_project_members`: adding somebody to a
site leaves everyone already on it alone, removing one removes only that one,
saying the same thing twice changes nothing, and neither a plain employee nor
another company's administrator may rewrite a roster. The first of those is
the property the old delete-then-insert client code broke.
