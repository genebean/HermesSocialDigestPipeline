{
  buildNpmPackage,
  lib,
  makeWrapper,
  nodejs_24,
  src,
}:

buildNpmPackage {
  pname = "hermes-social-digest-collect";
  version = "0.1.0";
  inherit src;
  nodejs = nodejs_24;

  # Recompute after any package-lock.json change:
  #   nix run nixpkgs#prefetch-npm-deps package-lock.json
  npmDepsHash = "sha256-5lqkcPvmSMYr3Y6pliehdM4gsm3Bnc3AnGb/CyCKsx0=";

  npmBuildScript = "build";
  nativeBuildInputs = [ makeWrapper ];

  installPhase = ''
    runHook preInstall
    mkdir -p $out/lib/hermes-social-digest-pipeline $out/bin
    cp -r dist package.json node_modules $out/lib/hermes-social-digest-pipeline/
    makeWrapper ${nodejs_24}/bin/node $out/bin/hermes-social-digest-collect \
      --add-flags "$out/lib/hermes-social-digest-pipeline/dist/social-digest-collect.js"
    runHook postInstall
  '';
}
