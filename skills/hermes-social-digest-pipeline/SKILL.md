---
name: hermes-social-digest-pipeline
description: Use when operating or modifying the Hermes-side social digest collector/cache/compiler pipeline for a black-box social-reader MCP.
version: 0.1.0
author: Hermes Agent
license: MIT
metadata:
  hermes:
    tags: [hermes, social-reader, cron, nix, home-manager]
    related_skills: [social-feed-interest-scan]
---

# Hermes Social Digest Pipeline

## Overview

This skill is the operational runbook for `HermesSocialDigestPipeline`, a Hermes-host automation package that collects compact social-feed candidates from a black-box `social-reader` MCP and compiles bounded context for a 6am LLM digest.

The MCP host is independent. Do not require a Hermes Agent, digest scripts, SSH access, shared files, or extra MCP tools on the MCP host. The pipeline runs on the Hermes host and talks to the MCP using a configured stdio or HTTP transport.

## When to Use

Use this skill when:

- wiring Hermes cron jobs for recurring social digests;
- debugging collector/cache/compiler behavior;
- changing Nix packages, Home Manager integration, or skill installation;
- moving from local stdio MCP access to LAN HTTP MCP access;
- verifying cursor safety or cache retention behavior.

Do not use this skill for editorial ranking alone; use `social-feed-interest-scan` for ranking preferences and digest content policy.

## State and boundaries

- Runtime state lives on the Hermes host under `${SOCIAL_DIGEST_STATE_DIR}`.
- Default state dir: `~/.local/state/HermesSocialSummerizer/social-digest`.
- State directories are private (`0700`) and files are private (`0600`).
- Normal collector runs prune state files older than 30 days by default; use `--prune-days 0` to disable pruning.
- Candidate rows are stored as per-batch JSONL files under `candidates/YYYY-MM-DD/<batch-id>.jsonl`.
- The MCP owns platform credentials and platform cursor state.
- The pipeline owns candidate cache, batch summaries, generated briefing artifacts, and smart catch-up decisions.
- Persist candidates before calling `mark_seen`. If `mark_seen` fails after persistence, accept duplicates; dedupe handles them and data is not lost.

## Commands

```bash
hermes-social-digest-collect --dry-run --verbose
hermes-social-digest-collect --if-previous-hit-limit
hermes-social-digest-collect --prune-days 30
hermes-social-digest-compile-context --since-hours 24 --max-candidates 250
```

Nix equivalents:

```bash
nix run /path/to/HermesSocialDigestPipeline#collect -- --dry-run --verbose
nix run /path/to/HermesSocialDigestPipeline#compile-context -- --since-hours 24 --max-candidates 250
```

## Environment

```bash
SOCIAL_READER_MCP_TRANSPORT=stdio|http
SOCIAL_READER_MCP_COMMAND=/path/to/HermesSocialSummerizer/node_modules/.bin/tsx
SOCIAL_READER_MCP_ARGS=/path/to/HermesSocialSummerizer/src/server.ts
SOCIAL_READER_MCP_ARGS_JSON=["/path/with spaces/server.ts"]
SOCIAL_READER_MCP_URL=https://social-reader.lan/mcp
SOCIAL_READER_MCP_HTTP_TOKEN=<token>
SOCIAL_READER_MCP_ALLOW_INSECURE_HTTP=true
SOCIAL_DIGEST_STATE_DIR=/path/to/social-digest-state
```

For HTTP MCP access, prefer HTTPS, localhost tunnels, WireGuard, or an authenticated reverse proxy. Set `SOCIAL_READER_MCP_HTTP_TOKEN` when the MCP requires bearer-token authentication. Non-local `http://` URLs require the explicit insecure opt-in above.

When using the Home Manager module and stdio arguments contain whitespace, set `programs.hermesSocialDigestPipeline.mcp.argsJson`; it emits `SOCIAL_READER_MCP_ARGS_JSON` and overrides the whitespace-joined `mcp.args` value.

For HTTP bearer tokens under Home Manager, set `programs.hermesSocialDigestPipeline.environmentFile` to a user-private environment file outside the Nix store containing `SOCIAL_READER_MCP_HTTP_TOKEN=...`.

## Schedule

Collector cadence:

- 10:00 — normal collection
- 14:00 — normal collection
- 18:00 — normal collection
- 22:00 — normal collection
- 02:00 — smart catch-up with `--if-previous-hit-limit`

The smart catch-up exits silently when the previous successful batch did not hit a limit, max-pages cap, or incomplete coverage flag.

## Verification Checklist

- [ ] `nix develop -c npm run typecheck` passes.
- [ ] `nix develop -c npm test` passes.
- [ ] `nix develop -c npm run build` passes.
- [ ] `nix flake check` passes and runs package, typecheck, test, and Home Manager module checks.
- [ ] dry-run collection does not call `mark_seen`.
- [ ] collector writes only under `SOCIAL_DIGEST_STATE_DIR`.
- [ ] compiler output is bounded and does not emit raw full feeds.
- [ ] Home Manager module links the skill only on the Hermes host.
