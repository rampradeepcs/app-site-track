"""
One person, several companies — does the database keep them apart?

Runs inside a single transaction that is rolled back at the end, so it can
invent people and companies freely and leave nothing behind.
"""
import json, os, sys, uuid
sys.path.insert(0, os.environ.get("PYLIB", ""))
import pg8000.native as pg

conn = pg.Connection("postgres.fdxwxcwnzzcsnsxdhzjj", host="aws-0-ap-northeast-1.pooler.supabase.com",
                     port=5432, database="postgres", password=os.environ["PGPW"], ssl_context=True)
conn.run("begin")
passed = failed = 0
def check(name, ok, detail=""):
    global passed, failed
    if ok: passed += 1; print(f"  ok    {name}")
    else: failed += 1; print(f"  FAIL  {name}  {detail}")

def as_user(auth_id, org=None):
    conn.run("set local role authenticated")
    conn.run("select set_config('request.jwt.claims', :c, true)", c=json.dumps({"sub": str(auth_id), "role": "authenticated"}))
    conn.run("select set_config('request.headers', :h, true)", h=json.dumps({"x-workfence-company": str(org)} if org else {}))
def as_postgres():
    conn.run("reset role")
    conn.run("select set_config('request.jwt.claims', '', true)")
    conn.run("select set_config('request.headers', '', true)")
def q(sql, **kw): return conn.run(sql, **kw)
def one(sql, **kw): r = q(sql, **kw); return r[0][0] if r else None
def J(v):
    """jsonb comes back decoded already; a string only if it did not."""
    return v if isinstance(v, dict) else json.loads(v)

def attempt(fn):
    """Run fn inside a savepoint; return (result, error_code)."""
    q("savepoint s")
    try:
        r = fn(); q("release savepoint s"); return r, None
    except Exception as e:
        q("rollback to savepoint s")
        msg = str(e); code = None
        try: code = e.args[0].get("C")
        except Exception: pass
        return msg, code

# ---------------------------------------------------------------- fixtures
as_postgres()
bcc = one("select id from organizations where code='BCC'")
mag = one("select id from organizations where slug='magnolia'")
bcc_admin_auth = "c782ed3f-11d0-42db-8a57-24e289343160"
rajesh_membership = one("select id from users where auth_id=:a and org_id=:o", a=bcc_admin_auth, o=bcc)
superadmin_auth = "5d98e4bb-90db-411b-b766-39291d7228b2"

def make_identity(email, name):
    aid = str(uuid.uuid4())
    q("""insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
         values (:id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', :e, now(), :m, '{"provider":"email","providers":["email"]}', now(), now())""",
      id=aid, e=email, m=json.dumps({"full_name": name}))
    return aid

# MAGNOLIA needs a linked administrator to act as.
mag_admin_auth = one("select auth_id from users where org_id=:o and role='admin' and auth_id is not null limit 1", o=mag)
if not mag_admin_auth:
    mag_admin_auth = make_identity(f"mag-admin-{uuid.uuid4().hex[:6]}@apitest.invalid", "Magnolia Admin")
    mid = one("select id from users where org_id=:o and role='admin' limit 1", o=mag)
    q("update users set auth_id=:a where id=:m", a=mag_admin_auth, m=mid)
mag_admin_membership = one("select id from users where auth_id=:a and org_id=:o", a=mag_admin_auth, o=mag)

stamp = uuid.uuid4().hex[:6]
x_email = f"multi-{stamp}@apitest.invalid"
x_auth = make_identity(x_email, "Multi Tester")

print("\n── inviting, and who may ──────────────────────────────")
as_user(bcc_admin_auth, bcc)
r, err = attempt(lambda: one("select invite_member(:p)", p=json.dumps({"email": x_email, "name": "Multi Tester", "role": "employee", "designation": "Mason"})))
check("BCC admin invites a new address into BCC", err is None, f"{err} {r}")
inv_bcc = J(r)["id"] if err is None else None
check("…and the invitation says this is a new Workfence user? (they exist but are companyless — existingUser reflects the identity)", err is None and J(r)["existingUser"] is True, r)
as_user(bcc_admin_auth, mag)
r, err = attempt(lambda: one("select invite_member(:p)", p=json.dumps({"email": x_email, "role": "employee"})))
check("BCC admin naming MAGNOLIA is refused [42501]", err == "42501", f"{err} {r}")
as_user(x_auth)
r, err = attempt(lambda: one("select invite_member(:p)", p=json.dumps({"email": "z@apitest.invalid"})))
check("a companyless person cannot invite anyone [42501]", err == "42501", f"{err} {r}")

