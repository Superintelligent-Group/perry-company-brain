const strict = process.argv.includes("--strict");
const adminUrl = (process.env.PERRY_ADMIN_URL ?? "http://127.0.0.1:8787").replace(/\/+$/u, "");
const graphitiUrl = (process.env.PERRY_GRAPHITI_BRIDGE_URL ?? "").replace(/\/+$/u, "");
const lmstudioUrl = (process.env.LMSTUDIO_BASE_URL ?? process.env.GRAPHITI_OPENAI_BASE_URL ?? "http://127.0.0.1:1234/v1").replace(/\/+$/u, "");
const adminToken = process.env.ADMIN_API_TOKEN;

async function main() {
  const checks = [];
  checks.push(await checkJson("admin ping", `${adminUrl}/api/ping`));
  checks.push(await checkJson("admin health", `${adminUrl}/api/health`));
  checks.push(await checkJson("admin diagnostics", `${adminUrl}/api/diagnostics`));
  checks.push(await checkJson("admin agent status", `${adminUrl}/api/agent/status`));
  checks.push(await checkJson("admin graph change sets", `${adminUrl}/api/graph-sync/change-sets?limit=1`));
  checks.push(await checkJson("admin graph entities", `${adminUrl}/api/brain/graph/entities?q=wallace&limit=1`));

  const replayChangeSetId = process.env.PERRY_GAUNTLET_REPLAY_CHANGE_SET_ID;
  if (replayChangeSetId) {
    checks.push(
      await checkJson("admin graph replay diff", `${adminUrl}/api/graph-sync/change-sets/${encodeURIComponent(replayChangeSetId)}/replay`, {
        method: "POST",
        headers: adminHeaders(),
        validate: (payload) => payload?.replay?.diff?.passed === true,
      })
    );
  }

  if (graphitiUrl) {
    checks.push(await checkJson("graphiti health", `${graphitiUrl}/health`));
    checks.push(await checkJson("graphiti entities", `${graphitiUrl}/entities?groupId=${encodeURIComponent(process.env.PERRY_GRAPHITI_GROUP_ID ?? "doppel-labs")}&limit=1`));
  } else {
    checks.push({ name: "graphiti bridge", ok: false, detail: "PERRY_GRAPHITI_BRIDGE_URL is not set" });
  }

  checks.push(
    await checkJson("lmstudio models", `${lmstudioUrl}/models`, {
      headers: { authorization: `Bearer ${process.env.LMSTUDIO_API_KEY ?? "lm-studio"}` },
    })
  );

  const ok = checks.every((check) => check.ok);
  for (const check of checks) console.log(`${check.ok ? "PASS" : "WARN"} ${check.name}: ${check.detail}`);
  if (!ok && strict) process.exit(1);
}

function adminHeaders() {
  return adminToken ? { authorization: `Bearer ${adminToken}` } : {};
}

async function checkJson(name, url, options = {}) {
  const headers = { accept: "application/json", ...(options.headers ?? {}) };
  try {
    const started = performance.now();
    const response = await fetch(url, { method: options.method ?? "GET", headers });
    const elapsed = performance.now() - started;
    const text = await response.text();
    if (!response.ok) return { name, ok: false, detail: `${response.status} in ${elapsed.toFixed(1)}ms ${text.slice(0, 120)}` };
    const payload = text ? JSON.parse(text) : undefined;
    if (options.validate && !options.validate(payload)) {
      return { name, ok: false, detail: `semantic check failed in ${elapsed.toFixed(1)}ms` };
    }
    return { name, ok: true, detail: `${response.status} in ${elapsed.toFixed(1)}ms` };
  } catch (error) {
    return { name, ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
