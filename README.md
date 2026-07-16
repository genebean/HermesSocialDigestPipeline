# HermesSocialDigestPipeline

HermesSocialDigestPipeline is an end-user tool for building a daily social-feed digest with Hermes Agent. It collects compact candidate items from the read-only `social-reader` MCP, stores them locally on the Hermes host, and emits bounded JSON context that a scheduled Hermes job can turn into a human-readable digest.

The social-reader MCP is treated as a black box. It can stay on another host later; this pipeline does not require scripts, shared files, SSH access, or Hermes Agent on the MCP host.

## Who this is for

Use this repo if you want Hermes to:

- collect social-feed candidates throughout the day without handing the LLM a full raw timeline;
- preserve cursor safety by saving candidates before advancing MCP cursors;
- run from a Nix-managed package or Home Manager module;
- keep digest state on the Hermes Agent host under a private local state directory.

## What you get

Two CLI commands are installed by the package:

```bash
hermes-social-digest-collect
hermes-social-digest-compile-context
```

The flake also exposes app shortcuts:

```bash
nix run .#collect -- --dry-run --verbose
nix run .#compile-context -- --since-hours 24 --max-candidates 250
```

For complete end-user documentation, see:

```text
docs/index.html
```

Open it in a browser, or serve the repo directory with any static file server.

## Quick start: local stdio MCP

This is the current local-development path. It runs the social-reader MCP from the HermesSocialSummerizer checkout over stdio.

```bash
nix run .#collect -- --dry-run --verbose
```

A successful dry run prints a JSON summary and does **not** write state or call `mark_seen`.

To run a real collection:

```bash
nix run .#collect -- --verbose
```

Then compile the cached candidates for the digest LLM prompt:

```bash
nix run .#compile-context -- --since-hours 24 --max-candidates 250
```

## Runtime state

Default state directory:

```text
~/.local/state/HermesSocialSummerizer/social-digest/
```

Override it with:

```bash
export SOCIAL_DIGEST_STATE_DIR=/path/to/social-digest-state
```

State directories are private (`0700`) and state files are private (`0600`) because cached candidates contain personal social-feed content.

Normal collector runs prune state files older than 30 days by default. Use:

```bash
hermes-social-digest-collect --prune-days 0
```

to disable pruning, or:

```bash
hermes-social-digest-collect --prune-days 14
```

to choose a different retention window.

## MCP connection options

### Local stdio mode

```bash
export SOCIAL_READER_MCP_TRANSPORT=stdio
export SOCIAL_READER_MCP_COMMAND=/path/to/HermesSocialSummerizer/node_modules/.bin/tsx
export SOCIAL_READER_MCP_ARGS=/path/to/HermesSocialSummerizer/src/server.ts
```

If an argument contains whitespace, use JSON instead:

```bash
export SOCIAL_READER_MCP_ARGS_JSON='["/path/with spaces/server.ts"]'
```

### HTTP mode for a future LAN MCP

Prefer HTTPS, a localhost tunnel, WireGuard, or an authenticated reverse proxy:

```bash
export SOCIAL_READER_MCP_TRANSPORT=http
export SOCIAL_READER_MCP_URL=https://social-reader.lan/mcp
export SOCIAL_READER_MCP_HTTP_TOKEN=<token>
```

Non-local `http://` MCP URLs are blocked unless explicitly allowed:

```bash
export SOCIAL_READER_MCP_ALLOW_INSECURE_HTTP=true
```

When `SOCIAL_READER_MCP_HTTP_TOKEN` is set, the collector sends it as an HTTP bearer token. Even though the MCP is read-only toward social platforms, it can expose private feed data and `mark_seen`, so do not publish it unauthenticated on an untrusted network.

## Home Manager installation

Import the module from the flake and enable it:

```nix
{
  inputs.hermes-social-digest-pipeline.url = "path:/path/to/HermesSocialDigestPipeline";

  outputs = { self, nixpkgs, home-manager, hermes-social-digest-pipeline, ... }: {
    homeConfigurations.example = home-manager.lib.homeManagerConfiguration {
      pkgs = nixpkgs.legacyPackages.x86_64-linux;
      modules = [
        hermes-social-digest-pipeline.homeManagerModules.default
        {
          programs.hermesSocialDigestPipeline = {
            enable = true;
            timers.enable = true;
          };
        }
      ];
    };
  };
}
```

Useful options:

```nix
programs.hermesSocialDigestPipeline = {
  enable = true;
  stateDir = "/home/YOUR_USER/.local/state/HermesSocialSummerizer/social-digest";
  environmentFile = "/home/YOUR_USER/.config/hermes-social-digest.env"; # optional, keep secrets outside the Nix store

  mcp.transport = "stdio";
  mcp.command = "/path/to/HermesSocialSummerizer/node_modules/.bin/tsx";
  mcp.args = [ "/path/to/HermesSocialSummerizer/src/server.ts" ];

  # Use this instead of mcp.args if an argument contains spaces.
  mcp.argsJson = null;

  timers.enable = true;
  timers.collectSchedules = [ "10:00" "14:00" "18:00" "22:00" ];
  timers.catchupSchedule = "02:00";
};
```

The module can also link the bundled Hermes skill into:

```text
~/.hermes/skills/hermes-social-digest-pipeline
```

## Recommended daily workflow

1. Run collector jobs at 10:00, 14:00, 18:00, and 22:00.
2. Run the smart catch-up collector at 02:00 with `--if-previous-hit-limit`.
3. At digest time, run `hermes-social-digest-compile-context` and feed the JSON output into the Hermes LLM digest prompt.
4. The collector persists candidates before calling `mark_seen`, so failed cursor advancement causes duplicates rather than data loss.

## Development and verification

Assume the host has only Nix. Enter the dev shell before using Node/npm directly:

```bash
nix develop
npm install
npm run typecheck
npm test
npm run build
nix flake check
```

After any `package-lock.json` change, update `npmDepsHash` values in `pkgs/hermes-social-digest-pipeline.nix` and `pkgs/npm-check.nix`:

```bash
nix run nixpkgs#prefetch-npm-deps package-lock.json
```
