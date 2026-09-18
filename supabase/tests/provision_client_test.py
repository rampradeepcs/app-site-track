"""
Onboarding a client from the platform console.

`provision_client` is the RPC behind the console's "Onboard client" wizard. It
lives in the database and lived in no migration, so production had it and every
database built from this repository did not. The migration under test is the
live definition captured and replayed; this file is what says the replay is
faithful.

These are the properties that have to hold: only the platform owner may call it,
the client comes out whole (organisation + subscription + an administrator whose
row is waiting to be claimed), the plan and the negotiated overrides are the ones
the operator chose, and the subdomain rules hold — because a slug is a hostname
and the console lets an operator type one in.

Runs inside a single transaction that is rolled back at the end, so it invents
companies and people freely and leaves nothing behind. It applies the migration
itself first, so it also proves the migration file parses and applies.

    PGPW='<database password>' python3 supabase/tests/provision_client_test.py

or, with no PGPW, it reads DATABASE_URL out of server/.env.
"""
import json, os, re, sys, uuid, pathlib
sys.path.insert(0, os.environ.get("PYLIB", ""))
import pg8000.native as pg

ROOT = pathlib.Path(__file__).resolve().parents[2]
MIGRATION = ROOT / "supabase/migrations/20260918100000_provision_client.sql"

def credentials():
    pw = os.environ.get("PGPW")
    if pw:
        return dict(user="postgres.fdxwxcwnzzcsnsxdhzjj",
                    host="aws-0-ap-northeast-1.pooler.supabase.com",
                    port=5432, database="postgres", password=pw)
    env = (ROOT / "server/.env")
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

def as_user(auth_id):
    conn.run("set local role authenticated")
    conn.run("select set_config('request.jwt.claims', :c, true)",
             c=json.dumps({"sub": str(auth_id), "role": "authenticated"}))
def as_postgres():
    conn.run("reset role")
    conn.run("select set_config('request.jwt.claims', '', true)")

def q(sql, **kw): return conn.run(sql, **kw)
def one(sql, **kw):
    r = q(sql, **kw)
    return r[0][0] if r else None

_sp = [0]
def refuses(name, payload_json, expect):
    """Call it expecting a refusal, inside a savepoint.

    Postgres aborts the whole transaction on a raised exception, so a test
    that asserts refusals — which is most of this file — has to be able to
    step back to the moment before each one."""
    _sp[0] += 1
    mark = f"sp{_sp[0]}"
    conn.run(f"savepoint {mark}")
    try:
        q("select provision_client(:p)", p=payload_json)
        conn.run(f"release savepoint {mark}")
        check(name, False, "it succeeded")
    except Exception as e:
        conn.run(f"rollback to savepoint {mark}")
        check(name, expect in str(e), str(e)[:90])

