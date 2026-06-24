#!/usr/bin/env node
import { hasFlag, numberOption, printHelpAndExit } from "./cli.js";
import { batchId, latestSuccessfulSummary, previousRunHitLimit, pruneOlderThan, writeBatch } from "./digest-cache.js";
import { connectMcpFromEnv } from "./mcp-client.js";
import { normalizePosts } from "./normalize.js";
import type { CollectionBatch, DigestCandidate, DigestPlatform, PlatformBatchSummary } from "./types.js";

const LIMITS = {
  mastodon: { limit: 40, max_pages: 3, max_content_length: 900 },
  bluesky: { limit: 60, max_pages: 3, max_content_length: 900 },
  nostr: { hours: 8, limit: 100, max_pages: 2, include_engagement: true, max_content_length: 900 },
} as const;

if (process.argv.includes("--help")) {
  printHelpAndExit(`
Usage: hermes-social-digest-collect [options]

Options:
  --dry-run                 Fetch and summarize without writing cache or marking seen
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

const collectedAt = new Date().toISOString();
const id = batchId(new Date(collectedAt));
const candidates: DigestCandidate[] = [];
const summaries: PlatformBatchSummary[] = [];
const client = await connectMcpFromEnv();
let wroteInitialBatch = false;
let pruned = 0;

try {
  const accounts = await client.callTool("list_accounts", {}) as Record<string, unknown>;
  for (const { platform, ids } of accountIds(accounts)) {
    for (const accountId of ids) {
      try {
        const { posts, limit, maxPages } = await fetchPlatform(client, platform, accountId);
        const normalized = normalizePosts({ platform, accountId, batchId: id, collectedAt, posts, limit, maxPages });
        candidates.push(...normalized.candidates);
        summaries.push(normalized.summary);
      } catch (error) {
        summaries.push({
          platform,
          account_id: accountId,
          fetched_count: 0,
          limit: platform === "nostr" ? LIMITS.nostr.limit : platform === "bluesky" ? LIMITS.bluesky.limit : LIMITS.mastodon.limit,
          max_pages: platform === "nostr" ? LIMITS.nostr.max_pages : platform === "bluesky" ? LIMITS.bluesky.max_pages : LIMITS.mastodon.max_pages,
          hit_limit: false,
          hit_max_pages: false,
          coverage_complete: false,
          marked_seen: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  const batch: CollectionBatch = { schema_version: 1, batch_id: id, collected_at: collectedAt, dry_run: dryRun, summaries, candidates };
  if (!dryRun) {
    await writeBatch(batch);
    wroteInitialBatch = true;

    for (const summary of summaries.filter((s) => !s.error && s.cursor_value !== undefined && s.fetched_count > 0)) {
      try {
        await client.callTool("mark_seen", {
          platform: summary.platform,
          account_id: summary.account_id,
          cursor_value: summary.cursor_value,
        });
        summary.marked_seen = true;
      } catch (error) {
        summary.mark_seen_error = error instanceof Error ? error.message : String(error);
      }
    }

    const fetchErrors = summaries.filter((s) => s.error);
    const markSeenErrors = summaries.filter((s) => s.mark_seen_error);
    if (fetchErrors.length === 0 && markSeenErrors.length === 0 && pruneDays > 0) {
      pruned = (await pruneOlderThan(pruneDays)).length;
    }
  }
} finally {
  if (wroteInitialBatch) {
    await writeBatch({ schema_version: 1, batch_id: id, collected_at: collectedAt, dry_run: dryRun, summaries, candidates });
  }
  await client.close();
}

const fetchErrors = summaries.filter((s) => s.error);
const markSeenErrors = summaries.filter((s) => s.mark_seen_error);
if (verbose) console.log(JSON.stringify({ batch_id: id, dry_run: dryRun, candidate_count: candidates.length, pruned, summaries }, null, 2));
if (fetchErrors.length > 0 || markSeenErrors.length > 0) {
  console.error(`Collection completed with ${fetchErrors.length} fetch error(s) and ${markSeenErrors.length} mark_seen error(s).`);
  process.exitCode = 1;
}

function accountIds(accounts: Record<string, unknown>): Array<{ platform: DigestPlatform; ids: string[] }> {
  return (["mastodon", "bluesky", "nostr"] as DigestPlatform[]).map((platform) => ({
    platform,
    ids: Array.isArray(accounts[platform])
      ? (accounts[platform] as unknown[])
        .map((item) => typeof item === "object" && item !== null && "id" in item ? String((item as { id: unknown }).id) : undefined)
        .filter((id): id is string => Boolean(id))
      : [],
  }));
}

async function fetchPlatform(client: Awaited<ReturnType<typeof connectMcpFromEnv>>, platform: DigestPlatform, accountId: string): Promise<{ posts: unknown[]; limit: number; maxPages: number }> {
  if (platform === "mastodon") {
    const args = { account_id: accountId, ...LIMITS.mastodon, advance_cursor: false };
    return { posts: await arrayResult(client.callTool("mastodon_home_timeline", args)), limit: args.limit, maxPages: args.max_pages };
  }
  if (platform === "bluesky") {
    const args = { account_id: accountId, ...LIMITS.bluesky, advance_cursor: false };
    return { posts: await arrayResult(client.callTool("bluesky_timeline", args)), limit: args.limit, maxPages: args.max_pages };
  }
  const args = { account_id: accountId, ...LIMITS.nostr, advance_cursor: false };
  return { posts: await arrayResult(client.callTool("nostr_following_feed", args)), limit: args.limit, maxPages: args.max_pages };
}

async function arrayResult(value: Promise<unknown>): Promise<unknown[]> {
  const resolved = await value;
  if (!Array.isArray(resolved)) throw new Error(`Expected array tool result, got ${typeof resolved}`);
  return resolved;
}
