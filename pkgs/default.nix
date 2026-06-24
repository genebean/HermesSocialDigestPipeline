{
  pkgs,
  src,
}:
let
  pipeline = pkgs.callPackage ./hermes-social-digest-pipeline.nix { inherit src; };
  npmCheck = script: pkgs.callPackage ./npm-check.nix { inherit src script; };
in
{
  default = pipeline;
  hermes-social-digest-pipeline = pipeline;

  # Compatibility aliases for consumers that prefer package names matching the
  # individual commands. Both point at the single package that installs both
  # binaries, so there is one npm dependency hash and one build recipe.
  hermes-social-digest-collect = pipeline;
  hermes-social-digest-compile-context = pipeline;

  hermes-social-digest-skill = pkgs.callPackage ./hermes-social-digest-skill.nix { inherit src; };

  checks = {
    typecheck = npmCheck "typecheck";
    test = npmCheck "test";
  };
}
