{
  description = "Hermes-side social digest collector/cache/compiler pipeline";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";
    flake-utils.url = "github:numtide/flake-utils";
    home-manager = {
      url = "github:nix-community/home-manager/release-26.05";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
      home-manager,
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        packages' = import ./pkgs {
          inherit pkgs;
          src = ./.;
        };
      in
      {
        formatter = pkgs.nixfmt-tree;

        packages = builtins.removeAttrs (
          packages'
          // {
            default = packages'.hermes-social-digest-collect;
          }
        ) [ "checks" ];

        apps = {
          collect = {
            type = "app";
            program = "${packages'.hermes-social-digest-collect}/bin/hermes-social-digest-collect";
            meta.description = "Collect compact social digest candidates from the configured MCP server";
          };
          compile-context = {
            type = "app";
            program = "${packages'.hermes-social-digest-compile-context}/bin/hermes-social-digest-compile-context";
            meta.description = "Compile cached social digest candidates into bounded LLM context";
          };
        };

        checks = {
          typecheck = packages'.checks.typecheck;
          test = packages'.checks.test;
          package = packages'.hermes-social-digest-pipeline;
          home-manager-module =
            (home-manager.lib.homeManagerConfiguration {
              inherit pkgs;
              modules = [
                self.homeManagerModules.default
                {
                  home.username = "alice";
                  home.homeDirectory = "/home/alice";
                  home.stateVersion = "26.05";
                  programs.hermesSocialDigestPipeline.enable = true;
                }
              ];
            }).activationPackage;
        };

        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            nodejs_24
            deadnix
            nixfmt-tree
            pre-commit
          ];

          shellHook = ''
            if [[ "$-" == *i* ]]; then
              echo "HermesSocialDigestPipeline dev shell"
              echo ""
              echo "  All npm / npx commands should run inside this shell."
              echo ""
              echo "  npm install                         install/update node_modules"
              echo "  npm run typecheck                   TypeScript type check"
              echo "  npm test                            run unit tests"
              echo "  npm run build                       compile src/ -> dist/"
              echo "  npm run collect:digest -- --help    collector CLI help"
              echo "  npm run compile:digest-context -- --help"
              echo ""
              echo "  After changing package-lock.json, update npmDepsHash in pkgs/*.nix:"
              echo "    nix run nixpkgs#prefetch-npm-deps package-lock.json"
              echo ""
            fi
          '';
        };
      }
    )
    // {
      homeManagerModules.default = self.homeManagerModules.hermes-social-digest-pipeline;
      homeManagerModules.hermes-social-digest-pipeline = import ./modules/home-manager/hermes-social-digest-pipeline.nix self;
    };
}
