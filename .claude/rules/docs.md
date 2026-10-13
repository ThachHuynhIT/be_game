---
paths:
  - "docs/**"
  - "README.md"
  - "CLAUDE.md"
  - ".claude/rules/**"
---

# Documentation rules

- Project docs (`README.md`, `docs/**`) are in **Vietnamese**; `CLAUDE.md` and `.claude/rules/` are in English.
- Docs describe the code as it is: every file, function, constant and message shape named must exist. When code changes, update the doc in the same commit.
- Where things go:
  - `README.md`: overview, endpoints table, local run, Vercel deploy, short pointers.
  - `docs/GUIDE.md`: developer guide (architecture, protocol, conventions, adding a game, known traps).
  - `docs/games/<game>.md`: one per game (rules, state machine, commands).
  - `docs/DEPLOYMENT.md`: environments (primary/backup/preview/local), release flow, env vars per environment, compatibility rules, post-deploy checks, incidents, lessons learned.
  - `docs/SELF_HOSTING.md`: the self-hosted server — CD steps, config locations, runbook, shared-host rules, troubleshooting.
- A new operational lesson (an incident, a pitfall, a platform quirk) goes into `docs/DEPLOYMENT.md` → "Bài học đã gặp" (general) or the `SELF_HOSTING.md` troubleshooting table (server-specific), in the same PR as the fix.
  - `CLAUDE.md` + `.claude/rules/`: short, enforceable rules for agents; link to the docs instead of repeating them.
- Keep the game tables consistent across `README.md`, `docs/GUIDE.md` and `CLAUDE.md` (name, dir, player count, WS path).
- Never write secrets, tokens or private keys into docs. Config tables name the variable and where it lives, not its secret value.
