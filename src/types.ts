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
  cursor_value?: string | number;
  marked_seen: boolean;
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
