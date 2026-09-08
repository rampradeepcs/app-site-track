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
