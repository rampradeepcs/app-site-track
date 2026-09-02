"""Negative tests against the live database. Every case rolls back.

A case PASSES when the database refuses what should be refused, or hides
what should be hidden. A FAIL here is a real hole.
"""
import pg8000.dbapi, os, ssl, json

ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
con = pg8000.dbapi.connect(user="postgres.fdxwxcwnzzcsnsxdhzjj", password=os.environ["PGPW"],
    host="aws-0-ap-northeast-1.pooler.supabase.com", port=5432, database="postgres", ssl_context=ctx)
cur = con.cursor()

ORG = "7a348717-4043-4581-bdb8-36f0e4ff4d58"
EMPLOYEE_AUTH = "ead41517-e414-44df-8b26-5249dc044074"   # Arun Kumar, employee
MANAGER_AUTH  = "3beac5f3-241e-400e-b8fe-91c9c448f17f"   # Suresh Babu, manager
ADMIN_AUTH    = "c782ed3f-11d0-42db-8a57-24e289343160"   # Rajesh Kumar, admin
ORPHAN_AUTH   = "26f73577-35dc-4b36-b704-89aa745fee42"   # signed in, on no company

results = []

def act_as(uid, email="x@example.com"):
    cur.execute("set local role authenticated")
    cur.execute("select set_config('request.jwt.claims', %s, true)",
                (json.dumps({"sub": uid, "role": "authenticated", "email": email}),))

def unact():
    try: cur.execute("reset role")
    except Exception: pass

def case(module, name, fn, expect):
    """expect: 'refused' (must raise) or 'hidden' (must return 0 rows)."""
    cur.execute("begin")
    try:
        outcome = fn()
        unact()
        if expect == "refused":
            ok, detail = False, f"ALLOWED — returned {outcome!r}"
        else:
            ok = (outcome == 0)
            detail = "0 rows" if ok else f"LEAKED {outcome} row(s)"
    except Exception as e:
        unact()
        msg = str(e)
        for k in ("'M': '", '"M": "'):
            if k in msg:
                msg = msg.split(k, 1)[1].split("'")[0][:70]; break
        ok, detail = (expect == "refused"), f"refused: {msg[:70]}"
    finally:
        try: cur.execute("rollback")
        except Exception: pass
    results.append((module, name, ok, detail))

def rival():
    """A second tenant, inside the current transaction."""
    cur.execute("""insert into organizations (name, code, industry, contact_name,
                     contact_email, contact_phone, country, timezone, status, billing, branding)
                   values ('Rival Co','RIV-TEST','Construction','R','r@rival.test','',
                           'IN','Asia/Kolkata','active','{}','{}') returning id""")
    rorg = cur.fetchall()[0][0]
    cur.execute("""insert into public.users (auth_id, org_id, name, email, role, status, joined_at)
                   values (%s, %s, 'Rival Admin', 'rival@rival.test', 'admin', 'active', now())
                   returning id""", (ORPHAN_AUTH, rorg))
    return rorg, cur.fetchall()[0][0]

def count_as(uid, sql, params=()):
    act_as(uid)
    cur.execute(sql, params)
    return cur.fetchall()[0][0]

# ── A. tenant isolation: a rival admin must not see this company's data ──
for table in ["users", "attendance", "work_updates", "projects", "labour_teams",
              "project_notes", "compensation", "payroll_runs", "location_points",
              "shifts", "invoices", "subscriptions"]:
    def read(t=table):
        rival()
        return count_as(ORPHAN_AUTH, f"select count(*) from public.{t} where org_id = %s", (ORG,))
    case("tenant isolation", f"rival admin reads {table}", read, "hidden")

# ── B. tenant isolation: writing into somebody else's tenant ──
def write_attendance():
    cur.execute("select id from projects where org_id=%s limit 1", (ORG,))
    proj = cur.fetchall()[0][0]
    rival()
    act_as(ORPHAN_AUTH)
    # Literal ids, so the policy is actually evaluated rather than the
    # statement inserting nothing because RLS hid its source rows.
    cur.execute("""insert into attendance (org_id, employee_id, project_id, date, status)
                   values (%s, %s, %s, current_date, 'present')""",
                (ORG, "7b21045d-799c-4fd5-9e0b-97d84a27626b", proj))
    return "insert accepted"
case("tenant isolation", "rival writes attendance into this org", write_attendance, "refused")

def write_user():
    rival()
    act_as(ORPHAN_AUTH)
    cur.execute("""insert into public.users (org_id, name, email, role, status, joined_at)
                   values (%s,'Injected','injected@rival.test','admin','active',now())""", (ORG,))
    return "insert accepted"
case("tenant isolation", "rival inserts a user into this org", write_user, "refused")

# ── C. privilege escalation inside a tenant ──
def self_promote():
    act_as(EMPLOYEE_AUTH)
    cur.execute("update public.users set role='admin' where auth_id=%s", (EMPLOYEE_AUTH,))
    cur.execute("reset role")
    cur.execute("select role from public.users where auth_id=%s", (EMPLOYEE_AUTH,))
    got = cur.fetchall()[0][0]
    if got == "admin":
        return "role is now admin"
    raise Exception("{'M': 'no rows updated — role unchanged'}")
case("privilege", "employee promotes self to admin", self_promote, "refused")

def edit_colleague():
    act_as(EMPLOYEE_AUTH)
    cur.execute("update public.users set name='Hacked' where auth_id=%s", (MANAGER_AUTH,))
    cur.execute("reset role")
    cur.execute("select name from public.users where auth_id=%s", (MANAGER_AUTH,))
    if cur.fetchall()[0][0] == "Hacked":
        return "colleague renamed"
    raise Exception("{'M': 'no rows updated'}")
