import { Redis } from "@upstash/redis";

/** 14 days in seconds — Redis TTL handles retention; no cron needed. */
const TTL_SECONDS = 14 * 24 * 60 * 60; // 1_209_600

const KEY_PREFIX = "company:";

/** Extractor placeholders that must never collide across failed extractions. */
const DENYLIST = new Set(["unknown company", "unknown", "n/a", "na", "none"]);

/** Trailing legal-entity words stripped (up to two) so "Google, LLC." ≡ "Google". */
const LEGAL_SUFFIXES = new Set([
  "inc",
  "llc",
  "ltd",
  "corp",
  "co",
  "company",
  "plc",
  "gmbh",
  "group",
  "holdings",
]);

let redis: Redis | null | undefined;

function getRedis(): Redis | null {
  if (redis !== undefined) return redis;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    redis = null;
    return null;
  }

  try {
    redis = Redis.fromEnv();
  } catch (err) {
    console.warn("[company-dedupe] Failed to init Redis client:", err);
    redis = null;
  }
  return redis;
}

/**
 * Normalize a company name for Redis keying:
 * lowercase, strip punctuation, drop up to two trailing legal-entity words.
 * Returns null for empty / denylisted names (skip dedupe entirely).
 */
export function normalizeCompanyKey(company: string): string | null {
  let key = company
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!key || DENYLIST.has(key)) return null;

  const parts = key.split(" ");
  let stripped = 0;
  while (parts.length > 1 && stripped < 2) {
    const last = parts[parts.length - 1]!;
    if (!LEGAL_SUFFIXES.has(last)) break;
    parts.pop();
    stripped += 1;
  }

  key = parts.join(" ").trim();
  if (!key || DENYLIST.has(key)) return null;
  return key;
}

function redisKey(normalized: string): string {
  return `${KEY_PREFIX}${normalized}`;
}

export type DuplicateHit = {
  company: string;
  normalizedKey: string;
  /** ISO timestamp when the prior package was recorded, if available. */
  previouslyAt?: string;
};

/**
 * Returns a hit if this company was tailored within the TTL window.
 * Fails open: missing env / Redis errors → treat as not duplicate.
 */
export async function checkDuplicateCompany(
  company: string,
): Promise<DuplicateHit | null> {
  const normalized = normalizeCompanyKey(company);
  if (!normalized) return null;

  const client = getRedis();
  if (!client) return null;

  try {
    const existing = await client.get<string>(redisKey(normalized));
    if (existing == null) return null;
    return {
      company,
      normalizedKey: normalized,
      previouslyAt: typeof existing === "string" ? existing : undefined,
    };
  } catch (err) {
    console.warn("[company-dedupe] check failed (failing open):", err);
    return null;
  }
}

/**
 * Record a successful tailor for this company (SET NX + EX).
 * Only call after a package is successfully generated.
 * Fails open on errors.
 */
export async function recordCompany(company: string): Promise<void> {
  const normalized = normalizeCompanyKey(company);
  if (!normalized) return;

  const client = getRedis();
  if (!client) return;

  try {
    await client.set(redisKey(normalized), new Date().toISOString(), {
      nx: true,
      ex: TTL_SECONDS,
    });
  } catch (err) {
    console.warn("[company-dedupe] record failed (failing open):", err);
  }
}
