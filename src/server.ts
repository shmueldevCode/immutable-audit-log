import Fastify from 'fastify';
import { z } from 'zod';
import { Pool } from 'pg';
import { appendEvent } from './append.js'
import { verifyChain } from './verify.js';

const pool = new Pool({
    connectionString:
        process.env.DATABASE_URL ?? 'postgres://audit_app:app-pass@localhost:5433/audit'
});

const EventSchema = z.object({
    actor: z.string().min(1),
    action: z.string().min(1),
    resource: z.string().min(1),
    payload: z.record(z.string(), z.unknown())
});

const app = Fastify({ logger: true});

app.post('/events', async (req, reply) => {
    const parsed = EventSchema.safeParse(req.body);
    if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.issues });
    }
    const result = await appendEvent(pool, parsed.data);
    return reply.code(201).send(result);
});

app.listen({ port: 3000, host: '0.0.0.0' }, (err, address) => {
    if (err) {
        app.log.error(err);
        process.exit(1);
    }
    console.log('Server Listening at ${address}')
});

app.get('/verify', async (req, reply) => {
    const result = await verifyChain(pool);
    return reply.send(result);
})