case("privilege", "employee edits a colleague's record", edit_colleague, "refused")

def delete_user():
    act_as(EMPLOYEE_AUTH)
    cur.execute("delete from public.users where auth_id=%s", (MANAGER_AUTH,))
    cur.execute("reset role")
    cur.execute("select count(*) from public.users where auth_id=%s", (MANAGER_AUTH,))
    if cur.fetchall()[0][0] == 0:
        return "colleague deleted"
    raise Exception("{'M': 'no rows deleted'}")
case("privilege", "employee deletes a colleague", delete_user, "refused")

def employee_reads_pay():
    return count_as(EMPLOYEE_AUTH,
        "select count(*) from compensation where employee_id <> (select id from public.users where auth_id=%s)",
        (EMPLOYEE_AUTH,))
case("privilege", "employee reads others' compensation", employee_reads_pay, "hidden")

# ── D. provisioning refusals ──
GOOD = {"company":"X Co","admin":{"name":"A","email":"a@x.test"},
        "site":{"name":"S","address":"","location":{"lat":1,"lng":2},"radius":100,
                "trackingMode":"full-shift"},"crew":[]}

def provision_twice():
    act_as(ADMIN_AUTH)   # already has a users row
    cur.execute("select public.provision_company(%s::jsonb)", (json.dumps(GOOD),))
    return "second company created"
case("provisioning", "caller already in an organisation", provision_twice, "refused")

def provision_anon():
    cur.execute("set local role authenticated")
    cur.execute("select set_config('request.jwt.claims', '{}', true)")
    cur.execute("select public.provision_company(%s::jsonb)", (json.dumps(GOOD),))
    return "created without a session"
case("provisioning", "no signed-in caller", provision_anon, "refused")

for label, mutate in [
    ("empty company name", lambda p: {**p, "company": "   "}),
    ("no site",            lambda p: {k: v for k, v in p.items() if k != "site"}),
    ("site without a location", lambda p: {**p, "site": {**p["site"], "location": None}}),
    ("empty admin name",   lambda p: {**p, "admin": {**p["admin"], "name": ""}}),
]:
    def bad(m=mutate):
        act_as(ORPHAN_AUTH)
        cur.execute("select public.provision_company(%s::jsonb)", (json.dumps(m(GOOD)),))
        return "created anyway"
    case("provisioning", label, bad, "refused")

# ── E. claim_user_record refusals ──
def claim_anon():
    cur.execute("set local role authenticated")
    cur.execute("select set_config('request.jwt.claims', '{}', true)")
    cur.execute("select public.claim_user_record()")
    got = cur.fetchall()[0][0]
    if got is None:
        raise Exception("{'M': 'returned null'}")
    return got
case("identity claim", "no signed-in caller", claim_anon, "refused")

def claim_taken():
    act_as(EMPLOYEE_AUTH)   # already linked
    cur.execute("select public.claim_user_record()")
    got = cur.fetchall()[0][0]
    cur.execute("reset role")
    cur.execute("select id from public.users where auth_id=%s", (EMPLOYEE_AUTH,))
    own = cur.fetchall()[0][0]
    if str(got) == str(own):
        raise Exception("{'M': 'returned their own row, took nothing'}")
    return f"claimed {got}"
case("identity claim", "already-linked caller takes nothing new", claim_taken, "refused")

# ── F. constraints and invalid values ──
def dup_email():
    cur.execute("""insert into public.users (org_id, name, email, role, status, joined_at)
                   select org_id, 'Clone', email, 'employee', 'active', now()
                     from public.users limit 1""")
    return "duplicate accepted"
case("constraints", "duplicate email", dup_email, "refused")

def bad_enum():
    cur.execute("""insert into public.users (org_id, name, email, role, status, joined_at)
                   values (%s,'Bad','bad@x.test','superuser','active',now())""", (ORG,))
    return "invalid role accepted"
case("constraints", "invalid role value", bad_enum, "refused")

def null_email():
    cur.execute("""insert into public.users (org_id, name, email, role, status, joined_at)
                   values (%s,'NoMail',null,'employee','active',now())""", (ORG,))
    return "null email accepted"
case("constraints", "user without an email", null_email, "refused")

def orphan_attendance():
    cur.execute("""insert into attendance (org_id, employee_id, project_id, date, status)
                   values (%s, gen_random_uuid(), gen_random_uuid(), current_date, 'present')""", (ORG,))
    return "attendance for a non-existent employee accepted"
case("constraints", "attendance referencing nobody", orphan_attendance, "refused")

def negative_radius():
    cur.execute("select id from projects where org_id=%s limit 1", (ORG,))
    rows = cur.fetchall()
    if not rows:
        raise Exception("{'M': 'no project to test'}")
    cur.execute("""update projects set geofence = jsonb_set(geofence::jsonb,'{radius}','-500')
                   where id=%s""", (rows[0][0],))
    cur.execute("select geofence->>'radius' from projects where id=%s", (rows[0][0],))
    return f"radius set to {cur.fetchall()[0][0]}"
case("constraints", "negative geofence radius", negative_radius, "refused")

# ── report ──
print(f"{'module':<20} {'case':<44} result")
print("-" * 100)
mod = None
for m, n, ok, d in results:
    if m != mod: print(); mod = m
    print(f"{m:<20} {n:<44} {'PASS' if ok else 'FAIL'}  {d}")
passed = sum(1 for _, _, ok, _ in results if ok)
print(f"\n{passed}/{len(results)} passed")

cur.execute("select count(*) from organizations"); o = cur.fetchall()[0][0]
cur.execute("select count(*) from public.users"); u = cur.fetchall()[0][0]
print(f"after all rollbacks — organizations: {o}, users: {u}")
con.close()
