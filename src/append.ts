import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { GENESIS, computeHash, computeHmac } from './hash.js';

export async function appendEvent(
  pool: Pool,
  ev: { actor: string; action: string; resource: string; payload: unknown },
  hmacSecret: string,
) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(42)');
    const { rows } = await client.query(
      'SELECT seq, hash FROM audit_log ORDER BY seq DESC LIMIT 1',
    );
    const seq = rows[0] ? Number(rows[0].seq) + 1 : 1;
    const prevHash = rows[0]?.hash ?? GENESIS;
    const entry = {
      seq, id: randomUUID(), ts: new Date().toISOString(),
      ...ev, prevHash,
    };
    const hash = computeHash(entry);
    const hmac = computeHmac(hmacSecret, { ...entry, hash });
    await client.query(
      `INSERT INTO audit_log (seq,id,ts,actor,action,resource,payload,prev_hash,hash,hmac)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [seq, entry.id, entry.ts, ev.actor, ev.action, ev.resource,
       JSON.stringify(ev.payload), prevHash, hash, hmac],
    );
    await client.query('COMMIT');
    return { seq, hash };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
