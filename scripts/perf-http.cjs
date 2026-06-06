const { performance } = require("node:perf_hooks");
const { syntheticMeetingNote } = require("./perf-data.cjs");

const baseUrl = process.env.PERRY_PERF_URL ?? "http://localhost:8787";
const requests = Number(process.env.PERRY_HTTP_REQUESTS ?? process.argv[2] ?? 100);
const warmup = Number(process.env.PERRY_HTTP_WARMUP ?? 10);
const concurrency = Number(process.env.PERRY_HTTP_CONCURRENCY ?? process.argv[3] ?? 1);

async function timed(name, fn) {
  const samples = [];
  for (let index = 0; index < warmup; index += 1) {
    await fn(index);
  }
  for (let index = 0; index < requests; index += 1) {
    const start = performance.now();
    await fn(index);
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  return {
    name,
    count: samples.length,
    min: samples[0],
    p50: percentile(samples, 0.5),
    p95: percentile(samples, 0.95),
    max: samples[samples.length - 1],
  };
}

async function timedConcurrent(name, fn) {
  if (concurrency <= 1) return timed(name, fn);
  const samples = [];
  for (let index = 0; index < warmup; index += 1) {
    await fn(index);
  }
  let next = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < requests) {
        const index = next;
        next += 1;
        const start = performance.now();
        await fn(index);
        samples.push(performance.now() - start);
      }
    })
  );
  samples.sort((a, b) => a - b);
  return {
    name,
    count: samples.length,
    min: samples[0],
    p50: percentile(samples, 0.5),
    p95: percentile(samples, 0.95),
    max: samples[samples.length - 1],
  };
}

async function get(path) {
  const response = await fetch(`${baseUrl}${path}`);
  if (!response.ok) throw new Error(`${path} failed: ${response.status}`);
  await response.arrayBuffer();
}

async function post(path, payload) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`${path} failed: ${response.status}`);
  await response.arrayBuffer();
}

function percentile(samples, value) {
  return samples[Math.min(samples.length - 1, Math.floor(samples.length * value))];
}

function print(result) {
  console.log(
    `${result.name.padEnd(32)} min=${result.min.toFixed(2).padStart(7)}ms p50=${result.p50
      .toFixed(2)
      .padStart(7)}ms p95=${result.p95.toFixed(2).padStart(7)}ms max=${result.max.toFixed(2).padStart(7)}ms`
  );
}

async function main() {
  console.log(`Perry HTTP benchmark`);
  console.log(`URL: ${baseUrl}`);
  console.log(`Requests: ${requests}, warmup: ${warmup}, concurrency: ${concurrency}`);
  console.log("");

  const results = [];
  results.push(await timedConcurrent("GET /api/ping", () => get("/api/ping")));
  results.push(await timedConcurrent("GET /api/health", () => get("/api/health")));
  results.push(await timedConcurrent("GET counts", () => get("/api/counts?status=pending")));
  results.push(await timedConcurrent("GET approvals page", () => get("/api/approvals?status=pending&limit=100")));
  results.push(
    await timedConcurrent("GET approvals full detail", () => get("/api/approvals?status=pending&limit=100&detail=true"))
  );
  results.push(await timedConcurrent("GET approvals tiny page", () => get("/api/approvals?status=pending&limit=5")));
  results.push(await timedConcurrent("GET brain search tiny", () => get("/api/brain/search?q=wallace&limit=1")));
  results.push(await timedConcurrent("GET brain search", () => get("/api/brain/search?q=wallace&limit=25")));
  results.push(await timedConcurrent("POST granola preview", (index) => post("/api/granola/preview", syntheticMeetingNote(index))));
  results.push(
    await timedConcurrent("POST granola dry-run", (index) =>
      post("/api/granola/zapier?dryRun=true", syntheticMeetingNote(index))
    )
  );

  for (const result of results) print(result);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
