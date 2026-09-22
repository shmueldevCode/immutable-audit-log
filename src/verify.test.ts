import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { appendEvent } from './append.js';
import { verifyChain } from './verify.js';

const pool = new Pool({
    connectionString: 'postgres://audit_owner:owner-pass@localhost:5434/audit_test',
});

const TEST_SECRET = 'test-hmac-secret';

beforeEach(async () => {
    await pool.query('ALTER TABLE audit_log DISABLE TRIGGER no_update_delete');
    await pool.query('DELETE FROM audit_log');
    await pool.query('ALTER TABLE audit_log ENABLE TRIGGER no_update_delete');
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
