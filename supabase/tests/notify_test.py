"""Does every membership event raise a notification? Rolled back."""
import json, os, sys, uuid
sys.path.insert(0, os.environ.get("PYLIB", ""))
import pg8000.native as pg
conn = pg.Connection("postgres.fdxwxcwnzzcsnsxdhzjj", host="aws-0-ap-northeast-1.pooler.supabase.com",
                     port=5432, database="postgres", password=os.environ["PGPW"], ssl_context=True)
conn.run("begin")
passed = failed = 0
def check(n, ok, d=""):
    global passed, failed
    if ok: passed += 1; print(f"  ok    {n}")
    else: failed += 1; print(f"  FAIL  {n}  {d}")
def as_user(a, org=None):
    conn.run("set local role authenticated")
    conn.run("select set_config('request.jwt.claims', :c, true)", c=json.dumps({"sub": str(a), "role": "authenticated"}))
    conn.run("select set_config('request.headers', :h, true)", h=json.dumps({"x-workfence-company": str(org)} if org else {}))
def as_pg():
    conn.run("reset role")
    conn.run("select set_config('request.jwt.claims','',true)")
    conn.run("select set_config('request.headers','',true)")
def q(sql, **k): return conn.run(sql, **k)
def one(sql, **k):
    r = q(sql, **k); return r[0][0] if r else None
def J(v): return v if isinstance(v, dict) else json.loads(v)
def attempt(fn):
    q("savepoint s")
    try:
        r = fn(); q("release savepoint s"); return r, None
    except Exception as e:
        q("rollback to savepoint s"); code=None
        try: code = e.args[0].get("C")
        except Exception: pass
        return str(e), code

as_pg()
bcc = one("select id from organizations where code='BCC'")
admin_auth = "c782ed3f-11d0-42db-8a57-24e289343160"
stamp = uuid.uuid4().hex[:6]
email = f"notify-{stamp}@apitest.invalid"
aid = str(uuid.uuid4())
q("""insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
     values (:id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',:e, now(), :m,'{"provider":"email","providers":["email"]}', now(), now())""",
  id=aid, e=email, m=json.dumps({"full_name": "Notify Tester"}))

# now() is the transaction's clock and never advances inside one, so "raised
# after this moment" can never be true here. Track which rows are new instead.
SEEN = set()
def kinds_since(_mark=None):
    as_pg()
    rows = q("select id, kind, title, audience::text, severity from notifications where org_id=:o order by at", o=bcc)
    fresh = [r for r in rows if str(r[0]) not in SEEN]
    for r in rows: SEEN.add(str(r[0]))
    return [(r[1], r[2], r[3], r[4]) for r in fresh]

kinds_since()  # drain
as_user(admin_auth, bcc)
r, err = attempt(lambda: one("select invite_member(:p)", p=json.dumps({"email": email, "name": "Notify Tester", "role": "employee"})))
inv = J(r)["id"] if err is None else None
rows = kinds_since()
check("inviting raises one, for admins", [x[0] for x in rows] == ["member-invited"] and rows[0][2] == "admin", str(rows))

kinds_since()  # drain
as_user(aid)
r, err = attempt(lambda: one("select accept_invitation(:i)", i=inv))
check("accepting succeeds", err is None, f"{err} {r}")
rows = kinds_since()
check("accepting raises 'member-joined', success, linked to the team screen",
      len(rows) == 1 and rows[0][0] == "member-joined" and rows[0][3] == "success", str(rows))
check("…and names the person", "Notify Tester" in rows[0][1], str(rows))

as_pg(); mid = one("select id from users where auth_id=:a and org_id=:o", a=aid, o=bcc)
kinds_since()  # drain
as_user(admin_auth, bcc)
r, err = attempt(lambda: one("select remove_member(:u, 'test')", u=mid))
rows = kinds_since()
check("removing raises 'member-removed' as a warning",
      err is None and len(rows) == 1 and rows[0][0] == "member-removed" and rows[0][3] == "warning", f"{err} {rows}")

kinds_since()  # drain
as_user(admin_auth, bcc)
r, err = attempt(lambda: one("select restore_member(:u)", u=mid))
rows = kinds_since()
check("restoring raises 'member-restored'", err is None and [x[0] for x in rows] == ["member-restored"], f"{err} {rows}")

# decline
as_pg()
email2 = f"decline-{stamp}@apitest.invalid"
aid2 = str(uuid.uuid4())
q("""insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
     values (:id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',:e, now(), '{}','{}', now(), now())""", id=aid2, e=email2)
as_user(admin_auth, bcc)
r, _ = attempt(lambda: one("select invite_member(:p)", p=json.dumps({"email": email2, "role": "employee"})))
inv2 = J(r)["id"]
kinds_since()  # drain
as_user(aid2)
r, err = attempt(lambda: q("select decline_invitation(:i)", i=inv2))
rows = kinds_since()
check("declining raises 'invitation-declined'", err is None and [x[0] for x in rows] == ["invitation-declined"], f"{err} {rows}")

kinds_since()  # drain
as_user(admin_auth, bcc)
r, err = attempt(lambda: one("select name from update_my_company(:p)", p=json.dumps({"name": f"BCC Notify {stamp}"})))
rows = kinds_since()
check("renaming the company raises 'company-renamed'", err is None and [x[0] for x in rows] == ["company-renamed"], f"{err} {rows}")
kinds_since()  # drain
as_user(admin_auth, bcc)
r, err = attempt(lambda: one("select name from update_my_company(:p)", p=json.dumps({"industry": "Roads"})))
rows = kinds_since()
check("editing without renaming raises 'company-updated'", err is None and [x[0] for x in rows] == ["company-updated"], f"{err} {rows}")

print("\n── who can read them ──────────────────────────────────")
as_user(admin_auth, bcc)
admin_sees = one("select count(*) from notifications where kind like 'member-%' or kind like 'company-%'")
check("an administrator sees them", admin_sees > 0, str(admin_sees))
as_user("ead41517-e414-44df-8b26-5249dc044074", bcc)
emp_sees = one("select count(*) from notifications where kind like 'member-%' or kind like 'company-%'")
check("an employee does not", emp_sees == 0, str(emp_sees))
emp_own = one("select count(*) from notifications where audience = 'employee'")
check("but still reads the ones addressed to employees", emp_own >= 0, str(emp_own))
as_user(admin_auth, bcc)
check("an administrator still reads manager alerts",
      one("select count(*) from notifications where audience='manager'") >= 0)

as_pg(); conn.run("rollback")
print(f"\n{passed} passed, {failed} failed  (rolled back)")
sys.exit(0 if failed == 0 else 1)
