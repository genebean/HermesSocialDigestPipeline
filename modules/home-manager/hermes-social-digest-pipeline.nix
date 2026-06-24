self:
{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.programs.hermesSocialDigestPipeline;
  system = pkgs.stdenv.hostPlatform.system;
  package = cfg.package;
  compilerPackage = cfg.compilerPackage;
  skillPackage = cfg.skillPackage;
  skillSource = "${skillPackage}/share/hermes/skills/hermes-social-digest-pipeline";

  env = {
    SOCIAL_READER_MCP_TRANSPORT = cfg.mcp.transport;
    SOCIAL_DIGEST_STATE_DIR = cfg.stateDir;
  }
  // lib.optionalAttrs (cfg.mcp.transport == "http") {
    SOCIAL_READER_MCP_URL = cfg.mcp.url;
  }
  // lib.optionalAttrs cfg.mcp.allowInsecureHttp {
    SOCIAL_READER_MCP_ALLOW_INSECURE_HTTP = "true";
  }
  // lib.optionalAttrs (cfg.mcp.transport == "stdio") {
    SOCIAL_READER_MCP_COMMAND = cfg.mcp.command;
  }
  // lib.optionalAttrs (cfg.mcp.transport == "stdio" && cfg.mcp.argsJson == null) {
    SOCIAL_READER_MCP_ARGS = lib.concatStringsSep " " cfg.mcp.args;
  }
  // lib.optionalAttrs (cfg.mcp.transport == "stdio" && cfg.mcp.argsJson != null) {
    SOCIAL_READER_MCP_ARGS_JSON = builtins.toJSON cfg.mcp.argsJson;
  };

  envLines = lib.mapAttrsToList (name: value: "${name}=${value}") env;
in
{
  options.programs.hermesSocialDigestPipeline = {
    enable = lib.mkEnableOption "Hermes social digest collector/cache/compiler pipeline";

    package = lib.mkOption {
      type = lib.types.package;
      default = self.packages.${system}.default;
      defaultText = lib.literalExpression "inputs.hermes-social-digest-pipeline.packages.${pkgs.stdenv.hostPlatform.system}.default";
      description = "Collector CLI package to install and use in timers.";
    };

    compilerPackage = lib.mkOption {
      type = lib.types.package;
      default = self.packages.${system}.hermes-social-digest-compile-context;
      defaultText = lib.literalExpression "inputs.hermes-social-digest-pipeline.packages.${pkgs.stdenv.hostPlatform.system}.hermes-social-digest-compile-context";
      description = "Compiler CLI package to install for the 6am digest job.";
    };

    skillPackage = lib.mkOption {
      type = lib.types.package;
      default = self.packages.${system}.hermes-social-digest-skill;
      defaultText = lib.literalExpression "inputs.hermes-social-digest-pipeline.packages.${pkgs.stdenv.hostPlatform.system}.hermes-social-digest-skill";
      description = "Package containing the Hermes skill source.";
    };

    installPackage = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = "Whether to add the collector package to home.packages.";
    };

    linkSkill = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = "Whether to link the pipeline skill into ~/.hermes/skills.";
    };

    stateDir = lib.mkOption {
      type = lib.types.str;
      default = "${config.home.homeDirectory}/.local/state/HermesSocialSummerizer/social-digest";
      description = "Local Hermes-host digest cache/state directory.";
    };

    mcp = {
      transport = lib.mkOption {
        type = lib.types.enum [
          "stdio"
          "http"
        ];
        default = "stdio";
        description = "MCP transport used by the collector.";
      };

      url = lib.mkOption {
        type = lib.types.str;
        default = "";
        description = "HTTP MCP URL when transport is http.";
      };

      allowInsecureHttp = lib.mkOption {
        type = lib.types.bool;
        default = false;
        description = "Permit non-local unencrypted HTTP MCP URLs. Prefer HTTPS, localhost tunnels, or private WireGuard links instead.";
      };

      command = lib.mkOption {
        type = lib.types.str;
        default = "social-reader";
        description = "stdio command for local MCP development.";
      };

      args = lib.mkOption {
        type = lib.types.listOf lib.types.str;
        default = [ ];
        description = "stdio command arguments for local MCP development.";
      };

      argsJson = lib.mkOption {
        type = lib.types.nullOr (lib.types.listOf lib.types.str);
        default = null;
        description = "Whitespace-safe stdio argument list emitted as SOCIAL_READER_MCP_ARGS_JSON. Overrides args when set.";
      };
    };

    timers.enable = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Whether to create user systemd timers for collection.";
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

    timers.catchupSchedule = lib.mkOption {
      type = lib.types.str;
      default = "02:00";
      description = "OnCalendar value for the smart cap-hit catch-up collector.";
    };
  };

  config = lib.mkIf cfg.enable {
    home.packages = lib.mkIf cfg.installPackage [
      package
      compilerPackage
    ];

    home.file.".hermes/skills/hermes-social-digest-pipeline" = lib.mkIf cfg.linkSkill {
      source = skillSource;
    };

    systemd.user.services.hermes-social-digest-collect = lib.mkIf cfg.timers.enable {
      Unit.Description = "Collect social digest candidates";
      Service = {
        Type = "oneshot";
        Environment = envLines;
        ExecStart = "${package}/bin/hermes-social-digest-collect";
      };
    };

    systemd.user.timers.hermes-social-digest-collect = lib.mkIf cfg.timers.enable {
      Unit.Description = "Collect social digest candidates throughout the day";
      Timer = {
        OnCalendar = cfg.timers.collectSchedules;
        Persistent = true;
      };
      Install.WantedBy = [ "timers.target" ];
    };

    systemd.user.services.hermes-social-digest-catchup = lib.mkIf cfg.timers.enable {
      Unit.Description = "Smart overnight social digest catch-up";
      Service = {
        Type = "oneshot";
        Environment = envLines;
        ExecStart = "${package}/bin/hermes-social-digest-collect --if-previous-hit-limit";
      };
    };

    systemd.user.timers.hermes-social-digest-catchup = lib.mkIf cfg.timers.enable {
      Unit.Description = "Smart overnight social digest catch-up if previous run hit caps";
      Timer = {
        OnCalendar = cfg.timers.catchupSchedule;
        Persistent = true;
      };
      Install.WantedBy = [ "timers.target" ];
    };
  };
}
