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
  const app = await buildApp(pool, process.env.API_KEY);

  app.listen({ port: 3000, host: '0.0.0.0' }, (err, address) => {
    if (err) {
      app.log.error(err);
      process.exit(1);
    }
    console.log(`Server listening at ${address}`);
  });
}

main();
