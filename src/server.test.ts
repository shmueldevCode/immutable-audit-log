import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';

const pool = new Pool({
  connectionString: 'postgres://audit_owner:owner-pass@localhost:5434/audit_test',
});

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp(pool);
  await pool.query('ALTER TABLE audit_log DISABLE TRIGGER no_update_delete');
  await pool.query('DELETE FROM audit_log');
  await pool.query('ALTER TABLE audit_log ENABLE TRIGGER no_update_delete');
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

describe('POST /events validation', () => {
  it('rechaza body vacío', async () => {
    const res = await app.inject({ method: 'POST', url: '/events', payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it('rechaza actor vacío', async () => {
    const res = await app.inject({
      method: 'POST', url: '/events',
      payload: { actor: '', action: 'X', resource: 'r', payload: {} },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rechaza payload que no es objeto', async () => {
    const res = await app.inject({
      method: 'POST', url: '/events',
      payload: { actor: 'a', action: 'X', resource: 'r', payload: 'no-es-objeto' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rechaza campo faltante', async () => {
    const res = await app.inject({
      method: 'POST', url: '/events',
      payload: { actor: 'a', action: 'X' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('acepta un evento válido y devuelve 201', async () => {
    const res = await app.inject({
      method: 'POST', url: '/events',
      payload: { actor: 'a', action: 'X', resource: 'r1', payload: { foo: 1 } },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('seq');
    expect(body).toHaveProperty('hash');
  });
});
