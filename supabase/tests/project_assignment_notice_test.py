"""
Being put on a site, and being told.

Assigning somebody to a project was silent. set_project_members wrote the rows
and returned two counts; every other membership event — invited, joined,
removed, restored — raises a notification in the same transaction as the change,
and this one raised nothing. The client was no better: assignEmployee updates
the roster and never calls pushNotification. So a worker was added to a site and
the first they knew of it was noticing a new site in the app, if they looked.

These are the properties that make the fix worth having: the people added are
told and nobody else is, each is told once, the notification is addressed to
their own role (the app filters the feed by role before it filters by user, so
an employee's notice tagged `manager` would be written, synced and never shown),
and saving an unchanged roster is not an event.

Runs inside one transaction that is rolled back, so it invents a company freely
and leaves nothing behind. Applies the migration first, so it also proves the
file parses and applies.

    PGPW='<database password>' python3 supabase/tests/project_assignment_notice_test.py

or, with no PGPW, it reads DATABASE_URL out of server/.env.
"""
import json, os, re, sys, uuid, pathlib
sys.path.insert(0, os.environ.get("PYLIB", ""))
import pg8000.native as pg

ROOT = pathlib.Path(__file__).resolve().parents[2]
MIGRATION = ROOT / "supabase/migrations/20260918160000_tell_people_they_are_on_a_project.sql"

def credentials():
    pw = os.environ.get("PGPW")
    if pw:
        return dict(user="postgres.fdxwxcwnzzcsnsxdhzjj",
                    host="aws-0-ap-northeast-1.pooler.supabase.com",
                    port=5432, database="postgres", password=pw)
    env = ROOT / "server/.env"
    if not env.exists():
        sys.exit("no PGPW and no server/.env — cannot connect")
    url = ""
    for line in env.read_text().splitlines():
        if line.startswith("DATABASE_URL="):
            url = line.split("=", 1)[1].strip().strip('"').strip("'")
    m = re.match(r"postgres(?:ql)?://([^:]+):([^@]+)@([^:/]+):(\d+)/(\S+)", url)
    if not m:
        sys.exit("DATABASE_URL in server/.env is not a libpq URL I can parse")
    user, pw, host, port, db = m.groups()
    from urllib.parse import unquote
    return dict(user=unquote(user), password=unquote(pw), host=host,
                port=int(port), database=db.split("?")[0])

conn = pg.Connection(ssl_context=True, **credentials())
conn.run("begin")
passed = failed = 0

def check(name, ok, detail=""):
    global passed, failed
    if ok:
        passed += 1; print(f"  ok    {name}")
    else:
        failed += 1; print(f"  FAIL  {name}  {detail}")

def as_admin(auth_id, org):
    conn.run("set local role authenticated")
    conn.run("select set_config('request.jwt.claims', :x, true)",
             x=json.dumps({"sub": str(auth_id), "role": "authenticated"}))
    conn.run("select set_config('request.headers', :h, true)",
             h=json.dumps({"x-workfence-company": str(org)}))

def as_postgres():
    conn.run("reset role")
    conn.run("select set_config('request.jwt.claims', '', true)")

def notices(org):
    return conn.run("""select count(*) from notifications
                        where org_id = :o and kind = 'project-assigned'""", o=org)[0][0]

try:
    conn.run(MIGRATION.read_text())
    print("\nmigration applies")

    org = conn.run("""insert into organizations (name, code, slug, status)
                      values ('Notify Test','NT-TEST','notify-test','active') returning id""")[0][0]
    auth = uuid.uuid4()
    conn.run("""insert into auth.users (id, instance_id, aud, role, email,
                                        encrypted_password, created_at, updated_at)
                values (:i,'00000000-0000-0000-0000-000000000000','authenticated',
                        'authenticated',:e,'',now(),now())""", i=auth, e=f"a-{auth}@e.test")
    conn.run("""insert into users (auth_id, org_id, name, role, email, status)
                values (:a,:o,'Admin','admin',:e,'active')""", a=auth, o=org, e=f"a-{auth}@e.test")
    emp = conn.run("""insert into users (org_id, name, role, email, status)
                      values (:o,'Worker','employee',:e,'active') returning id""",
                   o=org, e=f"e-{uuid.uuid4()}@e.test")[0][0]
    mgr = conn.run("""insert into users (org_id, name, role, email, status)
                      values (:o,'Boss','manager',:e,'active') returning id""",
                   o=org, e=f"m-{uuid.uuid4()}@e.test")[0][0]
    proj = conn.run("""insert into projects (org_id, code, name, status, location, geofence)
                       values (:o,'P-01','Chennai Metro','active',
                               '{"lat":13.08,"lng":80.27}'::jsonb,
                               '{"kind":"circle","center":{"lat":13.08,"lng":80.27},"radius":150}'::jsonb)
                       returning id""", o=org)[0][0]

    print("\nassigning two people")
    as_admin(auth, org)
    r = json.loads(conn.run("select set_project_members(:p, :u)::text", p=proj, u=[emp, mgr])[0][0])
    as_postgres()
    check("two people added", r["added"] == 2, str(r))

    rows = conn.run("""select user_id, audience::text, title, body, link
                         from notifications where org_id = :o and kind = 'project-assigned'""", o=org)
    check("one notification each, and no more", len(rows) == 2, f"{len(rows)} rows")
    by = {str(x[0]): x for x in rows}
    e, m = by.get(str(emp)), by.get(str(mgr))
    check("the worker was told", e is not None)
    check("the manager was told", m is not None)
    if e:
        check("addressed to the worker's own role", e[1] == "employee", e[1])
        check("names the project", "Chennai Metro" in e[2], e[2])
        check("carries the project code", "P-01" in e[3], e[3])
        check("links somewhere an employee may go", e[4] == "/employee", str(e[4]))
    if m:
        check("the manager's audience is manager", m[1] == "manager", m[1])
        check("the manager links to the project", str(m[4]).startswith("/manager/project?id="), str(m[4]))

    print("\nwhat is not an event")
    before = notices(org)
    as_admin(auth, org)
    r2 = json.loads(conn.run("select set_project_members(:p, :u)::text", p=proj, u=[emp, mgr])[0][0])
    as_postgres()
    check("saving an unchanged roster tells nobody again",
          r2["added"] == 0 and notices(org) == before, str(r2))

    as_admin(auth, org)
    r3 = json.loads(conn.run("select set_project_members(:p, :u)::text", p=proj, u=[emp])[0][0])
    as_postgres()
    check("taking somebody off notifies nobody", r3["removed"] == 1 and notices(org) == before, str(r3))

    as_admin(auth, org)
    r4 = json.loads(conn.run("select set_project_members(:p, :u)::text", p=proj, u=[emp, mgr])[0][0])
    as_postgres()
    check("putting them back tells them again",
          r4["added"] == 1 and notices(org) == before + 1, str(r4))
finally:
    conn.run("rollback")
    conn.close()

print(f"\n{passed} passed, {failed} failed  (rolled back)")
sys.exit(1 if failed else 0)
