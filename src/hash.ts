import { createHash } from 'node:crypto';

export const GENESIS = '0'.repeat(64);

export function canon(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map(k => `${JSON.stringify(k)}:${canon(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

export interface EntryFields {
  seq: number; id: string; ts: string; actor: string;
  action: string; resource: string; payload: unknown; prevHash: string;
}

export const computeHash = (e: EntryFields) =>
  createHash('sha256')
    .update(canon([e.seq, e.id, e.ts, e.actor, e.action, e.resource, e.payload, e.prevHash]))
    .digest('hex');

export function recomputeHash(row: {
  seq: number; id: string; ts: string; actor: string;
  action: string; resource: string; payload: unknown; prev_hash: string;
}): string {
  return computeHash({
    seq: row.seq, id: row.id, ts: row.ts, actor: row.actor,
    action: row.action, resource: row.resource, payload: row.payload,
    prevHash: row.prev_hash,
  })
}
