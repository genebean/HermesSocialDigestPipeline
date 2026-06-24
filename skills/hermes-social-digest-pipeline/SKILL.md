---
name: hermes-social-digest-pipeline
description: Use when operating the Hermes-side social digest collector/cache/compiler pipeline that consumes the read-only HermesSocialSummerizer MCP as a black-box endpoint.
version: 0.1.0
author: Hermes Agent
license: MIT
metadata:
  hermes:
    tags: [social-feed, mcp, cron, nix, home-manager]
    related_skills: [social-feed-interest-scan, home-manager-flake-integrations]
---

# Hermes Social Digest Pipeline

## Overview

This skill documents the Hermes-side pipeline that collects compact candidates from a read-only HermesSocialSummerizer MCP server and compiles bounded context for a daily LLM-generated digest.

The MCP server is a black box. Do not require scripts, shared files, SSH access, or a Hermes Agent on the MCP host. The collector/compiler run on the Hermes host and talk to MCP via configurable stdio or HTTP transport.

## When to Use

- Maintaining `HermesSocialDigestPipeline`.
- Wiring Hermes cron jobs for social digest collection.
- Debugging digest cache coverage, cap hits, or cursor safety.
- Installing the pipeline through Nix/Home Manager.

## Runtime State

Default state path:

```text
/home/gene/.local/state/HermesSocialSummerizer/social-digest/
```

Override with `SOCIAL_DIGEST_STATE_DIR`.

## Cursor Safety

1. Fetch timeline candidates with `advance_cursor: false`.
2. Persist candidates and batch summaries locally.
3. Only after persistence succeeds, call `mark_seen` for successful platform/account batches.
4. If `mark_seen` fails after persistence, accept duplicates; dedupe handles them and data is not lost.

## Nix/Home Manager

This repo exposes packages/apps plus `homeManagerModules.hermes-social-digest-pipeline`.

The module can install CLI tools, link this skill into the active Hermes profile, and define user timers. Direct `home.file` linking from the user's main flake remains acceptable.

## Verification Checklist

- [ ] `nix develop -c npm run typecheck` passes.
- [ ] `nix develop -c npm test` passes.
- [ ] `nix develop -c npm run build` passes.
- [ ] `nix flake check` passes.
- [ ] Collector dry-run does not change MCP cursor state.
- [ ] Compiler emits bounded JSON context.
