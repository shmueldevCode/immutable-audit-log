const N = 10000;
const CONCURRENCY = 20;

async function insertOne(i) {
  const res = await fetch('http://localhost:3000/events', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      actor: `user${i % 50}`,
      action: 'BENCH_EVENT',
      resource: `resource:${i}`,
      payload: { i },
    }),
  });
  if (!res.ok) throw new Error(`Failed at ${i}: ${res.status}`);
}

async function run() {
  const start = Date.now();
  let done = 0;

  async function worker() {
    while (done < N) {
      const i = done++;
      if (i >= N) break;
      await insertOne(i);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const elapsedMs = Date.now() - start;
  console.log(`Inserted ${N} events in ${elapsedMs}ms`);
  console.log(`Throughput: ${(N / (elapsedMs / 1000)).toFixed(1)} events/sec`);
}

run();
