"""
Sending an invitation again.

An invitation is a row and a letter, and only the row is durable. When the
letter does not arrive — a spam folder, a provider having a bad afternoon —
there was nothing to do but cancel and re-invite, which loses who invited them
and when.

These are the properties that make a resend worth having: only this company's
administrators may press it, it refreshes the expiry (an invitation lasts 30
days from when it was made, so resending on day 29 would post a letter with a
day left), it records when the last letter went, it refuses invitations that
have already been answered, and an id from another company is indistinguishable
from one that does not exist.

And the change that matters most: an invitation that lapsed unanswered used to
vanish from the only screen that could act on it. It comes back, flagged.

Rolled back at the end; applies the migration itself first.

    PGPW='<database password>' python3 supabase/tests/resend_invitation_test.py
"""
import json, os, re, sys, uuid, pathlib
sys.path.insert(0, os.environ.get("PYLIB", ""))
import pg8000.native as pg

ROOT = pathlib.Path(__file__).resolve().parents[2]
MIGRATION = ROOT / "supabase/migrations/20260919100000_resend_invitation.sql"

def credentials():
    pw = os.environ.get("PGPW")
    if pw:
        return dict(user="postgres.fdxwxcwnzzcsnsxdhzjj",
                    host="aws-0-ap-northeast-1.pooler.supabase.com",
                    port=5432, database="postgres", password=pw)
    url = ""
    for line in (ROOT / "server/.env").read_text().splitlines():
        if line.startswith("DATABASE_URL="):
            url = line.split("=", 1)[1].strip().strip('"').strip("'")
    m = re.match(r"postgres(?:ql)?://([^:]+):([^@]+)@([^:/]+):(\d+)/(\S+)", url)
    if not m:
        sys.exit("cannot parse DATABASE_URL")
    user, pw, host, port, db = m.groups()
    from urllib.parse import unquote
    return dict(user=unquote(user), password=unquote(pw), host=host,
                port=int(port), database=db.split("?")[0])

conn = pg.Connection(ssl_context=True, **credentials())
conn.run("begin")
passed = failed = 0

def check(name, ok, detail=""):
    global passed, failed
    if ok: passed += 1; print(f"  ok    {name}")
    else:  failed += 1; print(f"  FAIL  {name}  {detail}")

def act_as(auth_id, org):
    conn.run("set local role authenticated")
    conn.run("select set_config('request.jwt.claims', :x, true)",
             x=json.dumps({"sub": str(auth_id), "role": "authenticated"}))
    conn.run("select set_config('request.headers', :h, true)",
             h=json.dumps({"x-workfence-company": str(org)}))

def as_postgres():
    conn.run("reset role"); conn.run("select set_config('request.jwt.claims', '', true)")

_sp = [0]
def refuses(name, sql, expect, **kw):
    _sp[0] += 1; mark = f"sp{_sp[0]}"
    conn.run(f"savepoint {mark}")
    try:
        conn.run(sql, **kw); conn.run(f"release savepoint {mark}")
        check(name, False, "it succeeded")
    except Exception as e:
        conn.run(f"rollback to savepoint {mark}")
        check(name, expect in str(e), str(e)[:90])

def company(label):
    org = conn.run("""insert into organizations (name, code, slug, status)
                      values (:n, :c, :s, 'active') returning id""",
                   n=label, c=f"{label[:3].upper()}-{uuid.uuid4().hex[:4]}",
                   s=f"{label.lower()}-{uuid.uuid4().hex[:6]}")[0][0]
    auth = uuid.uuid4()
    conn.run("""insert into auth.users (id, instance_id, aud, role, email,
                                        encrypted_password, created_at, updated_at)
                values (:i,'00000000-0000-0000-0000-000000000000','authenticated',
                        'authenticated',:e,'',now(),now())""", i=auth, e=f"a-{auth}@e.test")
    conn.run("""insert into users (auth_id, org_id, name, role, email, status)
                values (:a,:o,'Admin','admin',:e,'active')""", a=auth, o=org, e=f"a-{auth}@e.test")
    return org, auth

try:
    conn.run(MIGRATION.read_text())
    print("\nmigration applies")

    org, auth = company("Acme")
    other_org, other_auth = company("Rival")

    act_as(auth, org)
    inv = json.loads(conn.run("select invite_member(:p)::text",
        p=json.dumps({"email": f"new-{uuid.uuid4()}@e.test", "name": "Priya", "role": "employee"}))[0][0])
    as_postgres()
    check("an invitation was created", inv.get("id") is not None, str(inv))
    inv_id = inv["id"]

    check("nothing has been sent since creation",
          conn.run("select last_sent_at from company_invitations where id=:i", i=inv_id)[0][0] is None)

    # Age it first, THEN read the baseline: created moments ago, its original
    # expiry is already ~30 days out, so a refresh would be unmeasurable.
    conn.run("update company_invitations set expires_at = now() + interval '2 days' where id=:i", i=inv_id)
    before = conn.run("select expires_at, last_sent_at from company_invitations where id=:i", i=inv_id)[0]

    print("\nresending")
    act_as(auth, org)
    out = json.loads(conn.run("select resend_invitation(:i)::text", i=inv_id)[0][0])
    as_postgres()
    check("hands back the address to write to", out.get("email") == inv["email"], str(out))
    after = conn.run("select expires_at, last_sent_at from company_invitations where id=:i", i=inv_id)[0]
    check("the expiry is pushed out again",
          (after[0] - before[0]).days > 25, f"{before[0]} -> {after[0]}")
    check("when it was last sent is recorded", after[1] is not None)
    check("it is written down",
          conn.run("""select count(*) from audit_log
                       where org_id=:o and action='member.invite.resend'""", o=org)[0][0] == 1)

    print("\nwhat it refuses")
    act_as(other_auth, other_org)
    refuses("another company's invitation looks like no invitation",
            "select resend_invitation(:i)", "no such invitation", i=inv_id)
    as_postgres()

    as_postgres()
    conn.run("update company_invitations set status='accepted' where id=:i", i=inv_id)
    act_as(auth, org)
    refuses("an accepted invitation cannot be resent",
            "select resend_invitation(:i)", "already accepted", i=inv_id)
    refuses("an invitation that does not exist",
            "select resend_invitation(:i)", "no such invitation", i=str(uuid.uuid4()))
    as_postgres()
    conn.run("update company_invitations set status='pending' where id=:i", i=inv_id)

    print("\nthe lapsed ones come back")
    as_postgres()
    conn.run("""update company_invitations set expires_at = now() - interval '1 day',
                    last_sent_at = null where id=:i""", i=inv_id)
    act_as(auth, org)
    rows = conn.run("select id, expired from company_invitations_pending()")
    as_postgres()
    mine = [r for r in rows if str(r[0]) == str(inv_id)]
    check("a lapsed invitation is listed at all", len(mine) == 1, f"{len(rows)} rows back")
    check("and it is flagged as lapsed", mine and mine[0][1] is True, str(mine))

    act_as(auth, org)
    conn.run("select resend_invitation(:i)", i=inv_id)
    rows2 = conn.run("select id, expired from company_invitations_pending()")
    as_postgres()
    mine2 = [r for r in rows2 if str(r[0]) == str(inv_id)]
    check("resending revives it", mine2 and mine2[0][1] is False, str(mine2))
finally:
    conn.run("rollback"); conn.close()

print(f"\n{passed} passed, {failed} failed  (rolled back)")
sys.exit(1 if failed else 0)
