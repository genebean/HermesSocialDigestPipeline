{
  buildNpmPackage,
  nodejs_24,
  src,
  script,
}:

buildNpmPackage {
  pname = "hermes-social-digest-${script}";
  version = "0.1.0";
  inherit src;
  nodejs = nodejs_24;

  # Recompute after any package-lock.json change:
  #   nix run nixpkgs#prefetch-npm-deps package-lock.json
  npmDepsHash = "sha256-Hvl9OV3S/mfc2lIHYF00xyxlb0BYtHzfqXuk/8PtBKw=";

  npmBuildScript = script;

  installPhase = ''
    runHook preInstall
    mkdir -p $out
    touch $out/${script}
    runHook postInstall
  '';
}
