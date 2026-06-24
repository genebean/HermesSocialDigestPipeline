# Cron Setup

Suggested collector cadence:

- 10:00 — normal collection
- 14:00 — normal collection
- 18:00 — normal collection
- 22:00 — normal collection
- 02:00 — smart catch-up with `--if-previous-hit-limit`

Collectors should run with `no_agent=true` when scheduled by Hermes cron and should print nothing on success.

The 06:00 digest job runs the compiler first and feeds its compact JSON output into the LLM prompt.
