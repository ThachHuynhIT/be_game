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
  - `docs/SELF_HOSTING.md`: self-hosted server, CD, config locations, runbook, troubleshooting.
  - `CLAUDE.md` + `.claude/rules/`: short, enforceable rules for agents; link to the docs instead of repeating them.
- Keep the game tables consistent across `README.md`, `docs/GUIDE.md` and `CLAUDE.md` (name, dir, player count, WS path).
- Never write secrets, tokens or private keys into docs. Config tables name the variable and where it lives, not its secret value.
