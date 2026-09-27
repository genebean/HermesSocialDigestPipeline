# NixOS module for the Hermes social digest collector/catchup timers.
#
# This module only covers the deterministic, non-LLM half of the pipeline:
# collecting candidates from the read-only social-reader-mcp and pruning old
# state. It deliberately does NOT install the Hermes skill or run anything
# that turns collected candidates into a human-readable digest — that step
# needs an actual agent invocation and belongs to whatever Hermes coordinator
# profile eventually reads ~/.hermes/skills on this host.
#
# Runs as a dedicated system user (not DynamicUser) for the same reason
# social-reader-mcp's module does: sops-nix needs a stable, known account to
# assign ownership of the decrypted EnvironmentFile at activation time, before
# any dynamically-allocated uid would exist.
#
# Systemd hardening here is intentionally strict. On a host that also runs
# other sensitive services (a Forgejo instance, an SSO/identity provider,
# etc.), this collector must not be able to read anything outside its own
# state directory — ProtectSystem/ProtectHome/ReadWritePaths do that
# regardless of what else lives on the same box. That namespacing already
# gets most of what a podman/systemd-nspawn container would buy for a job
# this narrow (fixed read-only MCP tool calls, no untrusted content
# execution); reach for an actual OCI or nspawn container instead of plain
# systemd hardening for future workers that render or execute untrusted
# external content, where filesystem/network namespacing alone isn't enough.

self:
{
  config,
  lib,
  pkgs,
  ...
}:

let
  cfg = config.services.hermes-social-digest-collect;
  system = pkgs.stdenv.hostPlatform.system;

  commonEnv = {
    SOCIAL_READER_MCP_TRANSPORT = cfg.mcp.transport;
    SOCIAL_DIGEST_STATE_DIR = "/var/lib/${cfg.stateDirectoryName}";
  }
  // lib.optionalAttrs (cfg.mcp.transport == "http") {
    SOCIAL_READER_MCP_URL = cfg.mcp.url;
  }
  // lib.optionalAttrs cfg.mcp.allowInsecureHttp {
    SOCIAL_READER_MCP_ALLOW_INSECURE_HTTP = "true";
  };

  hardening = {
    AmbientCapabilities = "";
    CapabilityBoundingSet = "";
    Group = cfg.group;
    LockPersonality = true;
    NoNewPrivileges = true;
    ProcSubset = "pid";
    ProtectClock = true;
    ProtectControlGroups = true;
    ProtectHome = true;
    ProtectHostname = true;
    ProtectKernelLogs = true;
    ProtectKernelModules = true;
    ProtectKernelTunables = true;
    ProtectProc = "invisible";
    ProtectSystem = "strict";
    PrivateTmp = true;
    RemoveIPC = true;
    RestrictNamespaces = true;
    RestrictRealtime = true;
    RestrictSUIDSGID = true;
    StateDirectory = cfg.stateDirectoryName;
    StateDirectoryMode = "0700";
    SystemCallErrorNumber = "EPERM";
    SystemCallFilter = [ "@system-service" ];
    User = cfg.user;
  }
  // lib.optionalAttrs (cfg.environmentFile != null) {
    EnvironmentFile = cfg.environmentFile;
  };

  mkOneshot = execStart: {
    after = [ "network-online.target" ];
    serviceConfig = hardening // {
      Environment = lib.mapAttrsToList (n: v: "${n}=${v}") commonEnv;
      ExecStart = execStart;
      Type = "oneshot";
    };
    wants = [ "network-online.target" ];
  };

  mkTimer = onCalendar: {
    timerConfig = {
      OnCalendar = onCalendar;
      Persistent = true;
    };
    wantedBy = [ "timers.target" ];
  };
