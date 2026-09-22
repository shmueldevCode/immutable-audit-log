import Fastify from 'fastify';
import { z } from 'zod';
import type { Pool } from 'pg';
import { appendEvent } from './append.js';
import { verifyChain } from './verify.js';

export const EventSchema = z.object({
    actor: z.string().min(1),
    action: z.string().min(1),
    resource: z.string().min(1),
    payload: z.record(z.string(), z.unknown()),
});

export function buildApp(pool: Pool) {
    const app = Fastify({ logger: true });

    app.setErrorHandler((err, req, reply) => {
        req.log.error(err);
        if (reply.statusCode < 500 && reply.statusCode !== 200) {
            return reply.send(err);
        }
        return reply.code(500).send({ error: "Internal Server Error", message: "Something went wrong" });
    });

    app.post('/events', async (req, reply) => {
        const parsed = EventSchema.safeParse(req.body);
        if (!parsed.success) {
            return reply.code(400).send({ error: parsed.error.issues });        
        }
        const result = await appendEvent(pool, parsed.data);
        return reply.code(201).send(result);
    });

    app.get('/verify', async (_req, reply) => {
        return reply.send(await verifyChain(pool));
    });

    return app;
}