import { newestCursor, stableKey, titleFromText } from "./digest-cache.js";
import type { DigestCandidate, DigestPlatform, PlatformBatchSummary } from "./types.js";

export function normalizePosts(params: {
  platform: DigestPlatform;
  accountId: string;
  batchId: string;
  collectedAt: string;
  posts: unknown[];
  limit: number;
  maxPages: number;
}): { candidates: DigestCandidate[]; summary: PlatformBatchSummary } {
  const candidates = params.posts.map((post) => normalizePost(params.platform, params.accountId, params.batchId, params.collectedAt, post));
  const newest = newestCursor(params.platform, candidates);
  const created = candidates.map((c) => c.created_at).filter(Boolean).sort();
  const hitLimit = params.posts.length >= params.limit;
  const hitMaxPages = params.posts.length >= params.limit * params.maxPages;
  return {
    candidates,
    summary: {
      platform: params.platform,
      account_id: params.accountId,
      fetched_count: candidates.length,
      limit: params.limit,
      max_pages: params.maxPages,
      hit_limit: hitLimit,
      hit_max_pages: hitMaxPages,
      coverage_complete: !hitMaxPages,
      oldest_created_at: created[0],
      newest_created_at: created.at(-1),
      cursor_value: newest,
      marked_seen: false,
    },
  };
}

function normalizePost(platform: DigestPlatform, accountId: string, batchId: string, collectedAt: string, post: unknown): DigestCandidate {
  const raw = isRecord(post) ? post : {};
  const text = stringValue(raw.text) ?? stringValue(raw.content) ?? "";
  const created = createdAt(platform, raw);
  const cursor = cursorValue(platform, raw, created);
  const url = stringValue(raw.url) ?? stringValue(raw.nostr_uri) ?? stringValue(raw.uri);
  const urls = arrayOfStrings(raw.urls);
  const tags = arrayOfStrings(raw.hashtags ?? raw.tags);
  return {
    schema_version: 1,
    batch_id: batchId,
    collected_at: collectedAt,
    platform,
    account_id: accountId,
    stable_key: stableKey(platform, accountId, raw),
    cursor_value: cursor,
    created_at: created,
    author: stringValue(raw.author) ?? "unknown",
    title: titleFromText(text, url ?? "Untitled social item"),
    text,
    url,
    urls: [...new Set(url ? [url, ...urls] : urls)],
    tags,
    engagement: engagement(raw),
    raw_ref: stringValue(raw.id) ?? stringValue(raw.uri) ?? stringValue(raw.nostr_uri),
  };
}

function cursorValue(platform: DigestPlatform, raw: Record<string, unknown>, created: string): string | number {
  if (platform === "mastodon") return stringValue(raw.id) ?? stringValue(raw.url) ?? created;
  if (platform === "nostr") return numberValue(raw.created_at) ?? Math.floor(new Date(created).getTime() / 1000);
  return created;
}

function createdAt(platform: DigestPlatform, raw: Record<string, unknown>): string {
  const value = raw.created_at;
  if (platform === "nostr" && typeof value === "number") return new Date(value * 1000).toISOString();
  if (typeof value === "string" && value) return value;
  return new Date().toISOString();
}

function engagement(raw: Record<string, unknown>): Record<string, number> | undefined {
  const out: Record<string, number> = {};
  for (const key of ["favourites_count", "reblogs_count", "replies_count", "likes", "repost_count", "reply_count", "quote_count"])
    if (typeof raw[key] === "number") out[key] = raw[key];
  if (isRecord(raw.engagement)) {
    for (const [key, value] of Object.entries(raw.engagement)) if (typeof value === "number") out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && Boolean(v)) : [];
}