print("\n── accepting ───────────────────────────────────────────")
as_user(x_auth)
rows = q("select id, org_id, company, role from my_invitations()")
check("X sees exactly the BCC invitation", len(rows) == 1 and str(rows[0][1]) == str(bcc), str(rows))
check("X has no companies yet", len(q("select * from my_companies()")) == 0)
check("X naming BCC before accepting sees no BCC users", one("select count(*) from users") == 0)
r, err = attempt(lambda: one("select accept_invitation(:i)", i=inv_bcc))
check("X accepts BCC", err is None, f"{err} {r}")
x_bcc = J(r)["membershipId"] if err is None else None
check("my_companies now lists BCC as employee", [ (str(c[0]), str(c[1])) for c in q("select org_id, role from my_companies()") ] == [(str(bcc), "employee")], str(q("select org_id, role from my_companies()")))

as_user(mag_admin_auth, mag)
r, err = attempt(lambda: one("select invite_member(:p)", p=json.dumps({"email": x_email, "role": "manager", "designation": "Site Engineer"})))
check("MAGNOLIA admin invites the same person as a manager", err is None, f"{err} {r}")
inv_mag = J(r)["id"] if err is None else None
check("the invitation recognises the existing identity", err is None and J(r)["existingUser"] is True)
as_user(x_auth)
r, err = attempt(lambda: one("select accept_invitation(:i)", i=inv_mag))
check("X accepts MAGNOLIA", err is None, f"{err} {r}")
x_mag = J(r)["membershipId"] if err is None else None
cos = q("select org_id, role from my_companies() order by joined_at")
check("X now belongs to two companies with different roles", len(cos) == 2 and {str(c[0]): c[1] for c in cos} == {str(bcc): "employee", str(mag): "manager"}, str(cos))
# Structural, so asked without a company: under RLS and naming none, two
# memberships resolve to nothing — which is the isolation, not the count.
as_postgres()
check("one identity, two membership rows, no second account",
      one("select count(*) from users where auth_id=:a", a=x_auth) == 2
      and one("select count(*) from auth.users where lower(email)=:e", e=x_email) == 1)
as_user(x_auth)

print("\n── isolation by active company ────────────────────────")
bcc_projects = None; mag_projects = None
as_user(x_auth, bcc)
bcc_projects = one("select count(*) from projects")
check("X in BCC sees BCC's projects (not zero)", bcc_projects > 0, str(bcc_projects))
check("X in BCC: every visible user is BCC's", one("select count(*) from users where org_id <> :o", o=bcc) == 0)
check("X in BCC: auth_user_id is the BCC membership", str(one("select private.auth_user_id()")) == str(x_bcc))
check("X in BCC is not an admin", one("select private.is_org_admin()") is False)
as_user(x_auth, mag)
mag_projects = one("select count(*) from projects")
check("X in MAGNOLIA sees MAGNOLIA's projects", mag_projects > 0 and one("select count(*) from projects where org_id <> :o", o=mag) == 0, str(mag_projects))
check("X in MAGNOLIA is a manager there", one("select private.is_org_admin()") is True)
check("X in MAGNOLIA: auth_user_id is the MAGNOLIA membership", str(one("select private.auth_user_id()")) == str(x_mag))
as_user(x_auth)
check("X naming no company, with two, sees nothing", one("select count(*) from projects") == 0 and one("select count(*) from users") == 0)
as_user(x_auth, str(uuid.uuid4()))
check("X naming a company they are not in sees nothing", one("select count(*) from projects") == 0)
as_user(x_auth, bcc)
proj_mag = one("select id from projects where org_id=:o limit 1", o=mag)
as_postgres(); proj_mag = one("select id from projects where org_id=:o limit 1", o=mag); as_user(x_auth, bcc)
r, err = attempt(lambda: q("insert into attendance (id, org_id, employee_id, project_id, date, check_in, status) values (gen_random_uuid(), :o, :e, :p, current_date, '{}'::jsonb, 'present')", o=mag, e=x_mag, p=proj_mag))
check("X in BCC cannot write attendance into MAGNOLIA [42501]", err == "42501", f"{err} {r}")
r, err = attempt(lambda: q("insert into attendance (id, org_id, employee_id, project_id, date, check_in, status) values (gen_random_uuid(), :o, :e, :p, current_date, '{}'::jsonb, 'present')", o=bcc, e=x_mag, p=one("select id from projects limit 1")))
check("X in BCC cannot write attendance as their MAGNOLIA self [42501]", err == "42501", f"{err} {r}")

