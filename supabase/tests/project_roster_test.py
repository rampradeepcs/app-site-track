"""
Changing a project's roster — does anybody get swept off it?

The old client did this as a delete of every row for the project followed by
an insert of whatever list the browser was holding. A list assembled from
state that had not finished loading took people off the site and did not put
them back, and the gap between the two statements could leave a project with
nobody on it at all.

set_project_members does it by difference, in one statement. These are the
properties that have to hold for that to be worth anything: the people who
should stay are untouched, the row that should go is the only one that goes,
and nobody gets to rewrite a roster that is not theirs.

Runs inside a single transaction that is rolled back at the end, so it
invents a company and people freely and leaves nothing behind.
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
def J(v): return v if isinstance(v, dict) else json.loads(v)

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

def roster(project):
    return sorted(r[0] for r in q(
        "select u.name from project_members pm join users u on u.id = pm.user_id where pm.project_id = :p",
        p=project))

# ---------------------------------------------------------------- fixtures
as_postgres()
stamp = uuid.uuid4().hex[:6]

def make_identity(email, name):
    aid = str(uuid.uuid4())
    q("""insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
         values (:id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', :e, now(), :m, '{"provider":"email","providers":["email"]}', now(), now())""",
      id=aid, e=email, m=json.dumps({"full_name": name}))
    return aid

org = one("insert into organizations (name, code, slug, status) values (:n, :c, :s, 'active') returning id",
          n=f"Roster Test {stamp}", c=f"RT{stamp[:3].upper()}", s=f"roster-{stamp}")
other = one("insert into organizations (name, code, slug, status) values (:n, :c, :s, 'active') returning id",
            n=f"Other Co {stamp}", c=f"OC{stamp[:3].upper()}", s=f"other-{stamp}")

def member(o, name, role, email=None):
    aid = make_identity(email or f"{name.lower()}-{stamp}@apitest.invalid", name) if email is not False else None
    return one("""insert into users (org_id, auth_id, name, employee_code, role, designation, department,
                                     email, avatar_hue, status, shift_start, shift_end, joined_at)
                  values (:o, :a, :n, :c, :r, 'Worker', 'Site', :e, 10, 'active', 540, 1080, now())
                  returning id""",
               o=o, a=aid, n=name, c=f"{name[:3].upper()}-{stamp[:4]}", r=role,
               e=email or f"{name.lower()}-{stamp}@apitest.invalid"), aid

boss_id, boss_auth = member(org, "Boss", "admin")
anna_id, _         = member(org, "Anna", "employee")
raj_id,  _         = member(org, "Raj", "employee")
new_id,  _         = member(org, "Newcomer", "employee")
worker_id, worker_auth = member(org, "Worker", "employee")
outsider_id, _     = member(other, "Outsider", "employee")

project = one("""insert into projects (org_id, name, code, status, location, geofence, zones, rules, client, created_at)
                 values (:o, 'Test Site', :c, 'active',
                         '{"lat":13.06,"lng":80.25}'::jsonb,
                         '{"kind":"circle","polygon":[],"center":{"lat":13.06,"lng":80.25},"radius":180,"bufferMeters":40}'::jsonb,
                         '[]'::jsonb, '{}'::jsonb, 'Test Client', now())
                 returning id""", o=org, c=f"TS-{stamp[:4]}")

as_user(boss_auth, org)
q("select set_project_members(:p, :u)", p=project, u=[anna_id, raj_id])
check("two people on the site to begin with", roster(project) == ["Anna", "Raj"], str(roster(project)))

print("\n── adding one person ───────────────────────────────────")
before = one("select assigned_at from project_members where project_id=:p and user_id=:u", p=project, u=anna_id)
r, err = attempt(lambda: one("select set_project_members(:p, :u)", p=project, u=[anna_id, raj_id, new_id]))
check("the call succeeds", err is None, f"{err} {r}")
check("it reports one added and none removed", err is None and J(r) == {"added": 1, "removed": 0}, str(r))
# The property the old code broke.
check("THE OTHERS ARE STILL THERE", roster(project) == ["Anna", "Newcomer", "Raj"], str(roster(project)))
after = one("select assigned_at from project_members where project_id=:p and user_id=:u", p=project, u=anna_id)
check("an untouched row is genuinely untouched (assigned_at unchanged)", before == after, f"{before} -> {after}")

print("\n── removing one person ─────────────────────────────────")
r, err = attempt(lambda: one("select set_project_members(:p, :u)", p=project, u=[anna_id, new_id]))
check("it reports one removed", err is None and J(r) == {"added": 0, "removed": 1}, str(r))
check("Raj is gone and the other two are not", roster(project) == ["Anna", "Newcomer"], str(roster(project)))

print("\n── saying the same thing twice ─────────────────────────")
r, err = attempt(lambda: one("select set_project_members(:p, :u)", p=project, u=[anna_id, new_id]))
check("a repeat call changes nothing", err is None and J(r) == {"added": 0, "removed": 0}, str(r))
check("roster unchanged", roster(project) == ["Anna", "Newcomer"], str(roster(project)))

print("\n── emptying it ─────────────────────────────────────────")
r, err = attempt(lambda: one("select set_project_members(:p, :u)", p=project, u=[]))
check("an empty roster is allowed and removes both", err is None and J(r) == {"added": 0, "removed": 2}, str(r))
check("nobody on the site", roster(project) == [], str(roster(project)))
q("select set_project_members(:p, :u)", p=project, u=[anna_id, raj_id])

print("\n── who may ─────────────────────────────────────────────")
as_user(worker_auth, org)
r, err = attempt(lambda: one("select set_project_members(:p, :u)", p=project, u=[worker_id]))
check("a plain employee may not rewrite a roster [42501]", err == "42501", f"{err} {r}")
as_user(boss_auth, org)
check("…and the roster survived the attempt", roster(project) == ["Anna", "Raj"], str(roster(project)))

r, err = attempt(lambda: one("select set_project_members(:p, :u)", p=project, u=[anna_id, outsider_id]))
check("somebody from another company cannot be added [22023]", err == "22023", f"{err} {r}")
check("…and that attempt left the roster alone", roster(project) == ["Anna", "Raj"], str(roster(project)))

r, err = attempt(lambda: one("select set_project_members(:p, :u)",
                             p="00000000-0000-0000-0000-000000000000", u=[anna_id]))
check("an unknown project is refused [22023]", err == "22023", f"{err} {r}")

# An admin of the other company must not reach into this one's project.
as_postgres()
_, other_boss_auth = member(other, "OtherBoss", "admin")
as_user(other_boss_auth, other)
r, err = attempt(lambda: one("select set_project_members(:p, :u)", p=project, u=[outsider_id]))
check("another company's admin cannot touch this project [42501]", err == "42501", f"{err} {r}")

as_user(boss_auth, org)
check("roster still intact at the end", roster(project) == ["Anna", "Raj"], str(roster(project)))

as_postgres()
conn.run("rollback")
print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
