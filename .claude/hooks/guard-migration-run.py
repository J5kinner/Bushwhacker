#!/usr/bin/env python3
"""PreToolUse(Bash): refuse to let an agent apply migrations, so a human runs them deliberately.

DATABASE_URL in .env.local is the production Neon database — ADR 0004's preview isolation was
never set up — so applying a migration from a dev machine writes production.

This denies rather than asks, because asking does not work here. Under `permissions.defaultMode:
auto` the harness satisfies a "ask" decision itself and the prompt never reaches a person; an
explicit `permissions.ask` rule is auto-approved the same way. Verified on 2026-09-16, when an
earlier "ask" version of this hook let `pnpm db:migrate` through to production twice in a row
without a prompt. Only "deny" is enforced. Run migrations from your own terminal.
"""
import json
import re
import sys

# \b keeps `db:generate` and the path `db/migrations` from matching.
APPLIES_MIGRATIONS = re.compile(
    r"(drizzle-kit\s+migrate\b|db:migrate\b|drizzle-kit\s+push\b|db:push\b)"
)

try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)

command = data.get("tool_input", {}).get("command") or ""

if APPLIES_MIGRATIONS.search(command):
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason": (
            "This applies migrations, and DATABASE_URL in .env.local is the PRODUCTION Neon "
            "database (ADR 0004's preview isolation was never set up), so an agent must not run "
            "it. Read the generated SQL in db/migrations, then run this yourself in a terminal "
            "(docs/practices.md, Migration discipline)."
        ),
    }}))
