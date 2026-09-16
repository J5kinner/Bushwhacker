#!/usr/bin/env python3
"""PreToolUse(Edit|Write): refuse to hand-edit a migration that may already be applied.

docs/practices.md has always said "never hand-edit an already-applied migration; add a new one"
— this makes it true rather than polite. Editing applied SQL silently desynchronises the database
from db/migrations, and CI's "Migrations in sync" job cannot catch it: it regenerates from
db/schema.ts, so an edit that matches the schema still passes.
"""
import json
import re
import sys

try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)  # unparseable input is not a reason to block

path = data.get("tool_input", {}).get("file_path") or ""

if re.search(r"db/migrations/.*\.sql$", path):
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason": (
            f"{path} is a generated migration and may already be applied to the database. "
            "Editing it desynchronises db/migrations from the real schema without CI noticing. "
            "Change db/schema.ts and run `pnpm db:generate` to add a new migration instead "
            "(docs/practices.md, Migration discipline)."
        ),
    }}))
