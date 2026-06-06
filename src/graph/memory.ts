import type { ExtractedKnowledge } from "@extraction";
import type { MeetingNote } from "@meetings";
import type { MeetingRecord } from "@store";
import type { MeetingRoute } from "@meetings";
import { buildGraphChangeSet, validateGraphChangeSet, type GraphChangeSet } from "./change-set";

export interface GraphMemoryStatus {
  enabled: boolean;
  bridgeUrl?: string;
  groupId: string;
  timeoutMs: number;
  includePrivateNotes: boolean;
  includeTranscript: boolean;
  directChangeSets: boolean;
}

export interface GraphMemorySyncInput {
  note: MeetingNote;
  record: MeetingRecord;
  knowledge: ExtractedKnowledge;
  route?: MeetingRoute;
  notionUrl?: string;
  discordMessageUrl?: string;
}

export interface GraphMemorySearchResult {
  fact?: string;
  name?: string;
  uuid?: string;
  sourceNode?: string;
  targetNode?: string;
  score?: number;
  raw?: unknown;
}

export interface GraphMemorySearchResponse {
  enabled: boolean;
  results: GraphMemorySearchResult[];
  error?: string;
}

export interface GraphEntityResult {
  stableKey: string;
  type?: string;
  name?: string;
  aliases?: string[];
  properties?: Record<string, unknown>;
  evidenceIds?: string[];
  updatedAt?: string;
}

export interface GraphEvidenceResult {
  evidenceId: string;
  kind?: string;
  source?: string;
  sourceId?: string;
  meetingId?: string;
  title?: string;
  excerpt?: string;
  url?: string;
  updatedAt?: string;
}

export interface GraphFactResult {
  factKey?: string;
  subjectKey?: string;
  relation?: string;
  objectKey?: string;
  evidenceId?: string;
  validFrom?: string;
  confidence?: number;
  active?: boolean;
  properties?: Record<string, unknown>;
  updatedAt?: string;
}

export interface GraphFactRow {
  fact?: GraphFactResult;
  subject?: GraphEntityResult;
  object?: GraphEntityResult;
  evidence?: GraphEvidenceResult;
}

export interface GraphRetirementResult {
  retirementKey?: string;
  subjectKey?: string;
  relation?: string;
  objectKey?: string;
  evidenceId?: string;
  validUntil?: string;
  reason?: string;
  updatedAt?: string;
}

export interface GraphRetirementRow {
  retirement?: GraphRetirementResult;
  evidence?: GraphEvidenceResult;
}

export interface GraphEntityContextResponse {
  enabled: boolean;
  entity?: GraphEntityResult | null;
  facts: GraphFactRow[];
  retirements: GraphRetirementRow[];
  error?: string;
}

export interface GraphTimelineResponse {
  enabled: boolean;
  stableKey?: string;
  events: Array<{ type: "fact" | "retirement"; at?: string; item: GraphFactRow | GraphRetirementRow }>;
  error?: string;
}

export interface GraphitiEpisodePayload {
  name: string;
  body: string;
  source: "json";
  sourceDescription: string;
  referenceTime: string;
  groupId: string;
}

export function getGraphMemoryStatus(): GraphMemoryStatus {
  return {
    enabled: process.env.PERRY_GRAPHITI_ENABLED === "true" && Boolean(process.env.PERRY_GRAPHITI_BRIDGE_URL),
    bridgeUrl: process.env.PERRY_GRAPHITI_BRIDGE_URL,
    groupId: process.env.PERRY_GRAPHITI_GROUP_ID ?? "doppel-labs",
    timeoutMs: Math.max(Number(process.env.PERRY_GRAPHITI_TIMEOUT_MS ?? 3000), 250),
    includePrivateNotes: process.env.PERRY_GRAPHITI_INCLUDE_PRIVATE_NOTES === "true",
    includeTranscript: process.env.PERRY_GRAPHITI_INCLUDE_TRANSCRIPT === "true",
    directChangeSets: process.env.PERRY_GRAPHITI_DIRECT_CHANGESETS === "true",
  };
}

