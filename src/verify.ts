import type { Pool } from 'pg';
import { GENESIS, recomputeHash, recomputeHmac } from './hash.js';

export async function verifyChain(pool: Pool, hmacSecret: string) {
    const { rows } = await pool.query(
        'SELECT seq, id, ts, actor, action, resource, payload, prev_hash, hash, hmac FROM audit_log ORDER BY seq',
    );

    let expectedPrev = GENESIS;
    for (const row of rows) {
        if (row.prev_hash !== expectedPrev) {
            return { valid: false, brokenAt: row.seq, reason: 'prev_hash mismatch'};
        }
        const recalculated = recomputeHash({ ...row, seq: Number(row.seq), ts: row.ts.toISOString() });
        if (recalculated !== row.hash) {
            return {valid: false, brokenAt: row.seq, reason: 'hash mismatch' };
        }
        const recalculatedHmac = recomputeHmac(hmacSecret, { ...row, seq: Number(row.seq), ts: row.ts.toISOString() });
        if (recalculatedHmac !== row.hmac) {
            return { valid: false, brokenAt: row.seq, reason: 'hmac mismatch' };
        }
        expectedPrev = row.hash;
    }
    return { valid: true, checked: rows.length };
}
