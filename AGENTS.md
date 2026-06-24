# AGENTS.md — HermesSocialDigestPipeline

This repo contains Hermes-side automation for social digest collection. The MCP server is a black box: do not add requirements that scripts live on the MCP host, and do not assume SSH/shared files to the MCP host.

## Tooling

Use the Nix dev shell for all development commands:

```bash
nix develop
npm run typecheck
npm test
npm run build
nix flake check
```

Assume the host has only Nix. Do not rely on globally installed Node/npm.

## Architecture

- CLI code lives in `src/`.
- Nix package derivations live in `pkgs/`, one package per file.
- `pkgs/default.nix` collects packages for `flake.nix`.
- Home Manager module lives under `modules/home-manager/`.
- Hermes skill source lives under `skills/hermes-social-digest-pipeline/`.
- Runtime state is outside the repo under `~/.local/state/HermesSocialSummerizer/social-digest/` by default.

## Safety

The collector may call only read-only MCP feed tools and `mark_seen`. It must fetch with `advance_cursor: false`, persist candidates durably, then call `mark_seen` only for successfully persisted platform/account batches.
