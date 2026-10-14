export type DigestPlatform = "mastodon" | "bluesky" | "nostr";

export type DigestCandidate = {
  schema_version: 1;
  batch_id: string;
  collected_at: string;
  platform: DigestPlatform;
  account_id: string;
  stable_key: string;
  cursor_value: string | number;
  created_at: string;
  author: string;
  title: string;
  text: string;
  url?: string;
  urls: string[];
  tags: string[];
  engagement?: Record<string, number>;
  // Reply reference, normalized across platforms by threadIds() in
  // normalize.ts - each platform's own MCP tool result names this
  // differently (Nostr's NIP-10 markers, Mastodon's in_reply_to_id,
  // Bluesky's reply.{parent,root}). reply_to_id is the direct parent,
  // root_id is the thread root where the platform has one - Mastodon has
  // no separate root concept, so root_id never gets set there.
  reply_to_id?: string;
  root_id?: string;
  raw_ref?: string;
};

export type PlatformBatchSummary = {
  platform: DigestPlatform;
  account_id: string;
  fetched_count: number;
  limit: number;
  max_pages: number;
  pages_fetched?: number;
  hit_limit: boolean;
  hit_max_pages: boolean;
  coverage_complete: boolean;
  oldest_created_at?: string;
  newest_created_at?: string;
  // The position to persist as this platform/account's next collection
  // starting point - the oldest item actually fetched when this run was
  // capped (hit_max_pages), the newest when coverage was complete. See
  // normalizePosts() in normalize.ts for why this isn't always "newest".
  cursor_value?: string | number;
  cursor_created_at?: string;
  cursor_written: boolean;
  cursor_write_error?: string;
  error?: string;
};

export type CollectionBatch = {
  schema_version: 1;
  batch_id: string;
  collected_at: string;
  dry_run: boolean;
  summaries: PlatformBatchSummary[];
  candidates: DigestCandidate[];
};
