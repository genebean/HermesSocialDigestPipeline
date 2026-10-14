// The actual collection orchestration - split out from the CLI entrypoint
// (social-digest-collect.ts) specifically so it's unit-testable. That
// script connects to a real MCP server at module load time, which makes it
// unimportable from a test without triggering a live connection attempt;
// this module only depends on McpToolClient's trivial callTool(name, args)
// interface, so a test can inject a stub with no live connection at all.
import {
  batchId,
  effectiveSince,
  pruneOlderThan,
  readCursors,
  writeBatch,
  writeCursor,
  type PlatformCursor,
} from "./digest-cache.js";
import type { McpToolClient } from "./mcp-client.js";
import { normalizePosts } from "./normalize.js";
import type { CollectionBatch, DigestCandidate, DigestPlatform, PlatformBatchSummary } from "./types.js";

// hours has no effect once since_ts is present (nostr_following_feed
// prefers since_ts) - it's only the fallback for a first-ever run or a
// cursor that's gone stale past the pipeline's own lookback floor, so it's
// set from that same constant below rather than an unrelated literal.
export function limitsFor(maxLookbackHours: number) {
  return {
    mastodon: { limit: 40, max_pages: 3, max_content_length: 900 },
    bluesky: { limit: 60, max_pages: 3, max_content_length: 900 },
    nostr: { hours: maxLookbackHours, limit: 100, max_pages: 2, include_engagement: true, max_content_length: 900 },
  } as const;
}

export type CollectOptions = {
  dryRun: boolean;
  pruneDays: number;
  maxLookbackHours: number;
  stateRoot?: string;
};

export type CollectResult = {
  batch: CollectionBatch;
  pruned: number;
};

export async function runCollection(client: McpToolClient, options: CollectOptions): Promise<CollectResult> {
  const limits = limitsFor(options.maxLookbackHours);
  const collectedAt = new Date().toISOString();
  const id = batchId(new Date(collectedAt));
  const candidates: DigestCandidate[] = [];
  const summaries: PlatformBatchSummary[] = [];
  const cursors = await readCursors(options.stateRoot);

  const accounts = (await client.callTool("list_accounts", {})) as Record<string, unknown>;
  for (const { platform, ids } of accountIds(accounts)) {
    for (const accountId of ids) {
      try {
        const since = effectiveSince(cursors[platform]?.[accountId]);
        const { posts, limit, maxPages } = await fetchPlatform(client, platform, accountId, limits, since);
        const normalized = normalizePosts({ platform, accountId, batchId: id, collectedAt, posts, limit, maxPages });
        candidates.push(...normalized.candidates);
        summaries.push(normalized.summary);
      } catch (error) {
        summaries.push({
          platform,
          account_id: accountId,
          fetched_count: 0,
          limit: limits[platform].limit,
          max_pages: limits[platform].max_pages,
          hit_limit: false,
          hit_max_pages: false,
          coverage_complete: false,
          cursor_written: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  let batch: CollectionBatch = {
    schema_version: 1,
    batch_id: id,
    collected_at: collectedAt,
    dry_run: options.dryRun,
    summaries,
    candidates,
  };
  let pruned = 0;

  if (!options.dryRun) {
    await writeBatch(batch, options.stateRoot);

    for (const summary of summaries.filter((s) => !s.error && s.cursor_value !== undefined && s.fetched_count > 0)) {
      try {
        const cursor: PlatformCursor = { cursor_created_at: summary.cursor_created_at };
        if (summary.platform === "mastodon") cursor.since_id = String(summary.cursor_value);
        else if (summary.platform === "bluesky") cursor.since = String(summary.cursor_value);
        else cursor.since_ts = Number(summary.cursor_value);
        await writeCursor(summary.platform, summary.account_id, cursor, options.stateRoot);
        summary.cursor_written = true;
      } catch (error) {
        summary.cursor_write_error = error instanceof Error ? error.message : String(error);
      }
    }

    batch = { ...batch, summaries };
    await writeBatch(batch, options.stateRoot);

    const fetchErrors = summaries.filter((s) => s.error);
    const cursorWriteErrors = summaries.filter((s) => s.cursor_write_error);
    if (fetchErrors.length === 0 && cursorWriteErrors.length === 0 && options.pruneDays > 0) {
      pruned = (await pruneOlderThan(options.pruneDays, options.stateRoot)).length;
    }
  }

  return { batch, pruned };
}

export function accountIds(accounts: Record<string, unknown>): Array<{ platform: DigestPlatform; ids: string[] }> {
  return (["mastodon", "bluesky", "nostr"] as DigestPlatform[]).map((platform) => ({
    platform,
    ids: Array.isArray(accounts[platform])
      ? (accounts[platform] as unknown[])
          .map((item) => (typeof item === "object" && item !== null && "id" in item ? String((item as { id: unknown }).id) : undefined))
          .filter((id): id is string => Boolean(id))
      : [],
  }));
}

export async function fetchPlatform(
  client: McpToolClient,
  platform: DigestPlatform,
  accountId: string,
  limits: ReturnType<typeof limitsFor>,
  since: PlatformCursor
): Promise<{ posts: unknown[]; limit: number; maxPages: number }> {
  if (platform === "mastodon") {
    const args = { account_id: accountId, ...limits.mastodon, ...(since.since_id ? { since_id: since.since_id } : {}) };
    return { posts: await arrayResult(client.callTool("mastodon_home_timeline", args)), limit: args.limit, maxPages: args.max_pages };
  }
  if (platform === "bluesky") {
    const args = { account_id: accountId, ...limits.bluesky, ...(since.since ? { since: since.since } : {}) };
    return { posts: await arrayResult(client.callTool("bluesky_timeline", args)), limit: args.limit, maxPages: args.max_pages };
  }
  const args = { account_id: accountId, ...limits.nostr, ...(since.since_ts ? { since_ts: since.since_ts } : {}) };
  return { posts: await arrayResult(client.callTool("nostr_following_feed", args)), limit: args.limit, maxPages: args.max_pages };
}

async function arrayResult(value: Promise<unknown>): Promise<unknown[]> {
  const resolved = await value;
  if (!Array.isArray(resolved)) throw new Error(`Expected array tool result, got ${typeof resolved}`);
  return resolved;
}
