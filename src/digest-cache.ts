import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

import type { CollectionBatch, DigestCandidate, DigestPlatform, PlatformBatchSummary } from "./types.js";

const DEFAULT_STATE_DIR = join(homedir(), ".local", "state", "HermesSocialSummerizer", "social-digest");

export type StatePaths = {
  root: string;
  batches: string;
  candidates: string;
  briefings: string;
  locks: string;
};

export function resolveStateDir(env = process.env): string {
  return env.SOCIAL_DIGEST_STATE_DIR?.trim() || DEFAULT_STATE_DIR;
}

export function statePaths(root = resolveStateDir()): StatePaths {
  return {
    root,
    batches: join(root, "batches"),
    candidates: join(root, "candidates"),
    briefings: join(root, "briefings"),
    locks: join(root, "locks"),
  };
}

export async function ensureStateDirs(root = resolveStateDir()): Promise<StatePaths> {
  const paths = statePaths(root);
  await Promise.all(Object.values(paths).map((p) => mkdir(p, { recursive: true })));
  return paths;
}

export function dateKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function batchId(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

export function stableKey(platform: DigestPlatform, accountId: string, raw: Record<string, unknown>): string {
  const id = firstString(raw.id, raw.uri, raw.nostr_uri, raw.url, raw.raw_ref) ?? JSON.stringify(raw).slice(0, 200);
  return `${platform}:${accountId}:${id}`;
}

export function titleFromText(text: string, fallback = "Untitled social item"): string {
  const firstLine = text.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
  if (!firstLine) return fallback;
  return firstLine.length > 120 ? `${firstLine.slice(0, 117)}…` : firstLine;
}

export function isoFromCursor(platform: DigestPlatform, cursor: string | number): string {
  if (platform === "nostr" && typeof cursor === "number") return new Date(cursor * 1000).toISOString();
  return String(cursor);
}

export function dedupeCandidates(candidates: DigestCandidate[]): DigestCandidate[] {
  const seen = new Set<string>();
  const out: DigestCandidate[] = [];
  for (const candidate of candidates) {
    const urlKey = candidate.urls.find(Boolean) ?? candidate.url;
    const key = urlKey ? `url:${canonicalUrl(urlKey)}` : `stable:${candidate.stable_key}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(candidate);
  }
  return out;
}

export function newestCursor(platform: DigestPlatform, candidates: DigestCandidate[]): string | number | undefined {
  if (candidates.length === 0) return undefined;
  if (platform === "mastodon") {
    return candidates
      .map((c) => String(c.cursor_value))
      .sort((a, b) => {
        try { return Number(BigInt(b) - BigInt(a)); } catch { return b.localeCompare(a); }
      })[0];
  }
  if (platform === "nostr") return Math.max(...candidates.map((c) => Number(c.cursor_value)).filter(Number.isFinite));
  return candidates.map((c) => String(c.cursor_value)).sort().at(-1);
}

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tmp, path);
}

export async function appendJsonlAtomic(path: string, rows: unknown[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const existing = existsSync(path) ? await readFile(path, "utf8") : "";
  const suffix = rows.map((row) => JSON.stringify(row)).join("\n");
  const next = suffix ? `${existing}${existing && !existing.endsWith("\n") ? "\n" : ""}${suffix}\n` : existing;
  const tmp = `${path}.tmp-${process.pid}`;
  await writeFile(tmp, next, "utf8");
  await rename(tmp, path);
}

export async function writeBatch(batch: CollectionBatch, root = resolveStateDir()): Promise<void> {
  const paths = await ensureStateDirs(root);
  await writeJsonAtomic(join(paths.batches, `${batch.batch_id}.collect.json`), batch);
  if (batch.candidates.length > 0) {
    const candidatePath = join(paths.candidates, `${dateKey(new Date(batch.collected_at))}.jsonl`);
    const existing = existsSync(candidatePath) ? await readFile(candidatePath, "utf8") : "";
    // A collection run writes the batch once before mark_seen and again after
    // updating marked_seen flags. Only the first write should append candidates;
    // the second write should update the batch summary JSON without duplicating
    // JSONL candidate rows.
    if (!existing.includes(`"batch_id":"${batch.batch_id}"`)) {
      await appendJsonlAtomic(candidatePath, batch.candidates);
    }
  }
}

export async function readCandidatesSince(since: Date, root = resolveStateDir()): Promise<DigestCandidate[]> {
  const paths = await ensureStateDirs(root);
  const names = await readdir(paths.candidates).catch(() => [] as string[]);
  const out: DigestCandidate[] = [];
  for (const name of names.filter((n) => n.endsWith(".jsonl")).sort()) {
    const content = await readFile(join(paths.candidates, name), "utf8").catch(() => "");
    for (const line of content.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const candidate = JSON.parse(line) as DigestCandidate;
      if (new Date(candidate.created_at) >= since) out.push(candidate);
    }
  }
  return out.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function latestSuccessfulSummary(root = resolveStateDir()): Promise<PlatformBatchSummary[] | undefined> {
  const paths = await ensureStateDirs(root);
  const names = (await readdir(paths.batches).catch(() => [] as string[]))
    .filter((n) => n.endsWith(".collect.json"))
    .sort()
    .reverse();
  for (const name of names) {
    const batch = JSON.parse(await readFile(join(paths.batches, name), "utf8")) as CollectionBatch;
    const successful = batch.summaries.filter((s) => !s.error && s.fetched_count > 0);
    if (successful.length > 0) return successful;
  }
  return undefined;
}

export function previousRunHitLimit(summaries: PlatformBatchSummary[] | undefined): boolean {
  return Boolean(summaries?.some((s) => s.hit_limit || s.hit_max_pages || !s.coverage_complete));
}

export async function pruneOlderThan(days: number, root = resolveStateDir(), now = new Date()): Promise<string[]> {
  const paths = await ensureStateDirs(root);
  const cutoff = now.getTime() - days * 24 * 60 * 60 * 1000;
  const removed: string[] = [];
  for (const dir of [paths.batches, paths.candidates, paths.briefings]) {
    for (const name of await readdir(dir).catch(() => [] as string[])) {
      const path = join(dir, name);
      const info = await stat(path).catch(() => undefined);
      if (info && info.mtime.getTime() < cutoff) {
        await unlink(path);
        removed.push(path);
      }
    }
  }
  return removed;
}

function canonicalUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.toString();
  } catch {
    return url;
  }
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) if (typeof value === "string" && value) return value;
  return undefined;
}