print("\n── the people who were already here ───────────────────")
as_user(bcc_admin_auth)
check("Rajesh (one company, no header) still resolves to BCC", str(one("select private.auth_org_id()")) == str(bcc))
check("…and sees his people", one("select count(*) from users") >= 5)
as_user(superadmin_auth)
check("the platform owner still sees every company", one("select count(*) from organizations") >= 2)
check("…and every membership", one("select count(*) from users") > 9)

print("\n── removal ────────────────────────────────────────────")
as_user(bcc_admin_auth, bcc)
r, err = attempt(lambda: one("select remove_member(:u)", u=rajesh_membership))
check("an admin cannot remove themselves [42501]", err == "42501", f"{err} {r}")
r, err = attempt(lambda: one("select remove_member(:u, 'contract ended')", u=x_bcc))
check("BCC admin removes X from BCC", err is None, f"{err} {r}")
check("the row is kept, marked revoked, with a removed_at", q("select status::text, removed_at is not null from users where id=:u", u=x_bcc)[0] == ["revoked", True], str(q("select status::text, removed_at from users where id=:u", u=x_bcc)))
check("the company's audit trail records it", one("select count(*) from audit_log where org_id=:o and action='member.remove' and target=:t", o=bcc, t=str(x_bcc)) == 1)
as_user(x_auth, bcc)
check("X naming BCC now sees nothing", one("select count(*) from projects") == 0 and one("select count(*) from users") == 0)
check("X's BCC membership no longer resolves", one("select private.auth_org_id()") is None)
as_user(x_auth, mag)
check("X in MAGNOLIA is unaffected", one("select count(*) from projects") == mag_projects and one("select private.is_org_admin()") is True)
as_user(x_auth)
cos = q("select org_id from my_companies()")
check("BCC has vanished from X's companies; MAGNOLIA remains", [str(c[0]) for c in cos] == [str(mag)], str(cos))
as_user(mag_admin_auth, mag)
r, err = attempt(lambda: one("select remove_member(:u)", u=x_mag))
check("MAGNOLIA removes X too", err is None, f"{err} {r}")
as_user(x_auth)
check("with no company left, X sees no companies", len(q("select * from my_companies()")) == 0)
check("…but the identity still exists", one("select count(*) from profiles where auth_id=:a", a=x_auth) == 1)

print("\n── re-joining after removal ───────────────────────────")
as_user(bcc_admin_auth, bcc)
r, err = attempt(lambda: one("select invite_member(:p)", p=json.dumps({"email": x_email, "role": "employee"})))
check("BCC may invite X again", err is None, f"{err} {r}")
inv2 = J(r)["id"] if err is None else None
as_user(x_auth)
r, err = attempt(lambda: one("select accept_invitation(:i)", i=inv2))
check("X accepts, and the old row is revived rather than duplicated", err is None and J(r)["membershipId"] == str(x_bcc), f"{err} {r}")
as_user(x_auth, bcc)
check("X is back in BCC", one("select count(*) from projects") == bcc_projects)
as_postgres()
check("still exactly two membership rows — revived, not duplicated",
      one("select count(*) from users where auth_id=:a", a=x_auth) == 2)
as_user(x_auth, bcc)

print("\n── founding a second company ──────────────────────────")
as_user(bcc_admin_auth, bcc)
r, err = attempt(lambda: one("select create_company(:p)", p=json.dumps({"company": f"Rajesh Second Co {stamp}", "admin": {"name": "Rajesh Kumar", "email": "rajesh@borncreative.in"}, "site": {"name": "Yard", "location": {"lat": 11.0, "lng": 77.0}, "radius": 120}})))
check("an existing administrator founds a second company", err is None, f"{err} {r}")
new_org = J(r)["orgId"] if err is None else None
as_user(bcc_admin_auth)
cos = q("select org_id, role from my_companies()")
check("Rajesh now has two companies, owner of both", len(cos) == 2 and all(c[1] == "admin" for c in cos), str(cos))
as_user(bcc_admin_auth, new_org)
check("in the new company he sees only its one site", one("select count(*) from projects") == 1 and one("select count(*) from users") == 1)
as_user(bcc_admin_auth, bcc)
check("in BCC nothing has changed", one("select count(*) from projects") == bcc_projects)

as_postgres()
conn.run("rollback")
print(f"\n{passed} passed, {failed} failed  (transaction rolled back)")
sys.exit(0 if failed == 0 else 1)
