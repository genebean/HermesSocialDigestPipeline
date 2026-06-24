{
  pkgs,
  src,
}:
{
  hermes-social-digest-collect = pkgs.callPackage ./hermes-social-digest-collect.nix { inherit src; };
  hermes-social-digest-compile-context = pkgs.callPackage ./hermes-social-digest-compile-context.nix {
    inherit src;
  };
  hermes-social-digest-skill = pkgs.callPackage ./hermes-social-digest-skill.nix { inherit src; };
}
