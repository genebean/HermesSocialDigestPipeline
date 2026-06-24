# Cron setup

Collectors should run as silent script-only jobs. Normal cadence: 10:00, 14:00, 18:00, 22:00. Smart overnight catch-up runs at 02:00 with `--if-previous-hit-limit`.

Normal collector runs prune state files older than 30 days by default. Override with `--prune-days N` or disable retention pruning with `--prune-days 0`.

The 6am LLM digest job should consume `hermes-social-digest-compile-context` output and should not fetch full-day timelines directly unless the cache is missing and the user approves fallback behavior.
