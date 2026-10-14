import assert from "node:assert/strict";
import test from "node:test";

import { normalizePosts } from "./normalize.js";

const baseParams = {
  platform: "nostr" as const,
  accountId: "main",
  batchId: "batch",
  collectedAt: "2026-10-13T00:00:00.000Z",
  limit: 100,
  maxPages: 2,
};

test("preserves reply_to_id and root_id for a nostr reply", () => {
  const { candidates } = normalizePosts({
    ...baseParams,
    posts: [
      {
        id: "event-reply",
        author: "npub1reply",
        text: "here's the source",
        created_at: 1760313600,
        reply_to_id: "event-parent",
        root_id: "event-root",
      },
    ],
  });
  assert.equal(candidates[0].reply_to_id, "event-parent");
  assert.equal(candidates[0].root_id, "event-root");
});

test("omits reply_to_id/root_id for a standalone nostr note", () => {
  const { candidates } = normalizePosts({
    ...baseParams,
    posts: [{ id: "event-standalone", author: "npub1standalone", text: "no thread", created_at: 1760313600 }],
  });
  assert.equal(candidates[0].reply_to_id, undefined);
  assert.equal(candidates[0].root_id, undefined);
});

test("capped run advances the cursor to the oldest item fetched, not the newest", () => {
  // limit * maxPages = 2, and this run returns exactly 2 posts -> capped
  // (hit_max_pages). genebean/HermesSocialDigestPipeline#23: advancing to
  // the newest fetched item here would silently skip everything older
  // than the oldest item below but newer than wherever collection
  // actually left off before this run.
  const { summary } = normalizePosts({
    ...baseParams,
    limit: 2,
    maxPages: 1,
    posts: [
      { id: "newer", author: "a", text: "t", created_at: 2000 },
      { id: "older", author: "a", text: "t", created_at: 1000 },
    ],
  });
  assert.equal(summary.hit_max_pages, true);
  assert.equal(summary.coverage_complete, false);
  assert.equal(summary.cursor_value, 1000, "should advance to the OLDEST fetched item's cursor when capped");
  assert.equal(summary.cursor_created_at, new Date(1000 * 1000).toISOString());
});

test("complete run advances the cursor to the newest item fetched", () => {
  // limit * maxPages = 10, this run returns only 2 -> not capped.
  const { summary } = normalizePosts({
    ...baseParams,
    limit: 5,
    maxPages: 2,
    posts: [
      { id: "newer", author: "a", text: "t", created_at: 2000 },
      { id: "older", author: "a", text: "t", created_at: 1000 },
    ],
  });
  assert.equal(summary.hit_max_pages, false);
  assert.equal(summary.coverage_complete, true);
  assert.equal(summary.cursor_value, 2000, "should advance to the NEWEST fetched item's cursor when coverage is complete");
  assert.equal(summary.cursor_created_at, new Date(2000 * 1000).toISOString());
});

test("never sets reply_to_id/root_id for non-nostr platforms, even if present in the raw payload", () => {
  const { candidates } = normalizePosts({
    ...baseParams,
    platform: "mastodon",
    posts: [
      {
        id: "1",
        author: "author",
        text: "text",
        created_at: "2026-10-13T00:00:00.000Z",
        // A mastodon post has no NIP-10 concept - these fields shouldn't
        // exist in real Mastodon API responses, but prove the platform
        // guard actually gates on `platform`, not just field presence.
        reply_to_id: "should-be-ignored",
        root_id: "should-be-ignored",
      },
    ],
  });
  assert.equal(candidates[0].reply_to_id, undefined);
  assert.equal(candidates[0].root_id, undefined);
});