in
{
  options.services.hermes-social-digest-collect = {
    enable = lib.mkEnableOption "Hermes social digest collector timers (collect + overnight catch-up)";

    environmentFile = lib.mkOption {
      type = lib.types.nullOr lib.types.path;
      default = null;
      example = "/run/secrets/hermes_social_digest_mcp_token";
      description = ''
        Path to a sops-nix (or equivalent) managed EnvironmentFile providing
        SOCIAL_READER_MCP_HTTP_TOKEN. Scope this secret to ONLY that bearer
        token — do not point it at the same secret file the MCP server
        itself uses, which also carries Mastodon/Bluesky/Nostr credentials
        this collector has no need to read.
      '';
    };

    group = lib.mkOption {
      type = lib.types.str;
      default = "hermes-social-digest";
      description = "Dedicated system group for the collector user.";
    };

    mcp.allowInsecureHttp = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = ''
        Permit a plain http:// MCP URL. Defaults to true because the default
        mcp.url below is loopback-only traffic that never leaves the host.
        Set to false if you point mcp.url at anything that traverses a
        network, and use TLS or a private WireGuard/Tailscale link instead.
      '';
    };

    mcp.transport = lib.mkOption {
      type = lib.types.enum [
        "http"
        "stdio"
      ];
      default = "http";
      description = "MCP transport the collector uses to reach social-reader-mcp.";
    };

    mcp.url = lib.mkOption {
      type = lib.types.str;
      default = "http://127.0.0.1:8787";
      description = ''
        HTTP MCP URL. Defaults to the loopback address on the assumption
        that this service is co-located on the same host as
        services.social-reader-mcp's HTTP listener — no LAN or Tailscale
        hop, and no need to widen the MCP's bind address for this consumer.
      '';
    };

    package = lib.mkOption {
      type = lib.types.package;
      default = self.packages.${system}.hermes-social-digest-collect;
      defaultText = lib.literalExpression "inputs.hermes-social-digest-pipeline.packages.\${system}.hermes-social-digest-collect";
      description = "Package providing the hermes-social-digest-collect binary.";
    };

    stateDirectoryName = lib.mkOption {
      type = lib.types.str;
      default = "hermes-social-digest";
      description = ''
        Name passed to systemd's StateDirectory= (resolves to
        /var/lib/<name>). Cached candidates contain personal social-feed
        content, so this directory is 0700 and owned solely by
        services.hermes-social-digest-collect.user.
      '';
    };

    timers.catchupSchedule = lib.mkOption {
      type = lib.types.str;
      default = "02:00";
      description = "OnCalendar value for the smart cap-hit catch-up collector.";
    };

    timers.collectSchedules = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = [
        "10:00"
        "14:00"
        "18:00"
        "22:00"
      ];
      description = "OnCalendar values for normal collection runs.";
    };

    user = lib.mkOption {
      type = lib.types.str;
      default = "hermes-social-digest";
      description = ''
        Dedicated system user this service runs as. Kept separate from any
        other agent identity (e.g. a future coordinator user) on the same
        host — this profile's only reason to exist is calling read-only MCP
        tools and writing its own local cache.
      '';
    };
  };

  config = lib.mkIf cfg.enable {
    systemd = {
      services = {
        hermes-social-digest-catchup =
          mkOneshot "${cfg.package}/bin/hermes-social-digest-collect --if-previous-hit-limit"
          // {
            description = "Smart overnight social digest catch-up";
          };

        hermes-social-digest-collect = mkOneshot "${cfg.package}/bin/hermes-social-digest-collect" // {
          description = "Collect social digest candidates";
        };
      };

      timers = {
        hermes-social-digest-catchup = mkTimer cfg.timers.catchupSchedule // {
          description = "Smart overnight social digest catch-up if previous run hit caps";
        };

        hermes-social-digest-collect = mkTimer cfg.timers.collectSchedules // {
          description = "Collect social digest candidates throughout the day";
        };
      };
    };

    users = {
      groups.${cfg.group} = { };
      users.${cfg.user} = {
        description = "Hermes social digest collector (read-only MCP client)";
        group = cfg.group;
        isSystemUser = true;
      };
    };
  };
}
