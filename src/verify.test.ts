import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { appendEvent } from './append.js';
import { verifyChain, verifyChainIncremental } from './verify.js';

const pool = new Pool({
    connectionString: 'postgres://audit_owner:owner-pass@localhost:5434/audit_test',
});

const TEST_SECRET = 'test-hmac-secret';

beforeEach(async () => {
    await pool.query('ALTER TABLE audit_log DISABLE TRIGGER no_update_delete');
    await pool.query('DELETE FROM audit_log');
    await pool.query('ALTER TABLE audit_log ENABLE TRIGGER no_update_delete');
    await pool.query('DELETE FROM verification_checkpoints');
});

afterAll(async () => {
    await pool.end();
})

describe('verifyChain', () => {
    it('valida una cadena intacta', async () => {
        await appendEvent(pool, { actor: 'a', action: 'X', resource: 'r1', payload: {} }, TEST_SECRET);
        await appendEvent(pool, { actor: 'b', action: 'Y', resource: 'r2', payload: {} }, TEST_SECRET);

        const result = await verifyChain(pool, TEST_SECRET);
        expect(result.valid).toBe(true);
    });

    it('detecta manipulación y señala la fila exacta', async () => {
        await appendEvent(pool, { actor: 'a', action: 'X', resource: 'r1', payload: {} }, TEST_SECRET);
        await appendEvent(pool, { actor: 'b', action: 'Y', resource: 'r2', payload: {} }, TEST_SECRET);
        await appendEvent(pool, { actor: 'c', action: 'Z', resource: 'r3', payload: {} }, TEST_SECRET);

        await pool.query('ALTER TABLE audit_log DISABLE TRIGGER no_update_delete');
        await pool.query("UPDATE audit_log SET actor = 'hacker' WHERE seq = 2");
        await pool.query('ALTER TABLE audit_log ENABLE TRIGGER no_update_delete');

        const result = await verifyChain(pool, TEST_SECRET);
        expect(result.valid).toBe(false);
        expect(Number(result.brokenAt)).toBe(2);
    });

    it('rechaza inserciones concurrentes sin romper la cadena', async () => {
        await Promise.all([
            appendEvent(pool, { actor: 'a', action: 'X', resource: 'r1', payload: {} }, TEST_SECRET),
            appendEvent(pool, { actor: 'b', action: 'Y', resource: 'r2', payload: {} }, TEST_SECRET),
            appendEvent(pool, { actor: 'c', action: 'Z', resource: 'r3', payload: {} }, TEST_SECRET),
        ]);

        const result = await verifyChain(pool, TEST_SECRET);
        expect(result.valid).toBe(true);
    });

    it('detecta manipulación del hmac aunque el hash siga siendo consistente', async () => {
        await appendEvent(pool, { actor: 'a', action: 'X', resource: 'r1', payload: {} }, TEST_SECRET);

        await pool.query('ALTER TABLE audit_log DISABLE TRIGGER no_update_delete');
        await pool.query("UPDATE audit_log SET hmac = repeat('9', 64) WHERE seq = 1");
        await pool.query('ALTER TABLE audit_log ENABLE TRIGGER no_update_delete');

        const result = await verifyChain(pool, TEST_SECRET);
        expect(result.valid).toBe(false);
        expect(result.reason).toBe('hmac mismatch');
    });
});

describe('verifyChainIncremental', () => {
    it('crea un checkpoint la primera vez que se llama', async () => {
        await appendEvent(pool, { actor: 'a', action: 'X', resource: 'r1', payload: {} }, TEST_SECRET);
        await appendEvent(pool, { actor: 'b', action: 'Y', resource: 'r2', payload: {} }, TEST_SECRET);

        const result = await verifyChainIncremental(pool, TEST_SECRET);
        expect(result.valid).toBe(true);
        expect(result.checked).toBe(2);

        const { rows } = await pool.query('SELECT * FROM verification_checkpoints');
        expect(rows.length).toBe(1);
        expect(Number(rows[0].seq)).toBe(2);
    });

    it('solo revisa filas nuevas en la segunda llamada', async () => {
        await appendEvent(pool, { actor: 'a', action: 'X', resource: 'r1', payload: {} }, TEST_SECRET);
        await appendEvent(pool, { actor: 'b', action: 'Y', resource: 'r2', payload: {} }, TEST_SECRET);
        await verifyChainIncremental(pool, TEST_SECRET);

        await appendEvent(pool, { actor: 'c', action: 'Z', resource: 'r3', payload: {} }, TEST_SECRET);
        const result = await verifyChainIncremental(pool, TEST_SECRET);

        expect(result.valid).toBe(true);
        expect(result.checked).toBe(1);
    });

    it('el modo incremental no detecta manipulación en una fila ya cubierta por un checkpoint (limitación conocida)', async () => {
        await appendEvent(pool, { actor: 'a', action: 'X', resource: 'r1', payload: {} }, TEST_SECRET);
        await appendEvent(pool, { actor: 'b', action: 'Y', resource: 'r2', payload: {} }, TEST_SECRET);
        await verifyChainIncremental(pool, TEST_SECRET);

        await pool.query('ALTER TABLE audit_log DISABLE TRIGGER no_update_delete');
        await pool.query("UPDATE audit_log SET actor = 'hacker' WHERE seq = 1");
        await pool.query('ALTER TABLE audit_log ENABLE TRIGGER no_update_delete');

        await appendEvent(pool, { actor: 'c', action: 'Z', resource: 'r3', payload: {} }, TEST_SECRET);
        const incrementalResult = await verifyChainIncremental(pool, TEST_SECRET);

        // Known trade-off: incremental verification trusts rows already
        // covered by a checkpoint. It does NOT re-check them.
        expect(incrementalResult.valid).toBe(true);

        // A full verification, however, still catches it.
        const fullResult = await verifyChain(pool, TEST_SECRET);
        expect(fullResult.valid).toBe(false);
        expect(Number(fullResult.brokenAt)).toBe(1);
    });
});