try:
    # ---------------------------------------------------------- the migration
    print("\napplying the migration")
    as_postgres()
    q(MIGRATION.read_text())
    check("migration applies", True)
    check("provision_client exists",
          one("""select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where p.proname = 'provision_client' and n.nspname = 'public'""") == 1)
    check("it is SECURITY DEFINER",
          one("select bool_and(prosecdef) from pg_proc where proname = 'provision_client'") is True)
    check("authenticated may call it",
          one("select has_function_privilege('authenticated','public.provision_client(jsonb)','execute')") is True)
    check("anon may NOT call it",
          one("select has_function_privilege('anon','public.provision_client(jsonb)','execute')") is False)
    check("organizations.slug exists",
          one("""select count(*) from information_schema.columns
                  where table_name='organizations' and column_name='slug'""") == 1)

    # ------------------------------------------------------------- identities
    owner_auth = uuid.uuid4()
    q("""insert into auth.users (id, instance_id, aud, role, email,
                                 encrypted_password, created_at, updated_at)
         values (:i, '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
                 :e, '', now(), now())""", i=owner_auth, e=f"owner-{owner_auth}@example.test")
    q("""insert into users (auth_id, org_id, name, role, email, status)
         values (:a, null, 'Platform Owner', 'superadmin', :e, 'active')""",
      a=owner_auth, e=f"owner-{owner_auth}@example.test")

    outsider_auth = uuid.uuid4()
    q("""insert into auth.users (id, instance_id, aud, role, email,
                                 encrypted_password, created_at, updated_at)
         values (:i, '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
                 :e, '', now(), now())""", i=outsider_auth, e=f"out-{outsider_auth}@example.test")

    plan = one("select id from plans where not archived order by monthly_price asc limit 1")
    check("a plan exists to onboard onto", plan is not None, "seed plans missing")

    admin_email = f"admin-{uuid.uuid4()}@example.test"
    payload = {
        "name": "Ironsand Constructions",
        "industry": "Construction",
        "website": "https://example.test",
        "contactName": "Site Office",
        "contactEmail": f"contact-{uuid.uuid4()}@example.test",
        "contactPhone": "+91 99999 00000",
        "country": "India",
        "timezone": "Asia/Kolkata",
        "billing": {"legalName": "Ironsand Constructions", "currency": "INR", "taxPercent": 18},
        "branding": {"appName": "Ironsand", "accent": "#0a7", "logoText": "IC"},
        "admin": {"name": "Priya Raman", "email": admin_email,
                  "phone": "+91 98888 00000", "role": "admin"},
        "planId": plan,
        "cycle": "annual",
        "trialDays": 21,
        "limitOverrides": {"employees": 250},
        "featureOverrides": {"payroll": True},
    }

    # ------------------------------------------------------------- refusals
    print("\nwho may call it")
    as_user(outsider_auth)
    refuses("a non-superadmin is refused", json.dumps(payload), "only the platform owner")

    conn.run("select set_config('request.jwt.claims', '', true)")
    refuses("a signed-out caller is refused", json.dumps(payload), "only the platform owner")

    # -------------------------------------------------------- the happy path
    print("\nonboarding a client")
    as_user(owner_auth)
    made = json.loads(one("select provision_client(:p)::text", p=json.dumps(payload)))
    check("returns the shape the client expects",
          set(made) == {"orgId", "userId", "subscriptionId", "code", "slug"}, str(sorted(made)))

    as_postgres()
    org = q("""select name, code, slug, status, industry, billing, branding
                 from organizations where id = :o""", o=made["orgId"])[0]
    check("organisation created", org[0] == "Ironsand Constructions")
    check("slug derived from the name", org[2] == "ironsand-constructions", org[2])
    check("a trial makes the org a trial", str(org[3]) == "trial", str(org[3]))
    check("billing kept as sent", json.loads(org[5])["currency"] == "INR" if isinstance(org[5], str) else org[5]["currency"] == "INR")
    check("branding kept as sent", (json.loads(org[6]) if isinstance(org[6], str) else org[6])["appName"] == "Ironsand")

    sub = q("""select plan_id, status, cycle, trial_ends_at, renews_at,
                      limit_overrides, feature_overrides
                 from subscriptions where id = :s""", s=made["subscriptionId"])[0]
    check("subscription is on the chosen plan", sub[0] == plan, str(sub[0]))
    check("subscription belongs to the new org",
          str(one("select org_id from subscriptions where id = :s",
                  s=made["subscriptionId"])) == made["orgId"])
    check("cycle is the one chosen", str(sub[2]) == "annual", str(sub[2]))
    check("trial end set from trialDays", sub[3] is not None)
    check("limit override survived",
          (json.loads(sub[5]) if isinstance(sub[5], str) else sub[5]).get("employees") == 250)
    check("feature override survived",
          (json.loads(sub[6]) if isinstance(sub[6], str) else sub[6]).get("payroll") is True)
    check("exactly one subscription for the org",
          one("select count(*) from subscriptions where org_id = :o", o=made["orgId"]) == 1)

    adm = q("""select auth_id, org_id, role, email, name from users where id = :u""",
            u=made["userId"])[0]
    check("administrator is UNLINKED until they sign in", adm[0] is None, str(adm[0]))
    check("administrator belongs to the new client", str(adm[1]) == made["orgId"])
    check("administrator is an admin of the client", str(adm[2]) == "admin", str(adm[2]))
    check("administrator keeps the email they will claim by", adm[3] == admin_email)
    check("the owner did NOT join the client they created",
          one("select org_id from users where auth_id = :a", a=owner_auth) is None)
    check("an audit row records who onboarded it",
          one("""select count(*) from platform_audit
                  where org_id = :o and action = 'client.create'""", o=made["orgId"]) == 1)

    # ------------------------------------------------------- the awkward ones
    print("\nrefusing what cannot work")
    as_user(owner_auth)

    dup = dict(payload); dup["admin"] = dict(payload["admin"])
    dup["name"] = "Ironsand Constructions"          # same name -> slug collision
    dup["admin"]["email"] = f"other-{uuid.uuid4()}@example.test"
    made2 = json.loads(one("select provision_client(:p)::text", p=json.dumps(dup)))
    check("a second client with the same name gets a distinct slug",
          made2["slug"] != made["slug"], f'{made["slug"]} vs {made2["slug"]}')
    check("and a distinct code", made2["code"] != made["code"])

    for name, bad, expect in [
        ("no company name",           {"name": ""},                  "required"),
        ("no administrator name",     {"admin": {"name": ""}},       "required"),
        ("no administrator email",    {"admin": {"email": ""}},      "required"),
        ("a plan that does not exist", {"planId": "no-such-plan"},   "unknown plan"),
        ("a cycle that is not a cycle", {"cycle": "weekly"},         "monthly or annual"),
        # A slug is a hostname. These are the rules that make it one.
        ("a reserved subdomain",      {"slug": "admin"},             "not allowed"),
        ("a subdomain with illegal characters", {"slug": "not a host!"}, "not allowed"),
    ]:
        p = dict(payload)
        # A fresh address per case: the first client already took `admin_email`,
        # so reusing it would trip the duplicate-email refusal before the one
        # each case is actually about.
        p["admin"] = {**payload["admin"], "email": f"case-{uuid.uuid4()}@example.test"}
        p.update({k: v for k, v in bad.items() if k != "admin"})
        if "admin" in bad:
            p["admin"] = {**p["admin"], **bad["admin"]}
        refuses(f"refuses {name}", json.dumps(p), expect)

    taken = dict(payload)
    taken["name"] = "Someone Else Ltd"
    taken["admin"] = {**payload["admin"], "email": f"else-{uuid.uuid4()}@example.test"}
    taken["slug"] = made["slug"]          # ask for one that is already in use
    refuses("refuses a subdomain somebody already has", json.dumps(taken), "already taken")

    # A one-character subdomain is accepted: the rule is
    # ^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])?$ and the middle is optional. Legal
    # in DNS, so this asserts the rule rather than arguing with it.
    tiny = dict(payload)
    tiny["name"] = "Tiny Subdomain Ltd"
    tiny["admin"] = {**payload["admin"], "email": f"tiny-{uuid.uuid4()}@example.test"}
    tiny["slug"] = "q"
    check("a one-character subdomain is allowed",
          json.loads(one("select provision_client(:p)::text", p=json.dumps(tiny)))["slug"] == "q")

    # The administrator's designation is free text; the role is always admin, so
    # a client always has somebody who can administer it.
    des = dict(payload)
    des["name"] = "Designation Test Ltd"
    des["admin"] = {**payload["admin"], "email": f"des-{uuid.uuid4()}@example.test",
                    "role": "Operations Director"}
    made3 = json.loads(one("select provision_client(:p)::text", p=json.dumps(des)))
    as_postgres()
    row = q("select role, designation from users where id = :u", u=made3["userId"])[0]
    check("admin.role is the designation, and the role stays admin",
          str(row[0]) == "admin" and row[1] == "Operations Director", f"{row[0]} / {row[1]}")
    as_user(owner_auth)

finally:
    conn.run("rollback")
    conn.close()

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
