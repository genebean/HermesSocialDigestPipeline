import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  appendJsonlAtomic,
  dedupeCandidates,
  ensureStateDirs,
  latestSuccessfulSummary,
  newestCursor,
  previousRunHitLimit,
  readCandidatesSince,
  stableKey,
  writeBatch,
} from "./digest-cache.js";
import type { CollectionBatch, DigestCandidate } from "./types.js";

function candidate(overrides: Partial<DigestCandidate> = {}): DigestCandidate {
  return {
    schema_version: 1,
    batch_id: "batch",
    collected_at: "2026-06-24T00:00:00.000Z",
    platform: "mastodon",
    account_id: "main",
    stable_key: "mastodon:main:1",
    cursor_value: "1",
    created_at: "2026-06-24T00:00:00.000Z",
    author: "author",
    title: "title",
    text: "text",
    urls: [],
    tags: [],
    ...overrides,
  };
}

test("stableKey uses platform, account, and source id", () => {
  assert.equal(stableKey("bluesky", "personal", { uri: "at://example" }), "bluesky:personal:at://example");
});

test("dedupeCandidates prefers canonical URL over per-platform ids", () => {
  const input = [
    candidate({ stable_key: "mastodon:main:1", urls: ["https://example.test/a#frag"] }),
    candidate({ stable_key: "bluesky:main:2", platform: "bluesky", urls: ["https://example.test/a"] }),
  ];
  assert.equal(dedupeCandidates(input).length, 1);
});

test("newestCursor handles platform cursor shapes", () => {
  assert.equal(newestCursor("mastodon", [candidate({ cursor_value: "9" }), candidate({ cursor_value: "10" })]), "10");
  assert.equal(newestCursor("bluesky", [candidate({ platform: "bluesky", cursor_value: "2026-01-01T00:00:00Z" }), candidate({ platform: "bluesky", cursor_value: "2026-01-02T00:00:00Z" })]), "2026-01-02T00:00:00Z");
  assert.equal(newestCursor("nostr", [candidate({ platform: "nostr", cursor_value: 10 }), candidate({ platform: "nostr", cursor_value: 12 })]), 12);
});

test("writeBatch and readCandidatesSince persist JSONL candidates", async () => {
  const root = await mkdtemp(join(tmpdir(), "hsdp-"));
  try {
    const batch: CollectionBatch = {
      schema_version: 1,
      batch_id: "2026-06-24T00-00-00-000Z",
      collected_at: "2026-06-24T00:00:00.000Z",
      dry_run: false,
      summaries: [],
      candidates: [candidate()],
    };
    await writeBatch(batch, root);
    const rows = await readCandidatesSince(new Date("2026-06-23T00:00:00Z"), root);
    assert.equal(rows.length, 1);
    const jsonl = await readFile(join(root, "candidates", "2026-06-24.jsonl"), "utf8");
    assert.match(jsonl, /mastodon:main:1/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("previousRunHitLimit detects cap-hit summaries", async () => {
  assert.equal(previousRunHitLimit(undefined), false);
  assert.equal(previousRunHitLimit([{ platform: "mastodon", account_id: "main", fetched_count: 1, limit: 40, max_pages: 1, hit_limit: true, hit_max_pages: false, coverage_complete: false, marked_seen: true }]), true);
});

test("latestSuccessfulSummary returns newest batch with fetched posts", async () => {
  const root = await mkdtemp(join(tmpdir(), "hsdp-"));
  try {
    await ensureStateDirs(root);
    await writeBatch({
      schema_version: 1,
      batch_id: "2026-06-24T00-00-00-000Z",
      collected_at: "2026-06-24T00:00:00.000Z",
      dry_run: false,
      summaries: [{ platform: "mastodon", account_id: "main", fetched_count: 1, limit: 40, max_pages: 1, hit_limit: false, hit_max_pages: false, coverage_complete: true, marked_seen: true }],
      candidates: [],
    }, root);
    const summaries = await latestSuccessfulSummary(root);
    assert.equal(summaries?.[0]?.platform, "mastodon");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
