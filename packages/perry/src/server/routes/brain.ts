// routes/brain — brain endpoints for the admin HTTP server
import type { IncomingMessage, ServerResponse } from "node:http";
import { getBrainToolChangedSince, getBrainToolEvidence, getBrainToolProjectState, getCompanyBrainInsights, getOntologyHealthReport, getOntologyIndex, queryEvidenceFor, queryOntologyChangedSince, summarizeOntology } from "@brain";
import { getGraphEntityContext, getGraphEvidence, getGraphTimeline, listGraphEntities, listGraphFacts, projectMultiplayerState, searchGraphMemory } from "@graph";
import { flushFtsQueue, listActionItems, listDecisions, searchBrain } from "@store";
import { httpError, parseOntologyType, parseOntologyTypes, requireAdmin, runOntologyQuery, sendJson } from "../http-util";

export async function handleBrain(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  if (req.method === "GET" && url.pathname === "/api/brain/search") {
    const types = (url.searchParams.get("types") ?? "")
      .split(",")
      .map((type) => type.trim())
      .filter((type): type is "meeting" | "decision" | "action" =>
        type === "meeting" || type === "decision" || type === "action"
      );
    sendJson(res, 200, {
      results: searchBrain(url.searchParams.get("q") ?? "", Number(url.searchParams.get("limit") ?? 20), {
        types,
      }),
    });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/brain/graph/search") {
    sendJson(res, 200, await searchGraphMemory(url.searchParams.get("q") ?? "", Number(url.searchParams.get("limit") ?? 10)));
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/brain/graph/entities") {
    sendJson(
      res,
      200,
      await listGraphEntities({
        query: url.searchParams.get("q") ?? undefined,
        type: url.searchParams.get("type") ?? undefined,
        limit: Number(url.searchParams.get("limit") ?? 25),
      })
    );
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/brain/graph/facts") {
    const activeParam = url.searchParams.get("active");
    sendJson(
      res,
      200,
      await listGraphFacts({
        subject: url.searchParams.get("subject") ?? undefined,
        object: url.searchParams.get("object") ?? undefined,
        relation: url.searchParams.get("relation") ?? undefined,
        active: activeParam === null ? undefined : activeParam === "true",
        limit: Number(url.searchParams.get("limit") ?? 25),
      })
    );
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/brain/graph/evidence") {
    sendJson(res, 200, await getGraphEvidence(url.searchParams.get("evidenceId") ?? ""));
    return true;
  }

  const graphContextMatch = url.pathname.match(/^\/api\/brain\/graph\/entities\/([^/]+)\/context$/u);
  if (req.method === "GET" && graphContextMatch) {
    sendJson(
      res,
      200,
      await getGraphEntityContext(decodeURIComponent(graphContextMatch[1]), Number(url.searchParams.get("limit") ?? 25))
    );
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/brain/graph/timeline") {
    sendJson(
      res,
      200,
      await getGraphTimeline(
        url.searchParams.get("stableKey") ?? url.searchParams.get("entity") ?? "",
        Number(url.searchParams.get("limit") ?? 50)
      )
    );
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/brain/decisions") {
    sendJson(res, 200, {
      records: listDecisions(Number(url.searchParams.get("limit") ?? 50), Number(url.searchParams.get("offset") ?? 0)),
    });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/brain/actions") {
    sendJson(res, 200, {
      records: listActionItems(Number(url.searchParams.get("limit") ?? 50), Number(url.searchParams.get("offset") ?? 0)),
    });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/brain/insights") {
    sendJson(res, 200, getCompanyBrainInsights(Number(url.searchParams.get("limit") ?? 10_000)));
    return true;
  }
  if (req.method === "GET" && url.pathname === "/api/brain/ontology") {
    const index = getOntologyIndex(Number(url.searchParams.get("changeSetLimit") ?? 1000));
    const type = parseOntologyType(url.searchParams.get("type"));
    const options = {
      project: url.searchParams.get("project") ?? undefined,
      q: url.searchParams.get("q") ?? undefined,
      limit: Number(url.searchParams.get("limit") ?? 25),
    };
    sendJson(res, 200, type ? runOntologyQuery(type, options, index) : { summary: summarizeOntology(index) });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/brain/ontology/changed-since") {
    const since = url.searchParams.get("since");
    if (!since) throw httpError(400, "Missing required since parameter.");
    sendJson(res, 200, queryOntologyChangedSince(since, {
      project: url.searchParams.get("project") ?? undefined,
      q: url.searchParams.get("q") ?? undefined,
      limit: Number(url.searchParams.get("limit") ?? 100),
    }));
    return true;
  }
  if (req.method === "GET" && url.pathname === "/api/brain/ontology/evidence") {
    const index = getOntologyIndex(Number(url.searchParams.get("changeSetLimit") ?? 1000));
    sendJson(res, 200, queryEvidenceFor(url.searchParams.get("stableKey") ?? "", index));
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/brain/ontology/health") {
    sendJson(
      res,
      200,
      getOntologyHealthReport({
        changeSetLimit: Number(url.searchParams.get("changeSetLimit") ?? 200),
        entityLimit: Number(url.searchParams.get("entityLimit") ?? 1000),
        relationLimit: Number(url.searchParams.get("relationLimit") ?? 2000),
        evidenceLimit: Number(url.searchParams.get("evidenceLimit") ?? 1000),
      })
    );
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/brain/tools/project-state") {
    sendJson(
      res,
      200,
      getBrainToolProjectState({
        project: url.searchParams.get("project") ?? undefined,
        q: url.searchParams.get("q") ?? undefined,
        limit: Number(url.searchParams.get("limit") ?? 10),
        types: parseOntologyTypes(url.searchParams.get("types")),
      })
    );
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/brain/tools/changed-since") {
    const since = url.searchParams.get("since");
    if (!since) throw httpError(400, "Missing required since parameter.");
    sendJson(
      res,
      200,
      getBrainToolChangedSince({
        since,
        project: url.searchParams.get("project") ?? undefined,
        q: url.searchParams.get("q") ?? undefined,
        limit: Number(url.searchParams.get("limit") ?? 50),
      })
    );
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/brain/tools/evidence") {
    const stableKey = url.searchParams.get("stableKey") ?? "";
    if (!stableKey.trim()) throw httpError(400, "Missing required stableKey parameter.");
    sendJson(res, 200, getBrainToolEvidence({ stableKey }));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/brain/project-multiplayer") {
    requireAdmin(req);
    sendJson(res, 200, projectMultiplayerState(Number(url.searchParams.get("limit") ?? 10_000)));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/brain/fts/flush") {
    requireAdmin(req);
    sendJson(res, 200, { flushed: flushFtsQueue(Number(url.searchParams.get("limit") ?? 1000)) });
    return true;
  }
  return false;
}
