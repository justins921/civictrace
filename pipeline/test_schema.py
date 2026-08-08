#!/usr/bin/env python3
"""Build every table from scratch and check the loaders still fit it.

Why this exists
---------------
CI runs against an empty database. A developer machine does not. `etl.py`
deletes and rebuilds `civictrace.db` every run, but the schema *changes* a
loader makes along the way — an ALTER TABLE halfway through the pipeline —
have usually already been applied on a machine that has run it before. So a
column added late looks like it was there from the start, locally, forever.

That has broken a production refresh twice:

  * `fetch_totals.py` cached into a table it dropped at import. It only ever
    worked because the table survived between local runs.
  * `fetch_member_bills.py` supplied 18 values to a `bill` table that
    `fetch_bills.py` creates with 17 columns. The 18th, `is_broad`, was added
    by `load_earmarks.py`, which runs *after* it. Every local run passed; the
    7 August scheduled refresh died with "table bill has 17 columns but 18
    values were supplied".

Both were invisible to every test we had, because every test ran against a
database that had already been through the pipeline once. This one starts from
nothing, and it checks the two things that actually went wrong:

  1. A positional `INSERT INTO t VALUES (?,?,…)` into a table created in a
     *different* file. That is a silent dependency on someone else's column
     order and count, and it is what failed.
  2. The arity of any positional insert against the clean-build column count.

    python test_schema.py

No network, no credentials, about a second.
"""
import re
import sqlite3
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
FAILS = []


def check(name, ok, detail=""):
    print(("  ok   " if ok else "  FAIL ") + name + (f"   {detail}" if detail and not ok else ""))
    if not ok:
        FAILS.append(f"{name}: {detail}")


def sources():
    return [p for p in sorted(HERE.glob("*.py")) if not p.name.startswith("test_")]


def ddl_blocks(text):
    return [m for m in re.findall(r'"""(.*?)"""', text, re.S) if "CREATE TABLE" in m.upper()]


def build():
    """Every table the pipeline creates, as a clean build first sees it.

    Deliberately does not apply the runtime ALTER TABLEs. Seeing the schema
    without them is the entire point.
    """
    con = sqlite3.connect(":memory:")
    for _ in range(2):                      # second pass for cross-file dependencies
        for p in sources():
            for block in ddl_blocks(p.read_text()):
                try:
                    con.executescript(block)
                except sqlite3.Error:
                    pass
    return con


def main():
    con = build()
    tables = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    ncols = {t: len(list(con.execute(f"PRAGMA table_info({t})"))) for t in tables}
    print(f"clean build produced {len(tables)} tables\n")

    # Which file creates which table.
    creator = {}
    for p in sources():
        for block in ddl_blocks(p.read_text()):
            for t in re.findall(r"CREATE TABLE(?:\s+IF NOT EXISTS)?\s+(\w+)", block, re.I):
                creator.setdefault(t, p.name)

    cross_file, wrong_arity, undetermined = [], [], []
    for p in sources():
        text = p.read_text()
        for m in re.finditer(
                r'INSERT\s+(?:OR\s+\w+\s+)?INTO\s+(\w+)\s+VALUES\s*\(([^)]*)\)', text, re.I):
            table, args = m.group(1), m.group(2)
            owner = creator.get(table)

            # A positional insert into a table this same file creates is a local
            # coupling — visible in one place, changed in one place. Into someone
            # else's table it is a landmine.
            if owner and owner != p.name:
                cross_file.append(f"{p.name} -> {table} (created in {owner})")

            # Arity, written literally as (?,?,?) or built as `"?" * N`.
            #
            # The first version of this searched a window ending at m.end() —
            # the closing paren of `VALUES (%s)`. The `",".join("?" * 17)` that
            # actually supplies the arity sits *after* that point, so the regex
            # never matched, `n` stayed None, and the check was skipped. Every
            # insert that has ever broken this pipeline uses the `%s` form; the
            # only shape the checker evaluated was the literal one, which has
            # never failed once. A checker that silently passes what it cannot
            # parse is worse than no checker, so an undetermined arity on a
            # positional insert is now a failure in its own right.
            n = None
            if set(args.replace(" ", "")) <= {"?", ","} and "?" in args:
                n = args.count("?")
            else:
                tail = text[m.start():m.end() + 200]
                mult = re.search(r'"\?"\s*\*\s*(\d+)', tail)
                if mult:
                    n = int(mult.group(1))
                elif re.search(r'"\?"\s*\*\s*len\(', tail):
                    n = -1        # arity from a runtime length; not checkable, not a bug
            if n == -1:
                pass
            elif n is None:
                undetermined.append(f"{p.name}: INSERT INTO {table} — arity not determinable")
            elif table in ncols and n != ncols[table]:
                wrong_arity.append(f"{p.name}: {table} takes {ncols[table]} columns, given {n}")

    print("== positional INSERTs across file boundaries")
    check("no file inserts positionally into a table another file creates",
          not cross_file, "; ".join(sorted(set(cross_file))))

    print("\n== positional INSERT arity against the clean-build schema")
    check("every positional INSERT matches its table's column count",
          not wrong_arity, "; ".join(sorted(set(wrong_arity))))
    check("every positional INSERT has an arity this check can read",
          not undetermined, "; ".join(sorted(set(undetermined))))

    print("\n== tables the export publishes exist on a clean build")
    export = (HERE / "export_json.py").read_text()
    published = set(re.findall(r'dump\(\s*"[^"]+"\s*,\s*"([a-z_]+)"', export))
    # `contrib` and the profile views live in Postgres, not SQLite; only check
    # the ones a loader is supposed to create here.
    absent = sorted(t for t in published if t in creator and t not in tables)
    check("every published table was created", not absent, str(absent))

    print()
    if FAILS:
        print(f"{len(FAILS)} SCHEMA CHECK(S) FAILED")
        for f in FAILS:
            print("  - " + f)
        return 1
    print("clean-build schema checks pass")
    return 0


if __name__ == "__main__":
    sys.exit(main())
