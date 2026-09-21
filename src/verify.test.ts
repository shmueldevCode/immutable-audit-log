import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { appendEvent } from './append.js';
import { verifyChain } from './verify.js';

const pool = new Pool ({
    connectionString: 'postgres://audit_owner:owner-pass@localhost:5434/audit_test',
});

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
        await appendEvent(pool, {actor: 'a', action: 'X', resource: 'r1', payload: {} });
        await appendEvent(pool, {actor: 'b', action: 'Y', resource: 'r2', payload: {} });

        const result = await verifyChain(pool);
        expect(result.valid).toBe(true);
    });

    it('detecta manipulación y señala la fila exacta', async () => {
        await appendEvent(pool, {actor: 'a', action: 'X', resource: 'r1', payload: {} });
        await appendEvent(pool, {actor: 'b', action: 'Y', resource: 'r2', payload: {} });
        await appendEvent(pool, {actor: 'c', action: 'Z', resource: 'r3', payload: {} });

        await pool.query('ALTER TABLE audit_log DISABLE TRIGGER no_update_delete');
        await pool.query("UPDATE audit_log SET actor = 'hacker' WHERE seq = 2");
        await pool.query('ALTER TABLE audit_log ENABLE TRIGGER no_update_delete');

        const result = await verifyChain(pool);
        expect(result.valid).toBe(false);
        expect(Number(result.brokenAt)).toBe(2);
    });

    it('rechaza inserciones concurrentes sin romper la cadena', async () => {
        await Promise.all([
            appendEvent(pool, {actor: 'a', action: 'X', resource: 'r1', payload: {} }),
            appendEvent(pool, {actor: 'b', action: 'Y', resource: 'r2', payload: {} }),
            appendEvent(pool, {actor: 'c', action: 'Z', resource: 'r3', payload: {} }),
        ]);

        const result = await verifyChain(pool);
        expect(result.valid).toBe(true);
    });
});