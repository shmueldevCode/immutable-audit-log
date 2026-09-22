import type { Pool } from 'pg';
import { GENESIS, recomputeHash, recomputeHmac } from './hash.js';

interface VerifyResult {
    valid: boolean;
    checked: number;
    brokenAt?: number;
    reason?: string;
}

function verifyRows(
    rows: any[],
    hmacSecret: string,
    expectedPrevStart: string,
): VerifyResult {
    let expectedPrev = expectedPrevStart;
    for (const row of rows) {
        if (row.prev_hash !== expectedPrev) {
            return { valid: false, checked: 0, brokenAt: Number(row.seq), reason: 'prev_hash mismatch' };
        }
        const recalculated = recomputeHash({ ...row, seq: Number(row.seq), ts: row.ts.toISOString() });
        if (recalculated !== row.hash) {
            return { valid: false, checked: 0, brokenAt: Number(row.seq), reason: 'hash mismatch' };
        }
        const recalculatedHmac = recomputeHmac(hmacSecret, { ...row, seq: Number(row.seq), ts: row.ts.toISOString() });
        if (recalculatedHmac !== row.hmac) {
            return { valid: false, checked: 0, brokenAt: Number(row.seq), reason: 'hmac mismatch' };
        }
        expectedPrev = row.hash;
    }
    return { valid: true, checked: rows.length };
}

export async function verifyChainFull(pool: Pool, hmacSecret: string): Promise<VerifyResult> {
    const { rows } = await pool.query(
        'SELECT seq, id, ts, actor, action, resource, payload, prev_hash, hash, hmac FROM audit_log ORDER BY seq',
    );
    return verifyRows(rows, hmacSecret, GENESIS);
}

export async function verifyChainIncremental(pool: Pool, hmacSecret: string): Promise<VerifyResult> {
    const { rows: checkpointRows } = await pool.query(
        'SELECT seq, hash FROM verification_checkpoints ORDER BY seq DESC LIMIT 1',
    );
    const checkpoint = checkpointRows[0];

    if (!checkpoint) {
        const result = await verifyChainFull(pool, hmacSecret);
        if (result.valid && result.checked > 0) {
            const { rows: lastRows } = await pool.query(
                'SELECT seq, hash FROM audit_log ORDER BY seq DESC LIMIT 1',
            );
            await pool.query(
                'INSERT INTO verification_checkpoints (seq, hash) VALUES ($1, $2)',
                [lastRows[0].seq, lastRows[0].hash],
            );
        }
        return result;
    }

    // Confirm the checkpointed row hasn't been altered since we last checked it.
    const { rows: checkpointRowData } = await pool.query(
        'SELECT seq, id, ts, actor, action, resource, payload, prev_hash, hash, hmac FROM audit_log WHERE seq = $1',
        [checkpoint.seq],
    );
    if (checkpointRowData.length === 0 || checkpointRowData[0].hash !== checkpoint.hash) {
        return { valid: false, checked: 0, brokenAt: Number(checkpoint.seq), reason: 'checkpoint row missing or altered' };
    }

    const { rows: newRows } = await pool.query(
        'SELECT seq, id, ts, actor, action, resource, payload, prev_hash, hash, hmac FROM audit_log WHERE seq > $1 ORDER BY seq',
        [checkpoint.seq],
    );

    if (newRows.length === 0) {
        return { valid: true, checked: 0 };
    }

    const result = verifyRows(newRows, hmacSecret, checkpoint.hash);
    if (result.valid) {
        const lastNew = newRows[newRows.length - 1];
        await pool.query(
            'INSERT INTO verification_checkpoints (seq, hash) VALUES ($1, $2)',
            [lastNew.seq, lastNew.hash],
        );
    }
    return result;
}

export const verifyChain = verifyChainFull;
