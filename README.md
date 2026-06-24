# HermesSocialDigestPipeline

Hermes-side collector/cache/compiler tooling for daily social digests generated from a read-only HermesSocialSummerizer MCP server.

The MCP server is treated as a black box. This package runs on the Hermes Agent host, talks to the MCP over stdio today or HTTP later, stores compact candidates locally, and emits bounded context for the 6am LLM digest job.

## Tooling contract

Assume the host has only Nix. Enter the dev shell before running Node/npm commands:

```bash
nix develop
npm install
npm run typecheck
npm test
npm run build
```

After any `package-lock.json` change, update the `npmDepsHash` values in `pkgs/hermes-social-digest-collect.nix` and `pkgs/hermes-social-digest-compile-context.nix`:

```bash
nix run nixpkgs#prefetch-npm-deps package-lock.json
```

## Runtime state

Default state directory:

```text
/home/gene/.local/state/HermesSocialSummerizer/social-digest/
```

Override with `SOCIAL_DIGEST_STATE_DIR`.

## MCP connection

Local stdio mode:

```bash
export SOCIAL_READER_MCP_TRANSPORT=stdio
export SOCIAL_READER_MCP_COMMAND=/home/gene/repos/HermesSocialSummerizer/node_modules/.bin/tsx
export SOCIAL_READER_MCP_ARGS=/home/gene/repos/HermesSocialSummerizer/src/server.ts
```

Future LAN mode:

```bash
export SOCIAL_READER_MCP_TRANSPORT=http
export SOCIAL_READER_MCP_URL=http://social-reader.lan:PORT/mcp
```

## Commands

```bash
nix run .#collect -- --dry-run --verbose
nix run .#compile-context -- --since-hours 24 --max-candidates 250
```

Installed binaries:

```bash
hermes-social-digest-collect
hermes-social-digest-compile-context
```

## Home Manager

The flake exposes `homeManagerModules.hermes-social-digest-pipeline`. Import it from your primary flake to install the package, link the Hermes skill, and optionally create user timers.

Direct `home.file` linking is also supported; the skill package installs source files under:

```text
$out/share/hermes/skills/hermes-social-digest-pipeline/
```
