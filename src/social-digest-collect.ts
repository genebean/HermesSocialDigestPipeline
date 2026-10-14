#!/usr/bin/env node
import { hasFlag, numberOption, printHelpAndExit } from "./cli.js";
import { latestSuccessfulSummary, MAX_LOOKBACK_HOURS, previousRunHitLimit } from "./digest-cache.js";
import { runCollection } from "./collect-run.js";
import { connectMcpFromEnv } from "./mcp-client.js";

if (process.argv.includes("--help")) {
  printHelpAndExit(`
Usage: hermes-social-digest-collect [options]

Options:
  --dry-run                 Fetch and summarize without writing cache or advancing cursors
  --verbose                 Print a concise run summary
  --if-previous-hit-limit   Exit silently unless the previous successful batch hit a cap
  --prune-days N            Delete state files older than N days after a successful run (default: 30, 0 disables)
  --help                    Show this help
`);
}

const dryRun = hasFlag("--dry-run");
const verbose = hasFlag("--verbose");
const pruneDays = numberOption("--prune-days", 30, { min: 0 });

if (hasFlag("--if-previous-hit-limit")) {
  const previous = await latestSuccessfulSummary();
  if (!previousRunHitLimit(previous)) process.exit(0);
}

const client = await connectMcpFromEnv();
try {
  const { batch, pruned } = await runCollection(client, { dryRun, pruneDays, maxLookbackHours: MAX_LOOKBACK_HOURS });

  const fetchErrors = batch.summaries.filter((s) => s.error);
  const cursorWriteErrors = batch.summaries.filter((s) => s.cursor_write_error);
  if (verbose) {
    console.log(
      JSON.stringify({ batch_id: batch.batch_id, dry_run: dryRun, candidate_count: batch.candidates.length, pruned, summaries: batch.summaries }, null, 2)
    );
  }
  if (fetchErrors.length > 0 || cursorWriteErrors.length > 0) {
    console.error(`Collection completed with ${fetchErrors.length} fetch error(s) and ${cursorWriteErrors.length} cursor-write error(s).`);
    process.exitCode = 1;
  }
} finally {
  await client.close();
}
