import { Pool } from 'pg';
import { buildApp } from './app.js';

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ?? 'postgres://audit_app:app-pass@localhost:5433/audit',
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

async function main() {
  const anchorOptions = process.env.GITHUB_TOKEN
    ? {
        githubToken: process.env.GITHUB_TOKEN,
        owner: process.env.ANCHOR_REPO_OWNER ?? 'shmueldevCode',
        repo: process.env.ANCHOR_REPO_NAME ?? 'immutable-audit-log',
      }
    : undefined;

  const app = await buildApp(pool, process.env.API_KEY, process.env.HMAC_SECRET, anchorOptions);

  app.listen({ port: 3000, host: '0.0.0.0' }, (err, address) => {
    if (err) {
      app.log.error(err);
      process.exit(1);
    }
    console.log(`Server listening at ${address}`);
  });
}

main();
