import Fastify, { type FastifyError } from 'fastify';
import { z } from 'zod';
import type { Pool } from 'pg';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { appendEvent } from './append.js';
import { verifyChain } from './verify.js';

export const EventSchema = z.object({
    actor: z.string().min(1),
    action: z.string().min(1),
    resource: z.string().min(1),
    payload: z.record(z.string(), z.unknown()),
});

export async function buildApp(pool: Pool) {
    const app = Fastify({ logger: true });

    await app.register(swagger, {
        openapi: {
            info: {
                title: 'Immutable Audit Log Engine',
                description: 'A tamper-evident audit logging service with cryptographic hash chaining.',
                version: '1.0.0',
            },
        },
    });

    await app.register(swaggerUi, {
        routePrefix: '/docs',
    });

    app.setErrorHandler((err: FastifyError, req, reply) => {
        req.log.error(err);
        if (err.statusCode && err.statusCode < 500) {
            return reply.send(err);
        }
        return reply.code(500).send({ error: "Internal Server Error", message: "Something went wrong" });
    });

    app.post('/events', {
        schema: {
            summary: 'Append a new event to the audit log',
            body: {
                type: 'object',
                required: ['actor', 'action', 'resource', 'payload'],
                properties: {
                    actor: { type: 'string', minLength: 1},
                    action: { type: 'string', minLength: 1},
                    resource: { type: 'string', minLength: 1},
                    payload: { type: 'object'},
                },
            },
            response: {
                201: {
                    type: 'object',
                    properties: {
                        seq: { type: 'number' },
                        hash: { type: 'string' },
                    },
                },
                400: {
                    type: 'object',
                    properties: { error: {} },
                },
            },
        },
    }, async (req, reply) => {
        const parsed = EventSchema.safeParse(req.body);
        if (!parsed.success) {
            return reply.code(400).send({ error: parsed.error.issues });
        }
        const result = await appendEvent(pool, parsed.data);
        return reply.code(201).send(result);
    });

    app.get('/verify', {
        schema: {
            summary: 'Walk the full audit chain and check its integrity',
            response: {
                200: {
                    type: 'object',
                    properties: {
                        valid: { type: 'boolean' },
                        checked: { type: 'number' },
                        brokenAt: { type: 'number' },
                        reason: { type: 'string' },
                    },
                },
            },
        },
    }, async (_req, reply) => {
        return reply.send(await verifyChain(pool));
    });

    return app;
}
