import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  dedupeCandidates,
  ensureStateDirs,
  latestSuccessfulSummary,
  newestCursor,
  previousRunHitLimit,
  pruneOlderThan,
  readCandidatesSince,
  stableKey,
  statePaths,
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

function batch(overrides: Partial<CollectionBatch> = {}): CollectionBatch {
  return {
    schema_version: 1,
    batch_id: "2026-06-24T00-00-00-000Z",
    collected_at: "2026-06-24T00:00:00.000Z",
    dry_run: false,
    summaries: [],
    candidates: [candidate()],
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

test("writeBatch and readCandidatesSince persist per-batch JSONL candidates with private permissions", async () => {
  const root = await mkdtemp(join(tmpdir(), "hsdp-"));
  try {
    const item = batch();
    await writeBatch(item, root);
    await writeBatch({ ...item, summaries: [{ platform: "mastodon", account_id: "main", fetched_count: 1, limit: 40, max_pages: 3, hit_limit: false, hit_max_pages: false, coverage_complete: true, marked_seen: true }] }, root);

    const rows = await readCandidatesSince(new Date("2026-06-23T00:00:00Z"), root);
    assert.equal(rows.length, 1);

    const jsonlPath = join(root, "candidates", "2026-06-24", "2026-06-24T00-00-00-000Z.jsonl");
    const jsonl = await readFile(jsonlPath, "utf8");
    assert.match(jsonl, /mastodon:main:1/);
    assert.equal((await stat(root)).mode & 0o777, 0o700);
    assert.equal((await stat(jsonlPath)).mode & 0o777, 0o600);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("readCandidatesSince skips date buckets older than the requested window", async () => {
  const root = await mkdtemp(join(tmpdir(), "hsdp-"));
  try {
    await writeBatch(batch({ batch_id: "2026-06-22T00-00-00-000Z", collected_at: "2026-06-22T00:00:00.000Z", candidates: [candidate({ created_at: "2026-06-22T00:00:00.000Z" })] }), root);
    await writeBatch(batch({ batch_id: "2026-06-24T00-00-00-000Z", collected_at: "2026-06-24T00:00:00.000Z", candidates: [candidate({ created_at: "2026-06-24T00:00:00.000Z" })] }), root);
    const rows = await readCandidatesSince(new Date("2026-06-23T00:00:00Z"), root);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].created_at, "2026-06-24T00:00:00.000Z");
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
    await writeBatch(batch({
      candidates: [],
      summaries: [{ platform: "mastodon", account_id: "main", fetched_count: 1, limit: 40, max_pages: 1, hit_limit: false, hit_max_pages: false, coverage_complete: true, marked_seen: true }],
    }), root);
    const summaries = await latestSuccessfulSummary(root);
    assert.equal(summaries?.[0]?.platform, "mastodon");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("pruneOlderThan removes stale state files", async () => {
  const root = await mkdtemp(join(tmpdir(), "hsdp-"));
  try {
    const paths = await ensureStateDirs(root);
    const oldFile = join(paths.briefings, "old.json");
    await writeFile(oldFile, "{}", "utf8");
    await pruneOlderThan(1, root, new Date(Date.now() + 3 * 24 * 60 * 60 * 1000));
    await assert.rejects(() => stat(oldFile));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("statePaths uses caller-provided root", () => {
  assert.equal(statePaths("/tmp/example").candidates, "/tmp/example/candidates");
});
