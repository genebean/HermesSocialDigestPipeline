import { chmod, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

import type { CollectionBatch, DigestCandidate, DigestPlatform, PlatformBatchSummary } from "./types.js";

const DEFAULT_STATE_DIR = join(homedir(), ".local", "state", "HermesSocialSummerizer", "social-digest");
const PRIVATE_DIR_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;

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
  for (const path of Object.values(paths)) {
    await mkdir(path, { recursive: true, mode: PRIVATE_DIR_MODE });
    await chmod(path, PRIVATE_DIR_MODE).catch(() => undefined);
  }
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
  await mkdir(dirname(path), { recursive: true, mode: PRIVATE_DIR_MODE });
  const tmp = `${path}.tmp-${process.pid}`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: PRIVATE_FILE_MODE });
  await rename(tmp, path);
  await chmod(path, PRIVATE_FILE_MODE).catch(() => undefined);
}

export async function writeJsonlAtomic(path: string, rows: unknown[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: PRIVATE_DIR_MODE });
  await chmod(dirname(path), PRIVATE_DIR_MODE).catch(() => undefined);
  const content = rows.map((row) => JSON.stringify(row)).join("\n");
  const tmp = `${path}.tmp-${process.pid}`;
  await writeFile(tmp, content ? `${content}\n` : "", { encoding: "utf8", mode: PRIVATE_FILE_MODE });
  await rename(tmp, path);
  await chmod(path, PRIVATE_FILE_MODE).catch(() => undefined);
}

export async function writeBatch(batch: CollectionBatch, root = resolveStateDir()): Promise<void> {
  const paths = await ensureStateDirs(root);
  await writeJsonAtomic(join(paths.batches, `${batch.batch_id}.collect.json`), batch);
  if (batch.candidates.length > 0) {
    const dayDir = join(paths.candidates, dateKey(new Date(batch.collected_at)));
    await writeJsonlAtomic(join(dayDir, `${batch.batch_id}.jsonl`), batch.candidates);
  }
}

export async function readCandidatesSince(since: Date, root = resolveStateDir()): Promise<DigestCandidate[]> {
  const paths = await ensureStateDirs(root);
  const out: DigestCandidate[] = [];
  const sinceDay = dateKey(since);

  for (const entry of await readdir(paths.candidates, { withFileTypes: true }).catch(() => [])) {
    if (entry.isDirectory()) {
      if (entry.name < sinceDay) continue;
      await readCandidateFiles(join(paths.candidates, entry.name), since, out);
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      // Backward-compatible support for the original flat daily JSONL layout.
      if (entry.name.slice(0, 10) < sinceDay) continue;
      await readCandidateFile(join(paths.candidates, entry.name), since, out);
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
  if (days <= 0) return [];

  const paths = await ensureStateDirs(root);
  const cutoff = now.getTime() - days * 24 * 60 * 60 * 1000;
  const removed: string[] = [];
  for (const dir of [paths.batches, paths.candidates, paths.briefings]) {
    await pruneDirectory(dir, cutoff, removed);
  }
  return removed;
}

async function readCandidateFiles(dir: string, since: Date, out: DigestCandidate[]): Promise<void> {
  const names = await readdir(dir).catch(() => [] as string[]);
  for (const name of names.filter((n) => n.endsWith(".jsonl")).sort()) {
    await readCandidateFile(join(dir, name), since, out);
  }
}

async function readCandidateFile(path: string, since: Date, out: DigestCandidate[]): Promise<void> {
  const content = await readFile(path, "utf8").catch(() => "");
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const candidate = JSON.parse(line) as DigestCandidate;
    if (new Date(candidate.created_at) >= since) out.push(candidate);
  }
}

async function pruneDirectory(dir: string, cutoff: number, removed: string[]): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await pruneDirectory(path, cutoff, removed);
      const remaining = await readdir(path).catch(() => [] as string[]);
      if (remaining.length === 0) await unlinkOrRmdir(path, removed);
      continue;
    }

    const info = await stat(path).catch(() => undefined);
    if (info && info.mtime.getTime() < cutoff) await unlinkOrRmdir(path, removed);
  }
}

async function unlinkOrRmdir(path: string, removed: string[]): Promise<void> {
  const info = await stat(path).catch(() => undefined);
  if (!info) return;
  if (info.isDirectory()) {
    const { rmdir } = await import("node:fs/promises");
    await rmdir(path);
  } else {
    await unlink(path);
  }
  removed.push(path);
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
