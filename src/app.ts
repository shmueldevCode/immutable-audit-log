import Fastify, { type FastifyError, type FastifyRequest, type FastifyReply } from 'fastify';
import { z } from 'zod';
import type { Pool } from 'pg';
import { timingSafeEqual } from 'node:crypto';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import rateLimit from '@fastify/rate-limit';
import { appendEvent } from './append.js';
import { verifyChain } from './verify.js';

export const EventSchema = z.object({
    actor: z.string().min(1),
    action: z.string().min(1),
    resource: z.string().min(1),
    payload: z.record(z.string(), z.unknown()),
});

function safeCompare(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) {
        timingSafeEqual(bufA, bufA);
        return false;
    }
    return timingSafeEqual(bufA, bufB);
}

export async function buildApp(pool: Pool, apiKey?: string) {
    const app = Fastify({ logger: true });

    await app.register(swagger, {
        openapi: {
            info: {
                title: 'Immutable Audit Log Engine',
                description: 'A tamper-evident audit logging service with cryptographic hash chaining.',
                version: '1.0.0',
            },
            components: {
                securitySchemes: {
                    apiKey: {
                        type: 'apiKey',
                        name: 'x-api-key',
                        in: 'header',
                    },
                },
            },
        },
    });

    await app.register(swaggerUi, {
        routePrefix: '/docs',
    });

    await app.register(rateLimit, {
        max: 100,
        timeWindow: '1 minute',
        keyGenerator: (req: FastifyRequest) => {
            const key = req.headers['x-api-key'];
            return typeof key === 'string' ? key : req.ip;
        },
    });

    app.setErrorHandler((err: FastifyError, req, reply) => {
        req.log.error(err);
        if (err.statusCode && err.statusCode < 500) {
            return reply.send(err);
        }
        return reply.code(500).send({ error: "Internal Server Error", message: "Something went wrong" });
    });

    if (apiKey) {
        app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
            if (req.url.startsWith('/docs')) {
                return;
            }
            const provided = req.headers['x-api-key'];
            if (typeof provided !== 'string' || !safeCompare(provided, apiKey)) {
                return reply.code(401).send({ error: 'Unauthorized', message: 'Missing or invalid API key' });
            }
        });
    }

    app.post('/events', {
        schema: {
            summary: 'Append a new event to the audit log',
            security: [{ apiKey: [] }],
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
                401: {
                    type: 'object',
                    properties: { error: { type: 'string' }, message: { type: 'string' } },
                },
                429: {
                    type: 'object',
                    properties: { error: { type: 'string' }, message: { type: 'string' } },
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
            security: [{ apiKey: [] }],
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
                401: {
                    type: 'object',
                    properties: { error: { type: 'string' }, message: { type: 'string' } },
                },
                429: {
                    type: 'object',
                    properties: { error: { type: 'string' }, message: { type: 'string' } },
                },
            },
        },
    }, async (_req, reply) => {
        return reply.send(await verifyChain(pool));
    });

    return app;
}
