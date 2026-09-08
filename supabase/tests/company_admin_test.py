"""Company self-editing, member status, and invitation visibility. Rolled back."""
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
        q("rollback to savepoint s")
        code = None
        try: code = e.args[0].get("C")
        except Exception: pass
        return str(e), code

as_pg()
bcc = one("select id from organizations where code='BCC'")
admin_auth = "c782ed3f-11d0-42db-8a57-24e289343160"
emp_auth = "ead41517-e414-44df-8b26-5249dc044074"
stamp = uuid.uuid4().hex[:6]

print("\n── the company edits itself ───────────────────────────")
as_user(admin_auth, bcc)
before = one("select name from organizations where id=:o", o=bcc)
r, err = attempt(lambda: one("select name from update_my_company(:p)", p=json.dumps({"name": f"BCC Renamed {stamp}", "industry": "Civil"})))
check("its administrator renames it", err is None and r.startswith("BCC Renamed"), f"{err} {r}")
# Set a branding key, then patch something else entirely: the key must live.
attempt(lambda: one("select name from update_my_company(:p)", p=json.dumps({"branding": {"appName": "Sitewatch"}})))
attempt(lambda: one("select name from update_my_company(:p)", p=json.dumps({"industry": "Roads"})))
check("branding survives a patch that did not mention it",
      one("select branding->>'appName' from organizations where id=:o", o=bcc) == "Sitewatch",
      str(one("select branding from organizations where id=:o", o=bcc))[:90])
check("the rename is in the company's audit trail",
      one("select count(*) from audit_log where org_id=:o and action='company.update'", o=bcc) >= 1)
r, err = attempt(lambda: one("select name from update_my_company(:p)", p=json.dumps({"name": "X"})))
check("a one-letter name is refused [22023]", err == "22023", f"{err} {r}")
as_user(emp_auth, bcc)
r, err = attempt(lambda: one("select name from update_my_company(:p)", p=json.dumps({"name": "Employee Renamed"})))
check("an employee cannot rename the company [42501]", err == "42501", f"{err} {r}")
as_pg()
q("update organizations set name=:n where id=:o", n=before, o=bcc)

print("\n── who has actually arrived ───────────────────────────")
as_pg()
never = one("select id from users where org_id=:o and auth_id is null limit 1", o=bcc)
if never is None:
    q("""insert into users (org_id, name, employee_code, role, designation, department, email, avatar_hue, status, shift_start, shift_end)
         values (:o, 'Typed Only', :c, 'employee', 'Worker', 'Site', :e, 100, 'active', 540, 1080)""",
      o=bcc, c=f"BCC-{stamp[:4]}", e=f"typed-{stamp}@apitest.invalid")
    never = one("select id from users where org_id=:o and email=:e", o=bcc, e=f"typed-{stamp}@apitest.invalid")
as_user(admin_auth, bcc)
rows = q("select membership_id, activated, invited from company_members()")
by = {str(r[0]): (r[1], r[2]) for r in rows}
check("company_members answers for every membership", len(rows) >= 5, str(len(rows)))
check("a linked admin reads as activated", by.get(str(one("select id from users where auth_id=:a and org_id=:o", a=admin_auth, o=bcc)), (None,))[0] is True)
check("a typed-in record reads as not activated", by.get(str(never)) == (False, False), str(by.get(str(never))))
as_pg(); email_of = one("select email from users where id=:u", u=never)
as_user(admin_auth, bcc)
r, err = attempt(lambda: one("select invite_member(:p)", p=json.dumps({"email": email_of, "role": "employee"})))
check("that record can still be invited", err is None, f"{err} {r}")
by2 = {str(r[0]): (r[1], r[2]) for r in q("select membership_id, activated, invited from company_members()")}
check("and now reads as invited", by2.get(str(never)) == (False, True), str(by2.get(str(never))))
inv = q("select id, email, has_membership from company_invitations_pending()")
check("the pending list shows it, marked as already having a row",
      any(str(i[1]).lower() == str(email_of).lower() and i[2] is True for i in inv), str(inv))
new_email = f"outsider-{stamp}@apitest.invalid"
attempt(lambda: one("select invite_member(:p)", p=json.dumps({"email": new_email, "role": "employee"})))
inv = q("select email, has_membership from company_invitations_pending()")
check("somebody with no row at all shows as waiting",
      any(str(i[0]).lower() == new_email and i[1] is False for i in inv), str(inv))
target = one("select id from company_invitations_pending() where lower(email)=:e", e=new_email)
r, err = attempt(lambda: q("select cancel_invitation(:i)", i=target))
check("an administrator cancels it", err is None, f"{err} {r}")
check("and it leaves the waiting list",
      not any(str(i[0]).lower() == new_email for i in q("select email, has_membership from company_invitations_pending()")))

print("\n── and none of it crosses a company ───────────────────")
as_user(emp_auth, bcc)
r, err = attempt(lambda: q("select * from company_members()"))
check("an employee gets nothing from company_members", err is None and len(r) == 0 if isinstance(r, list) else True, str(r)[:60])
as_pg()
conn.run("rollback")
print(f"\n{passed} passed, {failed} failed  (rolled back)")
sys.exit(0 if failed == 0 else 1)