export async function syncMeetingToGraphMemory(input: GraphMemorySyncInput): Promise<void> {
  const status = getGraphMemoryStatus();
  if (!status.enabled || !status.bridgeUrl) return;

  const payload = buildGraphitiMeetingEpisode(input, status.groupId);
  try {
    await postGraphitiEpisode(payload, status);
  } catch (error) {
    console.warn(`Graphiti episode sync failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function postGraphitiEpisode(
  payload: GraphitiEpisodePayload,
  status: GraphMemoryStatus = getGraphMemoryStatus()
): Promise<void> {
  if (!status.enabled || !status.bridgeUrl) return;
  if (status.directChangeSets) {
    const body = JSON.parse(payload.body) as { graphChangeSet?: GraphChangeSet };
    if (!body.graphChangeSet) throw new Error("Graphiti direct change-set sync failed: payload missing graphChangeSet");
    await postGraphChangeSet(body.graphChangeSet, payload.groupId, status);
    return;
  }

  const response = await fetchWithTimeout(`${trimSlash(status.bridgeUrl)}/episodes`, status.timeoutMs, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`Graphiti episode sync failed: ${response.status} ${await response.text()}`);
  }
}

export async function postGraphChangeSet(
  changeSet: GraphChangeSet,
  groupId: string,
  status: GraphMemoryStatus = getGraphMemoryStatus()
): Promise<unknown> {
  if (!status.enabled || !status.bridgeUrl) {
    throw new Error("Graphiti direct change-set sync failed: graph memory is disabled");
  }
  const response = await fetchWithTimeout(`${trimSlash(status.bridgeUrl)}/change-sets`, status.timeoutMs, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ groupId, changeSet }),
  });
  if (!response.ok) {
    throw new Error(`Graphiti direct change-set sync failed: ${response.status} ${await response.text()}`);
  }
  const text = await response.text();
  if (!text.trim()) return { ok: true };
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { ok: true, body: text };
  }
}
export async function searchGraphMemory(query: string, limit = 10): Promise<GraphMemorySearchResponse> {
  const status = getGraphMemoryStatus();
  const normalizedQuery = query.trim();
  if (!status.enabled || !status.bridgeUrl || !normalizedQuery) {
    return { enabled: status.enabled, results: [] };
  }

  try {
    const response = await fetchWithTimeout(`${trimSlash(status.bridgeUrl)}/search`, status.timeoutMs, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: normalizedQuery,
        groupId: status.groupId,
        limit: Math.min(Math.max(Math.trunc(limit), 1), 50),
      }),
    });
    if (!response.ok) {
      return { enabled: true, results: [], error: `Graphiti search failed: ${response.status}` };
    }
    const body = (await response.json()) as { results?: GraphMemorySearchResult[] };
    return { enabled: true, results: body.results ?? [] };
  } catch (error) {
    return { enabled: true, results: [], error: error instanceof Error ? error.message : String(error) };
  }
}

export async function listGraphEntities(options: {
  query?: string;
  type?: string;
  limit?: number;
} = {}): Promise<{ enabled: boolean; entities: GraphEntityResult[]; error?: string }> {
  const status = getGraphMemoryStatus();
  if (!status.enabled || !status.bridgeUrl) return { enabled: status.enabled, entities: [] };
  const params = new URLSearchParams({
    groupId: status.groupId,
    limit: String(clampLimit(options.limit ?? 25, 100)),
  });
  if (options.query) params.set("q", options.query);
  if (options.type) params.set("type", options.type);
  return graphGet<{ entities?: GraphEntityResult[] }, { enabled: boolean; entities: GraphEntityResult[]; error?: string }>(
    status,
    `/entities?${params.toString()}`,
    { enabled: status.enabled, entities: [] },
    (body) => ({
      enabled: true,
      entities: body.entities ?? [],
    })
  );
}

export async function listGraphFacts(options: {
  subject?: string;
  object?: string;
  relation?: string;
  active?: boolean;
  limit?: number;
} = {}): Promise<{ enabled: boolean; facts: GraphFactRow[]; error?: string }> {
  const status = getGraphMemoryStatus();
  if (!status.enabled || !status.bridgeUrl) return { enabled: status.enabled, facts: [] };
  const params = new URLSearchParams({
    groupId: status.groupId,
    limit: String(clampLimit(options.limit ?? 25, 100)),
  });
  if (options.subject) params.set("subject", options.subject);
  if (options.object) params.set("object", options.object);
  if (options.relation) params.set("relation", options.relation);
  if (typeof options.active === "boolean") params.set("active", String(options.active));
  return graphGet<{ facts?: GraphFactRow[] }, { enabled: boolean; facts: GraphFactRow[]; error?: string }>(
    status,
    `/facts?${params.toString()}`,
    { enabled: status.enabled, facts: [] },
    (body) => ({
      enabled: true,
      facts: body.facts ?? [],
    })
  );
}

export async function getGraphEvidence(evidenceId: string): Promise<{
  enabled: boolean;
  evidence?: GraphEvidenceResult | null;
  error?: string;
}> {
  const status = getGraphMemoryStatus();
  if (!status.enabled || !status.bridgeUrl || !evidenceId.trim()) {
    return { enabled: status.enabled, evidence: null };
  }
  const params = new URLSearchParams({ groupId: status.groupId, evidenceId: evidenceId.trim() });
  return graphGet<
    { evidence?: GraphEvidenceResult | null },
    { enabled: boolean; evidence?: GraphEvidenceResult | null; error?: string }
  >(status, `/evidence?${params.toString()}`, { enabled: status.enabled, evidence: null }, (body) => ({
    enabled: true,
    evidence: body.evidence ?? null,
  }));
}

export async function getGraphEntityContext(stableKey: string, limit = 25): Promise<GraphEntityContextResponse> {
  const status = getGraphMemoryStatus();
  if (!status.enabled || !status.bridgeUrl || !stableKey.trim()) {
    return { enabled: status.enabled, entity: null, facts: [], retirements: [] };
  }
  const params = new URLSearchParams({
    groupId: status.groupId,
    stableKey: stableKey.trim(),
    limit: String(clampLimit(limit, 100)),
  });
  return graphGet<
    { entity?: GraphEntityResult | null; facts?: GraphFactRow[]; retirements?: GraphRetirementRow[] },
    GraphEntityContextResponse
  >(
    status,
    `/entity-context?${params.toString()}`,
    { enabled: status.enabled, entity: null, facts: [], retirements: [] },
    (body) => ({
      enabled: true,
      entity: body.entity ?? null,
      facts: body.facts ?? [],
      retirements: body.retirements ?? [],
    })
  );
}

export async function getGraphTimeline(stableKey: string, limit = 50): Promise<GraphTimelineResponse> {
  const status = getGraphMemoryStatus();
  if (!status.enabled || !status.bridgeUrl || !stableKey.trim()) {
    return { enabled: status.enabled, stableKey: stableKey.trim(), events: [] };
  }
  const params = new URLSearchParams({
    groupId: status.groupId,
    stableKey: stableKey.trim(),
    limit: String(clampLimit(limit, 100)),
  });
  return graphGet<{ stableKey?: string; events?: GraphTimelineResponse["events"] }, GraphTimelineResponse>(
    status,
    `/timeline?${params.toString()}`,
    { enabled: status.enabled, stableKey: stableKey.trim(), events: [] },
    (body) => ({
      enabled: true,
      stableKey: body.stableKey ?? stableKey.trim(),
      events: body.events ?? [],
    })
  );
}

export function buildGraphitiMeetingEpisode(input: GraphMemorySyncInput, groupId = "doppel-labs"): GraphitiEpisodePayload {
  const referenceTime = validIso(input.note.startedAt) ?? input.record.updatedAt ?? new Date().toISOString();
  const status = getGraphMemoryStatus();
  const graphChangeSet = buildGraphChangeSet(input);
  const graphValidation = validateGraphChangeSet(graphChangeSet);
  const body = {
    kind: "meeting_note",
    source: input.note.source,
    sourceId: input.note.sourceId,
    title: input.note.title,
    creator: {
      name: input.note.creatorName,
      email: input.note.creatorEmail,
    },
    attendees: input.note.attendees,
    calendarTitle: input.note.calendarTitle,
    folderName: input.note.folderName,
    startedAt: input.note.startedAt,
    summaryMarkdown: input.note.summaryMarkdown,
    privateNotes: status.includePrivateNotes ? input.note.privateNotes : undefined,
    transcript: status.includeTranscript ? input.note.transcript : undefined,
    granolaUrl: input.note.sourceUrl,
    notionUrl: input.notionUrl ?? input.record.notionUrl,
    discordMessageUrl: input.discordMessageUrl ?? input.record.discordMessageUrl,
    route: input.route,
    decisions: input.knowledge.decisions,
    actionItems: input.knowledge.actionItems,
    graphChangeSet,
    graphValidation,
  };

  return {
    name: `perry-meeting-${input.record.id}`,
    body: JSON.stringify(body),
    source: "json",
    sourceDescription: "Perry Granola meeting note",
    referenceTime,
    groupId,
  };
}

export type { GraphChangeSet };

function validIso(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/u, "");
}

async function fetchWithTimeout(url: string, timeoutMs: number, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function graphGet<T, R extends { enabled: boolean; error?: string }>(
  status: GraphMemoryStatus,
  path: string,
  fallback: R,
  mapBody: (body: T) => R
): Promise<R> {
  if (!status.enabled || !status.bridgeUrl) return { ...fallback, enabled: status.enabled };
  try {
    const response = await fetchWithTimeout(`${trimSlash(status.bridgeUrl)}${path}`, status.timeoutMs, {
      method: "GET",
      headers: { accept: "application/json" },
    });
    if (!response.ok) return { ...fallback, enabled: true, error: `Graph read failed: ${response.status}` };
    return mapBody((await response.json()) as T);
  } catch (error) {
    return { ...fallback, enabled: true, error: error instanceof Error ? error.message : String(error) };
  }
}

function clampLimit(value: number, max: number): number {
  return Math.max(1, Math.min(Math.trunc(value), max));
}

