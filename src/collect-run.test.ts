import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { accountIds, fetchPlatform, limitsFor, runCollection } from "./collect-run.js";
import { readCursors } from "./digest-cache.js";
import type { McpToolClient } from "./mcp-client.js";

type RecordedCall = { name: string; args: Record<string, unknown> };

// A stub satisfying McpToolClient's trivial callTool(name, args) interface -
// no live MCP connection needed, exactly the gap this file closes (see
// genebean/HermesSocialDigestPipeline#23's accompanying PR description).
function stubClient(responses: Record<string, unknown[]>, calls: RecordedCall[] = []): McpToolClient {
  return {
    async callTool(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      return responses[name] ?? [];
    },
    async close() {},
  };
}

const limits = limitsFor(36);

test("accountIds parses list_accounts' grouped shape, ignoring malformed entries", () => {
  const result = accountIds({
    mastodon: [{ id: "main" }, { id: "work" }],
    bluesky: [{ id: "personal" }],
    nostr: "not-an-array",
  });
  assert.deepEqual(
    result.find((r) => r.platform === "mastodon")?.ids,
    ["main", "work"]
  );
  assert.deepEqual(
    result.find((r) => r.platform === "bluesky")?.ids,
    ["personal"]
  );
  assert.deepEqual(
    result.find((r) => r.platform === "nostr")?.ids,
    []
  );
});

test("fetchPlatform sends since_id for mastodon, since for bluesky, since_ts for nostr - and nothing when omitted", async () => {
  const calls: RecordedCall[] = [];
  const client = stubClient({}, calls);

  await fetchPlatform(client, "mastodon", "main", limits, {});
  await fetchPlatform(client, "mastodon", "main", limits, { since_id: "42" });
  await fetchPlatform(client, "bluesky", "main", limits, { since: "2026-06-24T00:00:00Z" });
  await fetchPlatform(client, "nostr", "main", limits, { since_ts: 1750000000 });

  assert.equal("since_id" in calls[0].args, false, "no since_id when omitted");
  assert.equal(calls[1].args.since_id, "42");
  assert.equal(calls[2].args.since, "2026-06-24T00:00:00Z");
  assert.equal(calls[3].args.since_ts, 1750000000);
});

test("fetchPlatform never sends advance_cursor - that parameter no longer exists on the MCP side", async () => {
  const calls: RecordedCall[] = [];
  const client = stubClient({}, calls);
  await fetchPlatform(client, "mastodon", "main", limits, {});
  assert.equal("advance_cursor" in calls[0].args, false);
});

test("runCollection: first-ever run has no stored cursor, so fetches with nothing, then persists one for next time", async () => {
  const root = await mkdtemp(join(tmpdir(), "hsdp-collect-"));
  try {
    const calls: RecordedCall[] = [];
    const client: McpToolClient = {
      async callTool(name, args) {
        if (name === "list_accounts") return { mastodon: [{ id: "main" }], bluesky: [], nostr: [] };
        if (name === "mastodon_home_timeline") {
          calls.push({ name, args });
          return [{ id: "100", author: "a", text: "t", created_at: "2026-06-24T00:00:00.000Z" }];
        }
        return [];
      },
      async close() {},
    };

    const { batch } = await runCollection(client, { dryRun: false, pruneDays: 0, maxLookbackHours: 36, stateRoot: root });

    const firstFetchCall = calls.find((c) => c.name === "mastodon_home_timeline");
    assert.ok(firstFetchCall, "expected a mastodon_home_timeline call");
    assert.equal("since_id" in firstFetchCall!.args, false, "no persisted cursor yet on the first run");

    const summary = batch.summaries.find((s) => s.platform === "mastodon");
    assert.equal(summary?.cursor_written, true);

    const cursors = await readCursors(root);
    assert.equal(cursors.mastodon?.main?.since_id, "100");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runCollection: a second run passes the previously-persisted cursor as since_id", async () => {
  const root = await mkdtemp(join(tmpdir(), "hsdp-collect-"));
  try {
    const calls: RecordedCall[] = [];
    // effectiveSince's lookback floor checks against the real current
    // time - a hardcoded old fixture date would look stale and get
    // dropped, same as a genuinely stale cursor should. Use "now" so this
    // test exercises the within-the-floor path, not the floor itself
    // (that's effectiveSince's own tests, in digest-cache.test.ts).
    const recentCreatedAt = new Date().toISOString();
    function clientFor(postId: string): McpToolClient {
      return {
        async callTool(name, args) {
          if (name === "list_accounts") return { mastodon: [{ id: "main" }], bluesky: [], nostr: [] };
          if (name === "mastodon_home_timeline") {
            calls.push({ name, args });
            return [{ id: postId, author: "a", text: "t", created_at: recentCreatedAt }];
          }
          return [];
        },
        async close() {},
      };
    }

    await runCollection(clientFor("100"), { dryRun: false, pruneDays: 0, maxLookbackHours: 36, stateRoot: root });
    await runCollection(clientFor("101"), { dryRun: false, pruneDays: 0, maxLookbackHours: 36, stateRoot: root });

    const secondCall = calls[1];
    assert.equal(secondCall.args.since_id, "100", "second run should fetch using the first run's persisted cursor");

    const cursors = await readCursors(root);
    assert.equal(cursors.mastodon?.main?.since_id, "101", "cursor should have advanced to the second run's result");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runCollection: dry-run never writes a cursor", async () => {
  const root = await mkdtemp(join(tmpdir(), "hsdp-collect-"));
  try {
    const client: McpToolClient = {
      async callTool(name) {
        if (name === "list_accounts") return { mastodon: [{ id: "main" }], bluesky: [], nostr: [] };
        if (name === "mastodon_home_timeline") return [{ id: "100", author: "a", text: "t", created_at: "2026-06-24T00:00:00.000Z" }];
        return [];
      },
      async close() {},
    };

    await runCollection(client, { dryRun: true, pruneDays: 0, maxLookbackHours: 36, stateRoot: root });

    const cursors = await readCursors(root);
    assert.deepEqual(cursors, {});
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runCollection: a per-account fetch error doesn't stop other accounts, and is recorded on that summary", async () => {
  const root = await mkdtemp(join(tmpdir(), "hsdp-collect-"));
  try {
    const client: McpToolClient = {
      async callTool(name, args) {
        if (name === "list_accounts") return { mastodon: [{ id: "broken" }, { id: "fine" }], bluesky: [], nostr: [] };
        if (name === "mastodon_home_timeline" && args.account_id === "broken") throw new Error("upstream 500");
        if (name === "mastodon_home_timeline") return [{ id: "1", author: "a", text: "t", created_at: "2026-06-24T00:00:00.000Z" }];
        return [];
      },
      async close() {},
    };

    const { batch } = await runCollection(client, { dryRun: false, pruneDays: 0, maxLookbackHours: 36, stateRoot: root });

    const broken = batch.summaries.find((s) => s.account_id === "broken");
    const fine = batch.summaries.find((s) => s.account_id === "fine");
    assert.equal(broken?.error, "upstream 500");
    assert.equal(fine?.cursor_written, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
