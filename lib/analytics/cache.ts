/**
 * Caches analytics results until a source sheet changes. Every op bumps
 * monitor_sheets.version, so the summed versions of a query's sheets are a
 * cheap, exact "has anything changed?" stamp.
 */
import { query } from "@/lib/db";
import { runAnalytics, runItemList, runScatter, type RunOptions } from "./engine";
import type { AnalyticsQuery, AnalyticsResult, Filter } from "./types";

const MAX_ENTRIES = 1000;

type Entry = { stamp: string; value: unknown; at: number };

const globalCache = globalThis as unknown as {
  __analyticsCache?: Map<string, Entry>;
  __analyticsInflight?: Map<string, Promise<unknown>>;
};

function cache(): Map<string, Entry> {
  globalCache.__analyticsCache ??= new Map();
  return globalCache.__analyticsCache;
}

function inflight(): Map<string, Promise<unknown>> {
  globalCache.__analyticsInflight ??= new Map();
  return globalCache.__analyticsInflight;
}

async function stampFor(sheetIds: string[]): Promise<string> {
  if (sheetIds.length === 0) {
    return "empty";
  }
  const rows = await query<{ v: string | null; n: string }>(
    `SELECT sum(version)::text AS v, count(*)::text AS n FROM monitor_sheets WHERE id = ANY($1::uuid[])`,
    [sheetIds],
  );
  return `${rows[0]?.v ?? 0}:${rows[0]?.n ?? 0}`;
}

/** Results that depend on who is asking (me / my team) are cached per viewer. */
function personal(filters: Filter[]): boolean {
  return filters.some((filter) => filter.op === "me" || filter.op === "my_team");
}

async function cached<T>(key: string, sheetIds: string[], compute: () => Promise<T>): Promise<T> {
  const stamp = await stampFor(sheetIds);
  const hit = cache().get(key);
  if (hit && hit.stamp === stamp) {
    // Refresh recency for LRU.
    cache().delete(key);
    cache().set(key, hit);
    return hit.value as T;
  }
  const pendingKey = `${key}#${stamp}`;
  const pending = inflight().get(pendingKey);
  if (pending) {
    return pending as Promise<T>;
  }
  const promise = compute()
    .then((value) => {
      cache().set(key, { stamp, value, at: Date.now() });
      while (cache().size > MAX_ENTRIES) {
        const oldest = cache().keys().next().value;
        if (oldest === undefined) {
          break;
        }
        cache().delete(oldest);
      }
      return value;
    })
    .finally(() => {
      inflight().delete(pendingKey);
    });
  inflight().set(pendingKey, promise);
  return promise;
}

function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

export function cachedAnalytics(input: AnalyticsQuery, options: RunOptions): Promise<AnalyticsResult> {
  const sheets = [...input.sheetIds].sort();
  const key = JSON.stringify({
    k: "agg",
    q: { ...input, sheetIds: sheets },
    d: today(),
    u: personal(input.filters) ? [options.viewerId, options.teamIds ?? []] : null,
  });
  return cached(key, sheets, () => runAnalytics({ ...input, sheetIds: sheets }, options));
}

export function cachedScatter(input: Parameters<typeof runScatter>[0]): ReturnType<typeof runScatter> {
  const sheets = [...input.sheetIds].sort();
  const key = JSON.stringify({
    k: "scatter",
    s: sheets,
    x: input.x,
    y: input.y,
    f: input.filters,
    d: today(),
    u: personal(input.filters) ? input.options.viewerId : null,
  });
  return cached(key, sheets, () => runScatter({ ...input, sheetIds: sheets }));
}

export function cachedItemList(input: Parameters<typeof runItemList>[0]): ReturnType<typeof runItemList> {
  const sheets = [...input.sheetIds].sort();
  const key = JSON.stringify({
    k: "list",
    s: sheets,
    f: input.filters,
    l: input.limit,
    d: today(),
    u: personal(input.filters) ? input.options.viewerId : null,
  });
  return cached(key, sheets, () => runItemList({ ...input, sheetIds: sheets }));
}
