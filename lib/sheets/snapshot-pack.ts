/**
 * Compact wire format for snapshot rows (client-safe). A 100k-row tab is ~65 MB as
 * objects because every row repeats each column id; as tuples it is a fraction of that.
 */
import type { JsonValue } from "./ops";

export interface UnpackedRow {
  id: string;
  position: string;
  data: Record<string, JsonValue>;
  groupId: string | null;
  itemNumber: number;
  createdBy: string | null;
  createdAt: string;
  updatedBy: string | null;
  updatedAt: string;
}

export interface PackedRows {
  v: 1;
  /** Data keys, indexed by position in each tuple after the fixed fields. */
  keys: string[];
  /** Repeated ids (groups and users), referenced by index; -1 = null. */
  refs: string[];
  /** [id, position, group, itemNumber, createdBy, createdAtMs, updatedBy, updatedAtMs, ...values] */
  rows: JsonValue[][];
}

const FIXED = 8;

export function packRows(rows: UnpackedRow[]): PackedRows {
  const keys: string[] = [];
  const keyIndex = new Map<string, number>();
  const refs: string[] = [];
  const refIndex = new Map<string, number>();
  const ref = (value: string | null) => {
    if (value === null) {
      return -1;
    }
    let index = refIndex.get(value);
    if (index === undefined) {
      index = refs.length;
      refs.push(value);
      refIndex.set(value, index);
    }
    return index;
  };
  for (const row of rows) {
    for (const key of Object.keys(row.data)) {
      if (!keyIndex.has(key)) {
        keyIndex.set(key, keys.length);
        keys.push(key);
      }
    }
  }
  return {
    v: 1,
    keys,
    refs,
    rows: rows.map((row) => {
      const tuple: JsonValue[] = [
        row.id,
        row.position,
        ref(row.groupId),
        row.itemNumber,
        ref(row.createdBy),
        Date.parse(row.createdAt),
        ref(row.updatedBy),
        Date.parse(row.updatedAt),
      ];
      let last = FIXED - 1;
      for (const [key, value] of Object.entries(row.data)) {
        const at = FIXED + keyIndex.get(key)!;
        tuple[at] = value;
        last = Math.max(last, at);
      }
      // Holes become null in JSON; unpack treats null as "no value".
      tuple.length = last + 1;
      return tuple;
    }),
  };
}

export function unpackRows(packed: PackedRows): UnpackedRow[] {
  const deref = (index: unknown) => (typeof index === "number" && index >= 0 ? (packed.refs[index] ?? null) : null);
  const iso = (ms: unknown) => (typeof ms === "number" && Number.isFinite(ms) ? new Date(ms).toISOString() : "");
  const out: UnpackedRow[] = [];
  for (const tuple of packed.rows) {
    if (!Array.isArray(tuple) || typeof tuple[0] !== "string" || typeof tuple[1] !== "string") {
      continue;
    }
    const data: Record<string, JsonValue> = {};
    for (let at = FIXED; at < tuple.length; at += 1) {
      const value = tuple[at];
      if (value !== null && value !== undefined) {
        data[packed.keys[at - FIXED]!] = value;
      }
    }
    out.push({
      id: tuple[0],
      position: tuple[1],
      groupId: deref(tuple[2]),
      itemNumber: typeof tuple[3] === "number" ? tuple[3] : 0,
      createdBy: deref(tuple[4]),
      createdAt: iso(tuple[5]),
      updatedBy: deref(tuple[6]),
      updatedAt: iso(tuple[7]),
      data,
    });
  }
  return out;
}
