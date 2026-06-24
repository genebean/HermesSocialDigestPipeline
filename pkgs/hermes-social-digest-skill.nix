{
  runCommand,
  src,
}:

runCommand "hermes-social-digest-skill-0.1.0" { } ''
  mkdir -p $out/share/hermes/skills
  cp -r ${src}/skills/hermes-social-digest-pipeline \
    $out/share/hermes/skills/hermes-social-digest-pipeline
''
