"""
Does the replayed tree produce the database we actually run?

`replay.sh` proves every migration applies. That is the weaker half. A tree can
apply cleanly and still build something subtly different — a helper left at an
older definition, a policy that was rewritten in production and never committed
— and that failure is silent, which makes it the one worth a test.

So this compares the replayed database against the live one across everything
that can drift: function bodies, policy expressions, constraints, indexes,
column types and defaults, enum values, whether RLS is on, triggers, sequences.

Function bodies are compared three ways, because not every difference is a
defect. Byte-identical is ideal. Identical once comments and whitespace are
normalised away is fine, and expected wherever the committed file carries
reasoning that production's copy has lost. Anything else is real drift and the
repository is wrong.

    PGURL='postgres://…' python3 supabase/tests/replay_diff.py

Read-only against both databases.
"""
import os, re, subprocess, sys
from urllib.parse import unquote

sys.path.insert(0, os.environ.get("PYLIB", ""))
import pg8000.native as pg

CONTAINER = os.environ.get("REPLAY_CONTAINER", "wf-replay")

def live_conn():
    url = os.environ.get("PGURL", "")
    m = re.match(r"postgres(?:ql)?://([^:]+):([^@]+)@([^:/]+):(\d+)/(\S+)", url)
    if not m:
        sys.exit("set PGURL to a libpq URL for the database to compare against")
    u, pw, h, port, db = m.groups()
    return pg.Connection(unquote(u), host=h, port=int(port), database=db.split("?")[0],
                         password=unquote(pw), ssl_context=True)

def replay(sql):
    r = subprocess.run(["docker", "exec", CONTAINER, "psql", "-U", "postgres", "-tAc", sql],
                       capture_output=True, text=True)
    return r.stdout

def norm(t):
    """Same function, modulo the things that are not the function."""
    return re.sub(r"\s+", " ", re.sub(r"--[^\n]*", "", t)).strip().lower()

FUNCS = """select n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')'
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname in ('public','private')
              -- extension-owned functions live in different schemas on
              -- Supabase than in a plain postgres image; not our business.
              and p.oid not in (select objid from pg_depend where deptype = 'e')
            order by 1"""

SETS = {
 "policies":    """select tablename||'.'||policyname||' '||cmd||'='
                          ||md5(coalesce(qual,'')||'~'||coalesce(with_check,''))
                     from pg_policies where schemaname='public' order by 1""",
 "constraints": """select cl.relname||': '||co.conname||' '||pg_get_constraintdef(co.oid)
                     from pg_constraint co join pg_class cl on cl.oid = co.conrelid
                     join pg_namespace n on n.oid = cl.relnamespace
                    where n.nspname='public' order by 1""",
 "indexes":     """select indexdef from pg_indexes where schemaname='public' order by 1""",
 "columns":     """select table_name||'.'||column_name||' '||data_type||' '||is_nullable||' '
                          ||coalesce(column_default,'-')
                     from information_schema.columns where table_schema='public' order by 1""",
 "enums":       """select t.typname||':'||e.enumlabel from pg_enum e
                     join pg_type t on t.oid = e.enumtypid
                     join pg_namespace n on n.oid = t.typnamespace
                    where n.nspname='public' order by 1""",
 "rls":         """select c.relname||'='||c.relrowsecurity from pg_class c
                     join pg_namespace n on n.oid = c.relnamespace
                    where n.nspname='public' and c.relkind='r' order by 1""",
 "triggers":    """select c.relname||'.'||t.tgname from pg_trigger t
                     join pg_class c on c.oid = t.tgrelid
                     join pg_namespace n on n.oid = c.relnamespace
                    where n.nspname='public' and not t.tgisinternal order by 1""",
 "sequences":   """select sequencename from pg_sequences where schemaname='public' order by 1""",
}

live = live_conn()
problems = 0

def body(sig, from_live):
    ns, rest = sig.split(".", 1)
    name = rest.split("(")[0]
    sql = (f"select pg_get_functiondef(p.oid) from pg_proc p "
           f"join pg_namespace x on x.oid = p.pronamespace "
           f"where x.nspname = '{ns}' and p.proname = '{name}'")
    return live.run(sql)[0][0] if from_live else replay(sql)

sigs_live = {r[0] for r in live.run(FUNCS)}
sigs_replay = {x.strip() for x in replay(FUNCS).splitlines() if x.strip()}
only_live, only_replay = sorted(sigs_live - sigs_replay), sorted(sigs_replay - sigs_live)
exact = cosmetic = []
exact, cosmetic, real = [], [], []
for sig in sorted(sigs_live & sigs_replay):
    a, b = body(sig, True), body(sig, False)
    (exact if a.strip() == b.strip() else cosmetic if norm(a) == norm(b) else real).append(sig)

print(f"functions      live={len(sigs_live)} replay={len(sigs_replay)}")
print(f"  identical            {len(exact)}")
print(f"  comments only        {len(cosmetic)}" + (f"  {cosmetic}" if cosmetic else ""))
print(f"  DIFFERENT            {len(real)}" + (f"  {real}" if real else ""))
for s in only_live:   print(f"  MISSING FROM TREE    {s}")
for s in only_replay: print(f"  ONLY IN TREE         {s}")
problems += len(real) + len(only_live) + len(only_replay)

for kind, sql in SETS.items():
    L = {r[0] for r in live.run(sql)}
    R = {x.strip() for x in replay(sql).splitlines() if x.strip()}
    ok = L == R
    print(f"{kind:14} live={len(L):<4} replay={len(R):<4} {'match' if ok else 'DIFFER'}")
    for x in sorted(L - R)[:8]: print(f"     missing from tree: {x[:120]}")
    for x in sorted(R - L)[:8]: print(f"     only in tree     : {x[:120]}")
    if not ok:
        problems += 1

live.close()
print("\n" + ("the tree rebuilds this database" if problems == 0
              else f"{problems} difference(s) — the tree does not rebuild this database"))
sys.exit(1 if problems else 0)
