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
  npmDepsHash = "sha256-PuGrUaj8qh1BzIN+w62lns5eeMuBjEGyl00oFcuTeBc=";

  npmBuildScript = script;

  installPhase = ''
    runHook preInstall
    mkdir -p $out
    touch $out/${script}
    runHook postInstall
  '';
}
