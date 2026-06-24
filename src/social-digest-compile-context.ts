#!/usr/bin/env node
import { numberOption, printHelpAndExit } from "./cli.js";
import { dedupeCandidates, readCandidatesSince, resolveStateDir } from "./digest-cache.js";

if (process.argv.includes("--help")) {
  printHelpAndExit(`
Usage: hermes-social-digest-compile-context [options]

Options:
  --since-hours N       Candidate window in hours (default: 24)
  --max-candidates N   Maximum candidates emitted (default: 250)
  --help               Show this help
`);
}

const sinceHours = numberOption("--since-hours", 24, { min: 1 });
const maxCandidates = numberOption("--max-candidates", 250, { min: 1 });
const since = new Date(Date.now() - sinceHours * 60 * 60 * 1000);
const candidates = dedupeCandidates(await readCandidatesSince(since)).slice(0, maxCandidates);

const platformCounts = candidates.reduce<Record<string, number>>((acc, candidate) => {
  acc[candidate.platform] = (acc[candidate.platform] ?? 0) + 1;
  return acc;
}, {});

console.log(JSON.stringify({
  schema_version: 1,
  generated_at: new Date().toISOString(),
  state_dir: resolveStateDir(),
  since: since.toISOString(),
  candidate_count: candidates.length,
  platform_counts: platformCounts,
  candidates,
}, null, 2));
