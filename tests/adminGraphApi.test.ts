import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { createAdminHttpServer } from "@server";
import { enqueueMeetingGraphSync } from "@graph";
import { closeBrainStore } from "@store";

test("admin graph APIs expose sanitized change sets and bounded graph reads", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "perry-admin-graph-api-"));
  const previousPath = process.env.PERRY_DB_PATH;
  const previousEnabled = process.env.PERRY_GRAPHITI_ENABLED;
  const previousUrl = process.env.PERRY_GRAPHITI_BRIDGE_URL;
  const previousGroup = process.env.PERRY_GRAPHITI_GROUP_ID;
  const previousAdminToken = process.env.ADMIN_API_TOKEN;
  process.env.PERRY_DB_PATH = join(tempDir, "perry.sqlite");
  process.env.PERRY_GRAPHITI_ENABLED = "true";
  process.env.PERRY_GRAPHITI_GROUP_ID = "doppel-admin-api";
  process.env.ADMIN_API_TOKEN = "admin-graph-test-token";

  const bridgeRequests: string[] = [];
  const replayedChangeSets: unknown[] = [];
  const bridge = createServer((req, res) => {
    bridgeRequests.push(req.url ?? "");
    if (req.method === "POST" && req.url === "/change-sets") {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      req.on("end", () => {
        replayedChangeSets.push(JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown);
        res.writeHead(202, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, applied: true }));
      });
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    if (req.url?.startsWith("/entities")) {
      res.end(
        JSON.stringify({
          ok: true,
          entities: [
            {
              stableKey: "project:wallace",
              type: "project",
              name: "Wallace",
              aliases: ["Wallace Webapp"],
              evidenceIds: ["evidence:wallace-owner"],
            },
          ],
        })
      );
      return;
    }
    if (req.url?.startsWith("/facts")) {
      res.end(
        JSON.stringify({
          ok: true,
          facts: [
            {
              fact: {
                factKey: "project:wallace:ASSIGNED_OWNER:person:ada",
                subjectKey: "project:wallace",
                relation: "ASSIGNED_OWNER",
                objectKey: "person:ada",
                active: true,
                evidenceId: "evidence:wallace-owner",
              },
              subject: { stableKey: "project:wallace", name: "Wallace" },
              object: { stableKey: "person:ada", name: "Ada" },
              evidence: { evidenceId: "evidence:wallace-owner", excerpt: "Ada owns Wallace follow-through." },
            },
          ],
        })
      );
      return;
    }
    if (req.url?.startsWith("/evidence")) {
      const parsed = new URL(req.url, "http://127.0.0.1");
      const evidenceId = parsed.searchParams.get("evidenceId");
      const changeSet = latestReplayedChangeSet(replayedChangeSets);
      const evidence = changeSet?.evidence.find((item) => item.evidenceId === evidenceId);
      res.end(JSON.stringify({ ok: true, evidence: evidence ?? null }));
      return;
    }
    if (req.url?.startsWith("/entity-context")) {
      const parsed = new URL(req.url, "http://127.0.0.1");
      const stableKey = parsed.searchParams.get("stableKey");
      const changeSet = latestReplayedChangeSet(replayedChangeSets);
      const entity = changeSet?.entities.find((item) => item.stableKey === stableKey) ?? null;
      const facts = (changeSet?.relations ?? [])
        .filter((relation) => relation.subjectKey === stableKey)
        .map((relation) => ({ fact: relation, evidence: changeSet?.evidence.find((item) => item.evidenceId === relation.evidenceId) }));
      const retirements = (changeSet?.retirements ?? [])
        .filter((retirement) => retirement.subjectKey === stableKey)
        .map((retirement) => ({ retirement, evidence: changeSet?.evidence.find((item) => item.evidenceId === retirement.evidenceId) }));
      res.end(JSON.stringify({ ok: true, entity, facts, retirements }));
      return;
    }
    if (req.url?.startsWith("/timeline")) {
      res.end(
        JSON.stringify({
          ok: true,
          stableKey: "project:wallace",
          events: [
            {
              type: "fact",
              at: "2026-05-23T15:00:00.000Z",
              item: { fact: { relation: "ASSIGNED_OWNER", subjectKey: "project:wallace", objectKey: "person:ada" } },
            },
          ],
        })
      );
      return;
    }
    res.end(JSON.stringify({ ok: true }));
  });

  await listen(bridge);
  const bridgeAddress = bridge.address();
  assert.equal(typeof bridgeAddress, "object");
  assert(bridgeAddress && "port" in bridgeAddress);
  process.env.PERRY_GRAPHITI_BRIDGE_URL = `http://127.0.0.1:${bridgeAddress.port}`;

  const admin = createAdminHttpServer();
  await listen(admin);
  const adminAddress = admin.address();
  assert.equal(typeof adminAddress, "object");
  assert(adminAddress && "port" in adminAddress);
  const baseUrl = `http://127.0.0.1:${adminAddress.port}`;

  try {
    const job = enqueueMeetingGraphSync({
      note: {
        source: "granola",
        sourceId: "admin-graph-note-1",
        title: "Wallace Admin Graph Review",
        attendees: [{ name: "Ada", email: "ada@doppel.example" }],
        summaryMarkdown: "Goal: make Wallace graph reads fast. Risk: graph bridge drift. Decision: Ada owns Wallace graph follow-through.",
      },
      record: {
        id: "granola:admin-graph-note-1",
        source: "granola",
        sourceId: "admin-graph-note-1",
        title: "Wallace Admin Graph Review",
        createdAt: "2026-05-23T15:00:00.000Z",
        updatedAt: "2026-05-23T15:01:00.000Z",
        status: "processed",
      },
      knowledge: {
        decisions: [{ text: "Ada owns Wallace graph follow-through." }],
        actionItems: [{ owner: "Ada", text: "Publish graph dashboard contract." }],
      },
      route: { project: "Wallace", publishMode: "approval", reason: "Matched Wallace" },
    });
    assert(job);

    const changeSets = await getJson<{ records: Array<Record<string, unknown>> }>(`${baseUrl}/api/graph-sync/change-sets?limit=5`);
    assert.equal(changeSets.records.length, 1);
    assert.equal(changeSets.records[0].meetingId, "granola:admin-graph-note-1");
    assert.equal(changeSets.records[0].validationStatus, "valid");
    assert.equal(typeof changeSets.records[0].validationWarningCount, "number");
    assert.equal("changeSetJson" in changeSets.records[0], false);
    assert.equal("validationErrorsJson" in changeSets.records[0], false);

    const unauthorizedDetail = await fetch(`${baseUrl}/api/graph-sync/change-sets/${encodeURIComponent(String(changeSets.records[0].id))}`);
    assert.equal(unauthorizedDetail.status, 401);

    const authorizedDetail = await getJson<{ record: Record<string, unknown> }>(
      `${baseUrl}/api/graph-sync/change-sets/${encodeURIComponent(String(changeSets.records[0].id))}`,
      { headers: { authorization: "Bearer admin-graph-test-token" } }
    );
    assert.equal(authorizedDetail.record.id, changeSets.records[0].id);
    assert.equal(typeof authorizedDetail.record.changeSetJson, "string");

    const unauthorizedReplay = await fetch(
      `${baseUrl}/api/graph-sync/change-sets/${encodeURIComponent(String(changeSets.records[0].id))}/replay`,
      { method: "POST" }
    );
    assert.equal(unauthorizedReplay.status, 401);

    const replay = await getJson<{
      replay: { status: string; record: { applyStatus: string; appliedAt?: string }; bridgeResult?: { ok?: boolean; applied?: boolean } };
    }>(`${baseUrl}/api/graph-sync/change-sets/${encodeURIComponent(String(changeSets.records[0].id))}/replay`, {
      method: "POST",
      headers: { authorization: "Bearer admin-graph-test-token" },
    });
    assert.equal(replay.replay.status, "applied");
    assert.equal(replay.replay.record.applyStatus, "applied");
    assert.equal(Boolean(replay.replay.record.appliedAt), true);
    assert.equal(replay.replay.bridgeResult?.applied, true);
    assert.equal((replay.replay as { diff?: { passed?: boolean } }).diff?.passed, true);
    assert.equal(replayedChangeSets.length, 1);
    assert.equal((replayedChangeSets[0] as { groupId?: string }).groupId, "doppel-admin-api");
    assert.equal(
      (replayedChangeSets[0] as { changeSet?: { sourceMeetingId?: string } }).changeSet?.sourceMeetingId,
      "granola:admin-graph-note-1"
    );

    const entities = await getJson<{ entities: Array<{ stableKey: string; name?: string }> }>(
      `${baseUrl}/api/brain/graph/entities?q=wallace&type=project&limit=7`
    );
    assert.equal(entities.entities[0].stableKey, "project:wallace");

    const facts = await getJson<{ facts: Array<{ fact?: { relation?: string }; evidence?: { excerpt?: string } }> }>(
      `${baseUrl}/api/brain/graph/facts?subject=${encodeURIComponent("project:wallace")}&active=true&limit=7`
    );
    assert.equal(facts.facts[0].fact?.relation, "ASSIGNED_OWNER");
    assert.match(facts.facts[0].evidence?.excerpt ?? "", /Ada owns Wallace/u);

    const context = await getJson<{ entity?: { stableKey?: string }; retirements: unknown[] }>(
      `${baseUrl}/api/brain/graph/entities/${encodeURIComponent("project:wallace")}/context?limit=7`
    );
    assert.equal(context.entity?.stableKey, "project:wallace");
    assert.equal(context.retirements.length, 0);

    const timeline = await getJson<{ stableKey?: string; events: Array<{ type: string }> }>(
      `${baseUrl}/api/brain/graph/timeline?stableKey=${encodeURIComponent("project:wallace")}&limit=7`
    );
    assert.equal(timeline.stableKey, "project:wallace");
    assert.equal(timeline.events[0].type, "fact");

    const toolState = await getJson<{
      tool: string;
      sections: Array<{ type: string; count: number; entities: Array<{ stableKey: string; evidenceCount: number }> }>;
    }>(`${baseUrl}/api/brain/tools/project-state?project=Wallace&types=goal,risk&limit=5`);
    assert.equal(toolState.tool, "company_brain.project_state");
    assert.equal(toolState.sections.find((section) => section.type === "goal")?.count, 1);
    const toolStableKey = toolState.sections.find((section) => section.type === "goal")?.entities[0]?.stableKey;
    assert.equal(toolStableKey, "goal:make-wallace-graph-reads-fast");

    const toolChanged = await getJson<{ tool: string; count: number; entities: Array<{ stableKey: string }> }>(
      `${baseUrl}/api/brain/tools/changed-since?since=2000-01-01T00:00:00.000Z&project=Wallace&limit=10`
    );
    assert.equal(toolChanged.tool, "company_brain.changed_since");
    assert(toolChanged.entities.some((entity) => entity.stableKey === toolStableKey));

    const toolEvidence = await getJson<{ tool: string; evidence: unknown[]; relations: unknown[] }>(
      `${baseUrl}/api/brain/tools/evidence?stableKey=${encodeURIComponent(toolStableKey ?? "")}`
    );
    assert.equal(toolEvidence.tool, "company_brain.evidence");
    assert(toolEvidence.evidence.length > 0);
    assert(toolEvidence.relations.length > 0);

    const ontologyHealth = await getJson<{ ok: boolean; counts: { materializedEntities: number }; checks: Array<{ id: string; passed: boolean }> }>(
      `${baseUrl}/api/brain/ontology/health?changeSetLimit=10`
    );
    assert.equal(ontologyHealth.ok, true);
    assert(ontologyHealth.counts.materializedEntities > 0);
    assert(ontologyHealth.checks.some((item) => item.id === "relations_have_evidence" && item.passed));

    assert(bridgeRequests.some((request) => request.startsWith("/entities") && request.includes("groupId=doppel-admin-api")));
    assert(bridgeRequests.some((request) => request.startsWith("/facts") && request.includes("active=true")));
    assert(bridgeRequests.some((request) => request.startsWith("/entity-context") && request.includes("stableKey=project%3Awallace")));
    assert(bridgeRequests.some((request) => request.startsWith("/timeline") && request.includes("limit=7")));
  } finally {
    await closeServer(admin);
    await closeServer(bridge);
    closeBrainStore(process.env.PERRY_DB_PATH);
    if (previousPath === undefined) delete process.env.PERRY_DB_PATH;
    else process.env.PERRY_DB_PATH = previousPath;
    if (previousEnabled === undefined) delete process.env.PERRY_GRAPHITI_ENABLED;
    else process.env.PERRY_GRAPHITI_ENABLED = previousEnabled;
    if (previousUrl === undefined) delete process.env.PERRY_GRAPHITI_BRIDGE_URL;
    else process.env.PERRY_GRAPHITI_BRIDGE_URL = previousUrl;
    if (previousGroup === undefined) delete process.env.PERRY_GRAPHITI_GROUP_ID;
    else process.env.PERRY_GRAPHITI_GROUP_ID = previousGroup;
    if (previousAdminToken === undefined) delete process.env.ADMIN_API_TOKEN;
    else process.env.ADMIN_API_TOKEN = previousAdminToken;
    rmSync(tempDir, { recursive: true, force: true });
  }
});

function latestReplayedChangeSet(replayedChangeSets: unknown[]): {
  entities: Array<{ stableKey: string }>;
  relations: Array<{ subjectKey: string; relation: string; objectKey: string; evidenceId: string }>;
  retirements: Array<{ subjectKey: string; relation: string; objectKey: string; evidenceId: string }>;
  evidence: Array<{ evidenceId: string }>;
} | undefined {
  return (replayedChangeSets.at(-1) as { changeSet?: any } | undefined)?.changeSet;
}
async function listen(server: Server): Promise<void> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (response.status !== 200) {
    assert.fail(`${url} returned ${response.status}: ${await response.text()}`);
  }
  return (await response.json()) as T;
}






