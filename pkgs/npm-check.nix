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
  npmDepsHash = "sha256-5lqkcPvmSMYr3Y6pliehdM4gsm3Bnc3AnGb/CyCKsx0=";

  npmBuildScript = script;

  installPhase = ''
    runHook preInstall
    mkdir -p $out
    touch $out/${script}
    runHook postInstall
  '';
}
