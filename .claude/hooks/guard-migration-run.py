#!/usr/bin/env python3
"""PreToolUse(Bash): pause before anything applies migrations, and hand the decision to a human.

DATABASE_URL in .env.local is the production Neon database — ADR 0004's preview isolation was
never set up — so applying a migration from a dev machine writes production. This does not block
the work; it makes sure a person knowingly says yes each time.
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
        "permissionDecision": "ask",
        "permissionDecisionReason": (
            "This applies migrations, and DATABASE_URL in .env.local is the PRODUCTION Neon "
            "database (ADR 0004's preview isolation was never set up). Confirm the generated SQL "
            "in db/migrations has been read and is what you intend before allowing this."
        ),
    }}))
