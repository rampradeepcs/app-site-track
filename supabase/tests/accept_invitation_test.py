"""Does the new accept_invitation deliver what the invitation named?

Every case runs inside a transaction that is ROLLED BACK, including the
CREATE OR REPLACE itself — DDL is transactional in Postgres, so the live
function is never actually altered by this file.

The three branches that can end in a membership:
  new     — no users row yet
  claim   — an unclaimed crew row (auth_id null) gets claimed
  already — a live membership exists; this is the early-return branch that
            used to drop the grants
"""
import pg8000.dbapi, os, ssl, json, pathlib, uuid

MIG = pathlib.Path(
    "/Users/rampradeepcholan/Documents/ram/app-site-track/supabase/migrations/"
    "20260919140000_an_invitation_delivers_what_it_names.sql"
).read_text()

ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
con = pg8000.dbapi.connect(user="postgres.fdxwxcwnzzcsnsxdhzjj", password=os.environ["PGPW"],
    host="aws-0-ap-northeast-1.pooler.supabase.com", port=5432, database="postgres", ssl_context=ctx)
cur = con.cursor()

passed, failed = 0, []

def check(name, got, want):
    global passed
    if got == want:
        passed += 1
    else:
        failed.append(f"{name}\n      want {want!r}\n      got  {got!r}")

def one(q, args=()):
    cur.execute(q, args)
    r = cur.fetchone()
    return r[0] if r else None


def scenario(name, branch):
    """branch: 'new' | 'claim' | 'already'."""
    cur.execute("begin")
    try:
        cur.execute(MIG)                       # the migration under test

        org = one("select id from public.organizations limit 1")
        proj = one("select id from public.projects where org_id = %s limit 1", (org,))
        shift = one("select id from public.shifts where org_id = %s limit 1", (org,))
        if proj is None:
            return ("skipped", "no project in that org")

        email = f"harness-{uuid.uuid4().hex[:10]}@example.com"
        auth_id = str(uuid.uuid4())
        cur.execute(
            "insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at,"
            " created_at, updated_at) values (%s,'00000000-0000-0000-0000-000000000000',"
            "'authenticated','authenticated',%s, now(), now(), now())",
            (auth_id, email))

        if branch in ("claim", "already"):
            cur.execute(
                "insert into public.users (org_id, auth_id, name, employee_code, role,"
                " designation, department, phone, email, avatar_hue, status, shift_start,"
                " shift_end) values (%s,%s,'Harness','HRN-9999','employee','Worker','Site','',"
                "%s, 10, 'active', 540, 1080)",
                (org, auth_id if branch == "already" else None, email))

        inv = one(
            "insert into public.company_invitations (org_id, email, name, role, project_id,"
            " shift_id, status, expires_at) values (%s,%s,'Harness','employee',%s,%s,"
            "'pending', now() + interval '7 days') returning id",
            (org, email, proj, shift))

        cur.execute("set local role authenticated")
        cur.execute("select set_config('request.jwt.claims', %s, true)",
                    (json.dumps({"sub": auth_id, "role": "authenticated", "email": email}),))
        out = one("select public.accept_invitation(%s)", (inv,))
        cur.execute("reset role")

        mid = out["membershipId"]
        got = {
            "alreadyMember": out["alreadyMember"],
            "onProject": one("select count(*) from public.project_members"
                             " where user_id = %s and project_id = %s", (mid, proj)),
            "onShift": (one("select count(*) from public.shift_assignments"
                            " where employee_id = %s and shift_id = %s", (mid, shift))
                        if shift else "no-shift-in-org"),
        }
        return ("ok", got)
    except Exception as e:
        return ("error", f"{type(e).__name__}: {e}")
    finally:
        cur.execute("rollback")


# 'claim' expects alreadyMember=True, which looks wrong and is not: creating
# the auth.users row fires on_auth_user_created -> link_auth_identity, which
# claims the unclaimed crew row by email before accept_invitation ever runs.
# So the person already looks like a member by the time they press Accept.
# That IS the scenario that used to lose the project, which makes this the
# most important row in the table.
for branch, want_already in [("new", False), ("claim", True), ("already", True)]:
    status, got = scenario(branch, branch)
    if status != "ok":
        failed.append(f"{branch}: {status} — {got}")
        continue
    check(f"{branch}: alreadyMember flag", got["alreadyMember"], want_already)
    # The whole point: every branch grants the project the invitation named.
    check(f"{branch}: got the project", got["onProject"], 1)
    if got["onShift"] != "no-shift-in-org":
        check(f"{branch}: got the shift", got["onShift"], 1)

# The guard: a project from another company must not be granted.
cur.execute("begin")
try:
    cur.execute(MIG)
    row = one("""select json_build_object('a', a.id, 'b', b.id)
                   from public.organizations a, public.organizations b
                  where a.id <> b.id
                    and exists (select 1 from public.projects where org_id = b.id)
                  limit 1""")
    if row:
        org_a, proj_b_org = row["a"], row["b"]
        foreign_proj = one("select id from public.projects where org_id = %s limit 1", (proj_b_org,))
        email = f"harness-{uuid.uuid4().hex[:10]}@example.com"
        auth_id = str(uuid.uuid4())
        cur.execute(
            "insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at,"
            " created_at, updated_at) values (%s,'00000000-0000-0000-0000-000000000000',"
            "'authenticated','authenticated',%s, now(), now(), now())", (auth_id, email))
        inv = one(
            "insert into public.company_invitations (org_id, email, name, role, project_id,"
            " status, expires_at) values (%s,%s,'Harness','employee',%s,'pending',"
            " now() + interval '7 days') returning id",
            (org_a, email, foreign_proj))
        cur.execute("set local role authenticated")
        cur.execute("select set_config('request.jwt.claims', %s, true)",
                    (json.dumps({"sub": auth_id, "role": "authenticated", "email": email}),))
        out = one("select public.accept_invitation(%s)", (inv,))
        cur.execute("reset role")
        check("cross-tenant project is refused, not granted",
              one("select count(*) from public.project_members where user_id = %s",
                  (out["membershipId"],)), 0)
    else:
        print("  (no second org with a project — cross-tenant case skipped)")
except Exception as e:
    failed.append(f"cross-tenant: {type(e).__name__}: {e}")
finally:
    cur.execute("rollback")

con.rollback(); con.close()
print(f"\n{passed} passed, {len(failed)} failed")
for f in failed:
    print("  FAIL " + f)
raise SystemExit(1 if failed else 0)
