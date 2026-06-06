import {
  Bot,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Database,
  FileText,
  KeyRound,
  Loader2,
  MessageSquare,
  Plus,
  RefreshCw,
  Save,
  Send,
  Trash2,
  Users,
  Webhook,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type GranolaMode = "manual" | "zapier-webhook" | "api-poll";
type IssueStatus = "open" | "in_progress" | "blocked" | "done" | "canceled";
type IssuePriority = "low" | "normal" | "high" | "urgent";

interface PersonConfig {
  name: string;
  discordUserId: string;
  notionName?: string;
  notionUserId?: string;
  granolaEmail?: string;
  githubUsername?: string;
  team?: string;
  timezone?: string;
  isActive?: boolean;
}

interface RoutingRuleConfig {
  id: string;
  name: string;
  project?: string;
  titleKeywords: string[];
  attendeeEmails: string[];
  granolaFolderName?: string;
  discordChannelId?: string;
  notionDataSourceId?: string;
  publishMode: "approval" | "auto" | "draft";
  isActive: boolean;
}

interface AppSettings {
  discord: {
    clientId?: string;
    guildId?: string;
    standupChannelId?: string;
    meetingChannelId?: string;
    adminRoleIds: string[];
  };
  notion: {
    standupDataSourceId?: string;
    meetingNotesDataSourceId?: string;
    meetingNotesDatabaseUrl?: string;
  };
  standup: {
    enabled: boolean;
    standupTime: string;
    reminderTime: string;
    preStandupReminderTime: string;
    timezone: string;
    formUrl?: string;
  };
  granola: {
    mode: GranolaMode;
    folderName?: string;
    pollIntervalMinutes: number;
    defaultPublishMode: "approval" | "auto" | "draft";
  };
  roster: PersonConfig[];
  routingRules: RoutingRuleConfig[];
}

interface ConfigResponse {
  settings: AppSettings;
  secrets: Record<string, boolean>;
  graphMemory: {
    enabled: boolean;
    bridgeUrl?: string;
    groupId: string;
    timeoutMs: number;
  };
  configPath: string;
}

interface DiagnosticCheck {
  id: string;
  label: string;
  status: "ready" | "missing" | "warning";
  detail: string;
}

interface Diagnostics {
  checks: DiagnosticCheck[];
  ready: boolean;
  configPath: string;
  meetingStorePath: string;
  processedMeetingCount: number;
}

interface MeetingRecord {
  id: string;
  source: string;
  sourceId?: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  notionUrl?: string;
  discordMessageUrl?: string;
  status: "processed" | "dry-run" | "failed";
}

interface DecisionRecord {
  id: string;
  meetingId: string;
  text: string;
  status: "proposed" | "accepted" | "rejected";
  createdAt: string;
}

interface ActionItemRecord {
  id: string;
  meetingId: string;
  text: string;
  owner?: string;
  dueDate?: string;
  status: "open" | "done" | "wont-do";
  createdAt: string;
}

interface UserRecord {
  id: string;
  displayName: string;
  email?: string;
  discordUserId?: string;
  team?: string;
  isActive: boolean;
  updatedAt: string;
}

interface IssueRecord {
  id: string;
  project?: string;
  title: string;
  description?: string;
  status: IssueStatus;
  priority: IssuePriority;
  owner?: string;
  sourceMeetingId?: string;
  sourceActionId?: string;
  dueDate?: string;
  createdAt: string;
  updatedAt: string;
}

interface IssueEventRecord {
  id: string;
  issueId: string;
  type: "created" | "assigned" | "status_changed" | "commented" | "pivoted" | "updated";
  actor?: string;
  detailJson: string;
  meetingId?: string;
  createdAt: string;
}

interface PivotRecord {
  id: string;
  project?: string;
  subject: string;
  previousOwner?: string;
  newOwner?: string;
  fallbackReviewer?: string;
  reason: string;
  sourceDecisionId: string;
  sourceMeetingId: string;
  affectedIssueIds: string[];
  createdAt: string;
}

interface BrainSearchResult {
  type: "meeting" | "decision" | "action";
  id: string;
  meetingId?: string;
  title: string;
  snippet: string;
  url?: string;
  createdAt: string;
}

type OntologyType = "goal" | "metric" | "risk" | "blocker" | "open_question" | "capability" | "feature" | "artifact" | "benchmark_report";

interface OntologyEntityRecord {
  stableKey: string;
  type: OntologyType;
  name: string;
  aliases?: string[];
  evidenceIds: string[];
  sourceMeetingIds: string[];
  updatedAt?: string;
}

interface OntologySummaryResponse {
  summary: {
    changeSetCount: number;
    counts: Record<OntologyType, number>;
    topProjects: Array<{ project: string; linkedEntities: number }>;
  };
}

interface OntologyQueryResponse {
  type: OntologyType;
  project?: string;
  count: number;
  entities: OntologyEntityRecord[];
}

interface OntologyChangedSinceResponse {
  since: string;
  count: number;
  entities: OntologyEntityRecord[];
}

interface OntologyEvidenceResponse {
  stableKey: string;
  entity?: OntologyEntityRecord;
  evidence: GraphEvidenceResult[];
  relations: GraphFactResult[];
}

interface OntologyHealthResponse {
  ok: boolean;
  counts: {
    materializedEntities: number;
    materializedRelations: number;
    materializedEvidence: number;
    duplicateNameGroups: number;
    orphanedEvidence: number;
    relationsMissingEvidence: number;
    entitiesMissingEvidence: number;
    unprojectedEntities: number;
  };
  checks: Array<{ id: string; passed: boolean; severity: "pass" | "warning" | "critical"; detail: string }>;
}
interface GraphSearchResult {
  fact?: string;
  name?: string;
  uuid?: string;
  score?: number;
  raw?: unknown;
}

interface GraphSyncQueueSnapshot {
  stats: {
    queued: number;
    processing: number;
    completed: number;
    failed: number;
  };
  recent: Array<{
    id: string;
    entityId: string;
    status: "queued" | "processing" | "completed" | "failed";
    attempts: number;
    lastError?: string;
    createdAt: string;
    updatedAt: string;
    hasPayload: boolean;
    hasResult: boolean;
  }>;
}

interface GraphChangeSetSummary {
  id: string;
  meetingId: string;
  graphSyncJobId: string;
  groupId: string;
  validationStatus: "valid" | "invalid";
  validationErrorCount: number;
  validationWarningCount: number;
  applyStatus: "queued" | "applied" | "failed";
  appliedAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

interface GraphEntityResult {
  stableKey: string;
  type?: string;
  name?: string;
  aliases?: string[];
  properties?: Record<string, unknown>;
  evidenceIds?: string[];
  updatedAt?: string;
}

interface GraphEvidenceResult {
  evidenceId: string;
  title?: string;
  excerpt?: string;
  url?: string;
  source?: string;
  updatedAt?: string;
}

interface GraphFactResult {
  factKey?: string;
  subjectKey?: string;
  relation?: string;
  objectKey?: string;
  evidenceId?: string;
  validFrom?: string;
  active?: boolean;
  confidence?: number;
  properties?: Record<string, unknown>;
}

interface GraphFactRow {
  fact?: GraphFactResult;
  subject?: GraphEntityResult;
  object?: GraphEntityResult;
  evidence?: GraphEvidenceResult;
}

interface GraphRetirementRow {
  retirement?: {
    subjectKey?: string;
    relation?: string;
    objectKey?: string;
    evidenceId?: string;
    validUntil?: string;
    reason?: string;
  };
  evidence?: GraphEvidenceResult;
}

interface GraphEntityContextResponse {
  enabled: boolean;
  entity?: GraphEntityResult | null;
  facts: GraphFactRow[];
  retirements: GraphRetirementRow[];
  error?: string;
}

interface GraphTimelineResponse {
  enabled: boolean;
  stableKey?: string;
  events: Array<{ type: "fact" | "retirement"; at?: string; item: GraphFactRow | GraphRetirementRow }>;
  error?: string;
}

interface GraphReplayDiff {
  passed: boolean;
  checkedAt: string;
  expected: { entities: number; relations: number; retirements: number; evidence: number };
  missing: {
    entities: string[];
    relations: Array<{ subjectKey: string; relation: string; objectKey: string; evidenceId?: string }>;
    retirements: Array<{ subjectKey: string; relation: string; objectKey: string; evidenceId?: string }>;
    evidence: string[];
  };
  errors: string[];
}

interface ApprovalRecord {
  id: string;
  meetingId: string;
  title: string;
  announcement: string;
  routeProject?: string;
  routeReason?: string;
  publishMode?: string;
  decisionCount: number;
  actionItemCount: number;
  status: "pending" | "approved" | "rejected" | "posted";
  createdAt: string;
  updatedAt: string;
}

interface PreviewResult {
  duplicate: boolean;
  dryRun: boolean;
  announcement: string;
  record: MeetingRecord;
  notionUrl?: string;
  discordMessageUrl?: string;
}

const emptyPerson: PersonConfig = {
  name: "",
  discordUserId: "",
  notionName: "",
  team: "",
  timezone: "",
  granolaEmail: "",
  githubUsername: "",
  notionUserId: "",
  isActive: true,
};

const emptyIssueDraft = {
  title: "",
  project: "",
  owner: "",
  priority: "normal" as IssuePriority,
  dueDate: "",
};

export function App() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [secrets, setSecrets] = useState<Record<string, boolean>>({});
  const [graphMemory, setGraphMemory] = useState<ConfigResponse["graphMemory"] | null>(null);
  const [configPath, setConfigPath] = useState("");
  const [adminToken, setAdminToken] = useState("");
  const [webhookToken, setWebhookToken] = useState("");
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [history, setHistory] = useState<MeetingRecord[]>([]);
  const [decisions, setDecisions] = useState<DecisionRecord[]>([]);
  const [actionItems, setActionItems] = useState<ActionItemRecord[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRecord[]>([]);
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [issues, setIssues] = useState<IssueRecord[]>([]);
  const [pivots, setPivots] = useState<PivotRecord[]>([]);
  const [selectedIssueId, setSelectedIssueId] = useState("");
  const [issueEvents, setIssueEvents] = useState<IssueEventRecord[]>([]);
  const [issueDraft, setIssueDraft] = useState(emptyIssueDraft);
  const [issueComment, setIssueComment] = useState("");
  const [issueActionStatus, setIssueActionStatus] = useState<"idle" | "projecting" | "creating" | "updating">("idle");
  const [ontologySummary, setOntologySummary] = useState<OntologySummaryResponse["summary"] | null>(null);
  const [ontologyHealth, setOntologyHealth] = useState<OntologyHealthResponse | null>(null);
  const [ontologyType, setOntologyType] = useState<OntologyType>("risk");
  const [ontologyProject, setOntologyProject] = useState("Wallace");
  const [ontologyMode, setOntologyMode] = useState<"state" | "changed">("state");
  const [ontologyQuery, setOntologyQuery] = useState("");
  const [ontologySince, setOntologySince] = useState(() => defaultSinceInput());
  const [ontologyEntities, setOntologyEntities] = useState<OntologyEntityRecord[]>([]);
  const [ontologyCount, setOntologyCount] = useState(0);
  const [selectedOntologyEvidence, setSelectedOntologyEvidence] = useState<OntologyEvidenceResponse | null>(null);
  const [ontologyStatus, setOntologyStatus] = useState<"idle" | "loading" | "evidence">("idle");
  const [brainQuery, setBrainQuery] = useState("");
  const [brainResults, setBrainResults] = useState<BrainSearchResult[]>([]);
  const [graphQuery, setGraphQuery] = useState("");
  const [graphResults, setGraphResults] = useState<GraphSearchResult[]>([]);
  const [graphSyncQueue, setGraphSyncQueue] = useState<GraphSyncQueueSnapshot | null>(null);
  const [graphChangeSets, setGraphChangeSets] = useState<GraphChangeSetSummary[]>([]);
  const [graphEntityQuery, setGraphEntityQuery] = useState("wallace");
  const [graphEntities, setGraphEntities] = useState<GraphEntityResult[]>([]);
  const [graphFacts, setGraphFacts] = useState<GraphFactRow[]>([]);
  const [selectedGraphEntityKey, setSelectedGraphEntityKey] = useState("");
  const [graphEntityContext, setGraphEntityContext] = useState<GraphEntityContextResponse | null>(null);
  const [graphTimeline, setGraphTimeline] = useState<GraphTimelineResponse | null>(null);
  const [graphActionStatus, setGraphActionStatus] = useState<"idle" | "backfilling" | "draining">("idle");
  const [replayingGraphChangeSetId, setReplayingGraphChangeSetId] = useState("");
  const [lastGraphReplayDiff, setLastGraphReplayDiff] = useState<GraphReplayDiff | null>(null);
  const [samplePayload, setSamplePayload] = useState("");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewStatus, setPreviewStatus] = useState<"idle" | "loading" | "posting">("idle");
  const [status, setStatus] = useState<"idle" | "loading" | "saving" | "saved" | "error">("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    void loadEverything();
  }, []);

  const activeRosterCount = useMemo(
    () => settings?.roster.filter((person) => person.isActive !== false).length ?? 0,
    [settings]
  );
  const openIssueCount = useMemo(() => issues.filter((issue) => issue.status !== "done" && issue.status !== "canceled").length, [issues]);
  const selectedIssue = useMemo(
    () => issues.find((issue) => issue.id === selectedIssueId) ?? issues[0],
    [issues, selectedIssueId]
  );

  async function loadEverything() {
    setStatus("loading");
    setError("");
    try {
      const [
        configResponse,
        diagnosticsResponse,
        historyResponse,
        decisionsResponse,
        actionsResponse,
        approvalsResponse,
        usersResponse,
        issuesResponse,
        pivotsResponse,
        graphSyncResponse,
        graphChangeSetsResponse,
        graphEntitiesResponse,
        graphFactsResponse,
        sampleResponse,
      ] =
        await Promise.all([
        fetch("/api/config"),
        fetch("/api/diagnostics"),
        fetch("/api/meetings/history"),
        fetch("/api/brain/decisions?limit=12"),
        fetch("/api/brain/actions?limit=12"),
        fetch("/api/approvals?status=pending"),
        fetch("/api/users?limit=24"),
        fetch("/api/issues?limit=24&status=open"),
        fetch("/api/pivots?limit=8"),
        fetch("/api/graph-sync/jobs?limit=5"),
        fetch("/api/graph-sync/change-sets?limit=8"),
        fetch("/api/brain/graph/entities?q=wallace&limit=8"),
        fetch("/api/brain/graph/facts?active=true&limit=8"),
        fetch("/api/granola/sample"),
      ]);
      if (!configResponse.ok) throw new Error(`Config load failed: ${configResponse.status}`);
      if (!diagnosticsResponse.ok) throw new Error(`Diagnostics load failed: ${diagnosticsResponse.status}`);
      if (!historyResponse.ok) throw new Error(`History load failed: ${historyResponse.status}`);
      if (!decisionsResponse.ok) throw new Error(`Decisions load failed: ${decisionsResponse.status}`);
      if (!actionsResponse.ok) throw new Error(`Action items load failed: ${actionsResponse.status}`);
      if (!approvalsResponse.ok) throw new Error(`Approvals load failed: ${approvalsResponse.status}`);
      if (!usersResponse.ok) throw new Error(`Users load failed: ${usersResponse.status}`);
      if (!issuesResponse.ok) throw new Error(`Issues load failed: ${issuesResponse.status}`);
      if (!pivotsResponse.ok) throw new Error(`Pivots load failed: ${pivotsResponse.status}`);
      if (!graphSyncResponse.ok) throw new Error(`Graph sync load failed: ${graphSyncResponse.status}`);
      if (!graphChangeSetsResponse.ok) throw new Error(`Graph change sets load failed: ${graphChangeSetsResponse.status}`);
      if (!graphEntitiesResponse.ok) throw new Error(`Graph entities load failed: ${graphEntitiesResponse.status}`);
      if (!graphFactsResponse.ok) throw new Error(`Graph facts load failed: ${graphFactsResponse.status}`);
      if (!sampleResponse.ok) throw new Error(`Sample load failed: ${sampleResponse.status}`);
      const payload = (await configResponse.json()) as ConfigResponse;
      setSettings(payload.settings);
      setSecrets(payload.secrets);
      setGraphMemory(payload.graphMemory);
      setConfigPath(payload.configPath);
      setDiagnostics((await diagnosticsResponse.json()) as Diagnostics);
      setHistory(((await historyResponse.json()) as { records: MeetingRecord[] }).records);
      setDecisions(((await decisionsResponse.json()) as { records: DecisionRecord[] }).records);
      setActionItems(((await actionsResponse.json()) as { records: ActionItemRecord[] }).records);
      setApprovals(((await approvalsResponse.json()) as { records: ApprovalRecord[] }).records);
      setUsers(((await usersResponse.json()) as { records: UserRecord[] }).records);
      const loadedIssues = ((await issuesResponse.json()) as { records: IssueRecord[] }).records;
      setIssues(loadedIssues);
      if (loadedIssues.length > 0 && !selectedIssueId) {
        setSelectedIssueId(loadedIssues[0].id);
        void refreshIssueEvents(loadedIssues[0].id);
      }
      setPivots(((await pivotsResponse.json()) as { records: PivotRecord[] }).records);
      setGraphSyncQueue((await graphSyncResponse.json()) as GraphSyncQueueSnapshot);
      setGraphChangeSets(((await graphChangeSetsResponse.json()) as { records: GraphChangeSetSummary[] }).records);
      const loadedGraphEntities = ((await graphEntitiesResponse.json()) as { entities: GraphEntityResult[] }).entities;
      setGraphEntities(loadedGraphEntities);
      setGraphFacts(((await graphFactsResponse.json()) as { facts: GraphFactRow[] }).facts);
      if (loadedGraphEntities.length > 0) {
        setSelectedGraphEntityKey(loadedGraphEntities[0].stableKey);
        void refreshGraphEntityContext(loadedGraphEntities[0].stableKey);
      }
      setSamplePayload(JSON.stringify(await sampleResponse.json(), null, 2));
      void refreshOntology();
      setStatus("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Config load failed");
      setStatus("error");
    }
  }

  async function saveConfig() {
    if (!settings) return;
    setStatus("saving");
    setError("");
    try {
      const response = await fetch("/api/config", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          ...(adminToken ? { authorization: `Bearer ${adminToken}` } : {}),
        },
        body: JSON.stringify({ settings }),
      });
      if (!response.ok) throw new Error(`Save failed: ${response.status}`);
      const payload = (await response.json()) as Pick<ConfigResponse, "settings" | "configPath">;
      setSettings(payload.settings);
      setConfigPath(payload.configPath);
      await refreshOperations();
      setStatus("saved");
      window.setTimeout(() => setStatus("idle"), 1600);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      setStatus("error");
    }
  }

  async function refreshOperations() {
    const [
      diagnosticsResponse,
      historyResponse,
      decisionsResponse,
      actionsResponse,
      approvalsResponse,
      usersResponse,
      issuesResponse,
      pivotsResponse,
      graphSyncResponse,
      graphChangeSetsResponse,
      graphEntitiesResponse,
      graphFactsResponse,
    ] = await Promise.all([
      fetch("/api/diagnostics"),
      fetch("/api/meetings/history"),
      fetch("/api/brain/decisions?limit=12"),
      fetch("/api/brain/actions?limit=12"),
      fetch("/api/approvals?status=pending"),
      fetch("/api/users?limit=24"),
      fetch("/api/issues?limit=24&status=open"),
      fetch("/api/pivots?limit=8"),
      fetch("/api/graph-sync/jobs?limit=5"),
      fetch("/api/graph-sync/change-sets?limit=8"),
      fetch(`/api/brain/graph/entities?q=${encodeURIComponent(graphEntityQuery)}&limit=8`),
      fetch("/api/brain/graph/facts?active=true&limit=8"),
    ]);
    if (diagnosticsResponse.ok) setDiagnostics((await diagnosticsResponse.json()) as Diagnostics);
    if (historyResponse.ok) setHistory(((await historyResponse.json()) as { records: MeetingRecord[] }).records);
    if (decisionsResponse.ok) setDecisions(((await decisionsResponse.json()) as { records: DecisionRecord[] }).records);
    if (actionsResponse.ok) setActionItems(((await actionsResponse.json()) as { records: ActionItemRecord[] }).records);
    if (approvalsResponse.ok) setApprovals(((await approvalsResponse.json()) as { records: ApprovalRecord[] }).records);
    if (usersResponse.ok) setUsers(((await usersResponse.json()) as { records: UserRecord[] }).records);
    if (issuesResponse.ok) {
      const loadedIssues = ((await issuesResponse.json()) as { records: IssueRecord[] }).records;
      setIssues(loadedIssues);
      if (!selectedIssueId && loadedIssues.length > 0) setSelectedIssueId(loadedIssues[0].id);
    }
    if (pivotsResponse.ok) setPivots(((await pivotsResponse.json()) as { records: PivotRecord[] }).records);
    if (graphSyncResponse.ok) setGraphSyncQueue((await graphSyncResponse.json()) as GraphSyncQueueSnapshot);
    if (graphChangeSetsResponse.ok) {
      setGraphChangeSets(((await graphChangeSetsResponse.json()) as { records: GraphChangeSetSummary[] }).records);
    }
    if (graphEntitiesResponse.ok) setGraphEntities(((await graphEntitiesResponse.json()) as { entities: GraphEntityResult[] }).entities);
    if (graphFactsResponse.ok) setGraphFacts(((await graphFactsResponse.json()) as { facts: GraphFactRow[] }).facts);
    if (selectedIssueId) await refreshIssueEvents(selectedIssueId);
    if (selectedGraphEntityKey) await refreshGraphEntityContext(selectedGraphEntityKey);
    void refreshOntology();
  }

  async function actOnApproval(id: string, action: "approve" | "reject") {
    setError("");
    const response = await fetch(`/api/approvals/${encodeURIComponent(id)}/${action}`, {
      method: "POST",
      headers: {
        ...(adminToken ? { authorization: `Bearer ${adminToken}` } : {}),
      },
    });
    if (!response.ok) {
      setError(`${action} failed: ${response.status}`);
      return;
    }
    await refreshOperations();
  }

  async function projectMultiplayer() {
    setIssueActionStatus("projecting");
    setError("");
    try {
      const response = await fetch("/api/brain/project-multiplayer?limit=25000", {
        method: "POST",
        headers: {
          ...(adminToken ? { authorization: `Bearer ${adminToken}` } : {}),
        },
      });
      if (!response.ok) throw new Error(`Projection failed: ${response.status}`);
      await refreshOperations();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Projection failed");
    } finally {
      setIssueActionStatus("idle");
    }
  }

  async function createIssue() {
    if (!issueDraft.title.trim()) return;
    setIssueActionStatus("creating");
    setError("");
    try {
      const response = await fetch("/api/issues", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(adminToken ? { authorization: `Bearer ${adminToken}` } : {}),
        },
        body: JSON.stringify({
          title: issueDraft.title,
          project: issueDraft.project,
          owner: issueDraft.owner,
          priority: issueDraft.priority,
          dueDate: issueDraft.dueDate,
        }),
      });
      if (!response.ok) throw new Error(`Issue create failed: ${response.status}`);
      const payload = (await response.json()) as { issue: IssueRecord };
      setIssueDraft(emptyIssueDraft);
      setSelectedIssueId(payload.issue.id);
      await refreshOperations();
      await refreshIssueEvents(payload.issue.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Issue create failed");
    } finally {
      setIssueActionStatus("idle");
    }
  }

  async function patchIssue(issue: IssueRecord, patch: Partial<IssueRecord> & { comment?: string }) {
    setIssueActionStatus("updating");
    setError("");
    try {
      const response = await fetch(`/api/issues/${encodeURIComponent(issue.id)}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          ...(adminToken ? { authorization: `Bearer ${adminToken}` } : {}),
        },
        body: JSON.stringify({ ...patch, actor: "Perry Admin" }),
      });
      if (!response.ok) throw new Error(`Issue update failed: ${response.status}`);
      const payload = (await response.json()) as { issue: IssueRecord; events: IssueEventRecord[] };
      setIssues((current) => current.map((item) => (item.id === payload.issue.id ? payload.issue : item)));
      setIssueEvents(payload.events);
      setIssueComment("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Issue update failed");
    } finally {
      setIssueActionStatus("idle");
    }
  }

  async function refreshIssueEvents(issueId: string) {
    const response = await fetch(`/api/issues/${encodeURIComponent(issueId)}/events?limit=50`);
    if (response.ok) setIssueEvents(((await response.json()) as { records: IssueEventRecord[] }).records);
  }

  async function refreshOntology(
    nextType = ontologyType,
    nextProject = ontologyProject,
    nextMode = ontologyMode,
    nextQuery = ontologyQuery
  ) {
    setOntologyStatus("loading");
    const params = new URLSearchParams({ limit: "8" });
    if (nextProject.trim()) params.set("project", nextProject.trim());
    if (nextQuery.trim()) params.set("q", nextQuery.trim());
    const queryUrl =
      nextMode === "changed"
        ? (() => {
            params.set("since", apiSince(ontologySince));
            return `/api/brain/ontology/changed-since?${params.toString()}`;
          })()
        : (() => {
            params.set("type", nextType);
            return `/api/brain/ontology?${params.toString()}`;
          })();
    const [summaryResponse, queryResponse, healthResponse] = await Promise.all([
      fetch("/api/brain/ontology"),
      fetch(queryUrl),
      fetch("/api/brain/ontology/health?changeSetLimit=100"),
    ]);
    if (summaryResponse.ok) setOntologySummary(((await summaryResponse.json()) as OntologySummaryResponse).summary);
    if (healthResponse.ok) setOntologyHealth((await healthResponse.json()) as OntologyHealthResponse);
    if (queryResponse.ok) {
      const payload = (await queryResponse.json()) as OntologyQueryResponse | OntologyChangedSinceResponse;
      setOntologyCount(payload.count);
      setOntologyEntities(payload.entities);
      if (selectedOntologyEvidence && !payload.entities.some((entity) => entity.stableKey === selectedOntologyEvidence.stableKey)) {
        setSelectedOntologyEvidence(null);
      }
    }
    setOntologyStatus("idle");
  }

  async function loadOntologyEvidence(stableKey: string) {
    setOntologyStatus("evidence");
    const response = await fetch(`/api/brain/ontology/evidence?stableKey=${encodeURIComponent(stableKey)}`);
    if (!response.ok) {
      setError(`Ontology evidence failed: ${response.status}`);
      setOntologyStatus("idle");
      return;
    }
    setSelectedOntologyEvidence((await response.json()) as OntologyEvidenceResponse);
    setOntologyStatus("idle");
  }
  async function searchBrain() {
    if (!brainQuery.trim()) {
      setBrainResults([]);
      return;
    }
    const response = await fetch(`/api/brain/search?q=${encodeURIComponent(brainQuery)}&limit=10`);
    if (!response.ok) {
      setError(`Brain search failed: ${response.status}`);
      return;
    }
    setBrainResults(((await response.json()) as { results: BrainSearchResult[] }).results);
  }

  async function searchGraph() {
    if (!graphQuery.trim()) {
      setGraphResults([]);
      return;
    }
    const response = await fetch(`/api/brain/graph/search?q=${encodeURIComponent(graphQuery)}&limit=10`);
    if (!response.ok) {
      setError(`Graph search failed: ${response.status}`);
      return;
    }
    const payload = (await response.json()) as { enabled: boolean; results: GraphSearchResult[]; error?: string };
    if (payload.error) setError(payload.error);
    setGraphResults(payload.results);
  }

  async function searchGraphEntities() {
    const response = await fetch(`/api/brain/graph/entities?q=${encodeURIComponent(graphEntityQuery)}&limit=12`);
    if (!response.ok) {
      setError(`Graph entity search failed: ${response.status}`);
      return;
    }
    const payload = (await response.json()) as { enabled: boolean; entities: GraphEntityResult[]; error?: string };
    if (payload.error) setError(payload.error);
    setGraphEntities(payload.entities);
    if (payload.entities[0]) {
      setSelectedGraphEntityKey(payload.entities[0].stableKey);
      await refreshGraphEntityContext(payload.entities[0].stableKey);
    } else {
      setSelectedGraphEntityKey("");
      setGraphEntityContext(null);
      setGraphTimeline(null);
    }
  }

  async function refreshGraphEntityContext(stableKey: string) {
    const encoded = encodeURIComponent(stableKey);
    const [contextResponse, timelineResponse] = await Promise.all([
      fetch(`/api/brain/graph/entities/${encoded}/context?limit=12`),
      fetch(`/api/brain/graph/timeline?stableKey=${encoded}&limit=12`),
    ]);
    if (contextResponse.ok) {
      const payload = (await contextResponse.json()) as GraphEntityContextResponse;
      if (payload.error) setError(payload.error);
      setGraphEntityContext(payload);
    }
    if (timelineResponse.ok) {
      const payload = (await timelineResponse.json()) as GraphTimelineResponse;
      if (payload.error) setError(payload.error);
      setGraphTimeline(payload);
    }
  }

  async function enqueueGraphBackfill() {
    setGraphActionStatus("backfilling");
    setError("");
    try {
      const response = await fetch("/api/graph-sync/backfill?limit=500", {
        method: "POST",
        headers: {
          ...(adminToken ? { authorization: `Bearer ${adminToken}` } : {}),
        },
      });
      if (!response.ok) throw new Error(`Graph backfill failed: ${response.status}`);
      await refreshOperations();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Graph backfill failed");
    } finally {
      setGraphActionStatus("idle");
    }
  }

  async function drainGraphSync() {
    setGraphActionStatus("draining");
    setError("");
    try {
      const response = await fetch("/api/graph-sync/drain?limit=25", {
        method: "POST",
        headers: {
          ...(adminToken ? { authorization: `Bearer ${adminToken}` } : {}),
        },
      });
      if (!response.ok) throw new Error(`Graph drain failed: ${response.status}`);
      await refreshOperations();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Graph drain failed");
    } finally {
      setGraphActionStatus("idle");
    }
  }
  async function replayGraphChangeSet(id: string) {
    setReplayingGraphChangeSetId(id);
    setError("");
    try {
      const response = await fetch(`/api/graph-sync/change-sets/${encodeURIComponent(id)}/replay`, {
        method: "POST",
        headers: {
          ...(adminToken ? { authorization: `Bearer ${adminToken}` } : {}),
        },
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? `Graph replay failed: ${response.status}`);
      }
      const payload = (await response.json()) as { replay?: { diff?: GraphReplayDiff } };
      setLastGraphReplayDiff(payload.replay?.diff ?? null);
      await refreshOperations();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Graph replay failed");
    } finally {
      setReplayingGraphChangeSetId("");
    }
  }

  async function previewSample() {
    setPreviewStatus("loading");
    setError("");
    try {
      const response = await fetch("/api/granola/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: samplePayload,
      });
      if (!response.ok) throw new Error(`Preview failed: ${response.status}`);
      setPreview((await response.json()) as PreviewResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preview failed");
    } finally {
      setPreviewStatus("idle");
    }
  }

  async function dryRunSample() {
    setPreviewStatus("posting");
    setError("");
    try {
      const response = await fetch("/api/granola/zapier?dryRun=true", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(webhookToken ? { "x-perry-webhook-token": webhookToken } : {}),
        },
        body: samplePayload,
      });
      if (!response.ok) throw new Error(`Dry run failed: ${response.status}`);
      setPreview((await response.json()) as PreviewResult);
      await refreshOperations();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Dry run failed");
    } finally {
      setPreviewStatus("idle");
    }
  }

  if (!settings) {
    return (
      <main className="shell">
        <div className="loading">
          <Loader2 className="spin" size={24} />
          <span>Loading Perry</span>
        </div>
      </main>
    );
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">Doppel Labs</div>
          <h1>Perry Admin</h1>
        </div>
        <div className="top-actions">
          <input
            aria-label="Admin API token"
            className="token-input"
            placeholder="Admin token"
            type="password"
            value={adminToken}
            onChange={(event) => setAdminToken(event.target.value)}
          />
          <button className="primary" onClick={saveConfig} disabled={status === "saving"}>
            {status === "saving" ? <Loader2 className="spin" size={18} /> : <Save size={18} />}
            <span>{status === "saving" ? "Saving" : "Save"}</span>
          </button>
        </div>
      </header>

      {error ? <div className="alert">{error}</div> : null}
      {status === "saved" ? <div className="success">Saved to {configPath}</div> : null}

      <section className="metrics">
        <Metric icon={<Bot size={20} />} label="Readiness" value={diagnostics?.ready ? "Ready" : "Needs setup"} />
        <Metric icon={<Database size={20} />} label="Notion" value={secrets.notionToken ? "Token set" : "Token missing"} />
        <Metric icon={<Webhook size={20} />} label="Granola" value={settings.granola.mode} />
        <Metric icon={<Database size={20} />} label="Graphiti" value={graphMemory?.enabled ? graphMemory.groupId : "Off"} />
        <Metric icon={<Users size={20} />} label="Roster" value={`${activeRosterCount} active`} />
        <Metric icon={<ClipboardList size={20} />} label="Issues" value={`${openIssueCount} open`} />
      </section>

      <section className="ops-grid">
        <div className="panel readiness-panel">
          <div className="panel-head">
            <SectionTitle icon={<ClipboardList size={19} />} title="Readiness" />
            <button className="secondary" onClick={refreshOperations}>
              <RefreshCw size={17} />
              <span>Refresh</span>
            </button>
          </div>
          <div className="checklist">
            {diagnostics?.checks.map((check) => (
              <div className={`check ${check.status}`} key={check.id}>
                <span className="dot" />
                <div>
                  <strong>{check.label}</strong>
                  <p>{check.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="panel testbench-panel">
          <SectionTitle icon={<Send size={19} />} title="Granola Test Bench" />
          <input
            aria-label="Granola webhook token"
            placeholder="Webhook token"
            type="password"
            value={webhookToken}
            onChange={(event) => setWebhookToken(event.target.value)}
          />
          <textarea
            aria-label="Granola sample payload"
            value={samplePayload}
            onChange={(event) => setSamplePayload(event.target.value)}
          />
          <div className="button-row">
            <button className="secondary" onClick={previewSample} disabled={previewStatus !== "idle"}>
              {previewStatus === "loading" ? <Loader2 className="spin" size={17} /> : <FileText size={17} />}
              <span>Preview</span>
            </button>
            <button className="secondary" onClick={dryRunSample} disabled={previewStatus !== "idle"}>
              {previewStatus === "posting" ? <Loader2 className="spin" size={17} /> : <Webhook size={17} />}
              <span>Dry Run</span>
            </button>
          </div>
          {preview ? (
            <div className="preview">
              <div className="preview-meta">
                <span>{preview.duplicate ? "Duplicate" : "New note"}</span>
                <span>{preview.dryRun ? "Dry run" : "Live"}</span>
              </div>
              <pre>{preview.announcement}</pre>
            </div>
          ) : null}
        </div>
      </section>

      <section className="panel approvals-panel">
        <div className="panel-head">
          <SectionTitle icon={<ClipboardList size={19} />} title="Approval Queue" />
          <span className="subtle">{approvals.length} pending</span>
        </div>
        <div className="approval-list">
          {approvals.length === 0 ? (
            <div className="empty">Incoming notes that need review will appear here.</div>
          ) : (
            approvals.map((approval) => {
              return (
                <div className="approval-item" key={approval.id}>
                  <div className="approval-copy">
                    <strong>{approval.title}</strong>
                    <p>{approval.routeReason ?? approval.routeProject ?? "Default route"}</p>
                    <p>
                      {approval.decisionCount} decisions · {approval.actionItemCount} actions
                    </p>
                  </div>
                  <div className="button-row">
                    <button className="secondary" onClick={() => void actOnApproval(approval.id, "reject")}>
                      <Trash2 size={17} />
                      <span>Reject</span>
                    </button>
                    <button className="primary" onClick={() => void actOnApproval(approval.id, "approve")}>
                      <Send size={17} />
                      <span>Approve</span>
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>

      <section className="panel multiplayer-panel">
        <div className="panel-head">
          <SectionTitle icon={<Users size={19} />} title="Multiplayer Brain" />
          <div className="button-row">
            <span className="subtle">
              {users.length} users | {issues.length} open issues | {pivots.length} pivots
            </span>
            <button className="secondary" onClick={() => void projectMultiplayer()} disabled={issueActionStatus !== "idle"}>
              {issueActionStatus === "projecting" ? <Loader2 className="spin" size={17} /> : <RefreshCw size={17} />}
              <span>Project</span>
            </button>
          </div>
        </div>
        <div className="multiplayer-grid">
          <div className="issue-create">
            <Field label="Issue" value={issueDraft.title} onChange={(value) => setIssueDraft((current) => ({ ...current, title: value }))} />
            <Field label="Project" value={issueDraft.project} onChange={(value) => setIssueDraft((current) => ({ ...current, project: value }))} />
            <label className="field">
              <span>Owner</span>
              <select value={issueDraft.owner} onChange={(event) => setIssueDraft((current) => ({ ...current, owner: event.target.value }))}>
                <option value="">Unassigned</option>
                {users.map((user) => (
                  <option value={user.displayName} key={user.id}>
                    {user.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Priority</span>
              <select
                value={issueDraft.priority}
                onChange={(event) => setIssueDraft((current) => ({ ...current, priority: event.target.value as IssuePriority }))}
              >
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </label>
            <Field label="Due" value={issueDraft.dueDate} onChange={(value) => setIssueDraft((current) => ({ ...current, dueDate: value }))} />
            <button className="primary" onClick={() => void createIssue()} disabled={issueActionStatus !== "idle" || !issueDraft.title.trim()}>
              {issueActionStatus === "creating" ? <Loader2 className="spin" size={17} /> : <Plus size={17} />}
              <span>Create</span>
            </button>
          </div>

          <div className="issue-list">
            {issues.length === 0 ? (
              <div className="empty">Project meetings into issues or create one manually.</div>
            ) : (
              issues.map((issue) => (
                <button
                  className={`issue-row ${selectedIssue?.id === issue.id ? "selected" : ""}`}
                  key={issue.id}
                  onClick={() => {
                    setSelectedIssueId(issue.id);
                    void refreshIssueEvents(issue.id);
                  }}
                >
                  <span className={`pill ${issue.status}`}>{issue.status.replace("_", " ")}</span>
                  <strong>{issue.title}</strong>
                  <small>{[issue.project, issue.owner, issue.priority].filter(Boolean).join(" | ")}</small>
                </button>
              ))
            )}
          </div>

          <div className="issue-detail">
            {selectedIssue ? (
              <>
                <div className="issue-title-row">
                  <strong>{selectedIssue.title}</strong>
                  <span className={`pill ${selectedIssue.priority}`}>{selectedIssue.priority}</span>
                </div>
                <div className="split">
                  <label className="field">
                    <span>Status</span>
                    <select
                      value={selectedIssue.status}
                      onChange={(event) => void patchIssue(selectedIssue, { status: event.target.value as IssueStatus })}
                    >
                      <option value="open">Open</option>
                      <option value="in_progress">In progress</option>
                      <option value="blocked">Blocked</option>
                      <option value="done">Done</option>
                      <option value="canceled">Canceled</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Owner</span>
                    <select value={selectedIssue.owner ?? ""} onChange={(event) => void patchIssue(selectedIssue, { owner: event.target.value })}>
                      <option value="">Unassigned</option>
                      {users.map((user) => (
                        <option value={user.displayName} key={user.id}>
                          {user.displayName}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="comment-row">
                  <input
                    aria-label="Issue comment"
                    placeholder="Add comment"
                    value={issueComment}
                    onChange={(event) => setIssueComment(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && issueComment.trim()) void patchIssue(selectedIssue, { comment: issueComment });
                    }}
                  />
                  <button className="secondary" onClick={() => void patchIssue(selectedIssue, { comment: issueComment })} disabled={!issueComment.trim()}>
                    <MessageSquare size={17} />
                    <span>Comment</span>
                  </button>
                </div>
                <div className="event-list">
                  {issueEvents.length === 0 ? (
                    <div className="empty">No events for this issue yet.</div>
                  ) : (
                    issueEvents.map((event) => (
                      <div className="event-row" key={event.id}>
                        <span className={`pill ${event.type}`}>{event.type.replace("_", " ")}</span>
                        <p>{formatIssueEvent(event)}</p>
                      </div>
                    ))
                  )}
                </div>
              </>
            ) : (
              <div className="empty">Select an issue to manage ownership, status, and discussion.</div>
            )}
          </div>
        </div>
        <div className="pivot-strip">
          {pivots.length === 0 ? (
            <div className="empty">Ownership changes inferred from decisions will appear here.</div>
          ) : (
            pivots.map((pivot) => (
              <div className="pivot-item" key={pivot.id}>
                <strong>{pivot.subject}</strong>
                <p>{[pivot.previousOwner, pivot.newOwner].filter(Boolean).join(" -> ") || pivot.reason}</p>
              </div>
            ))
          )}
        </div>
      </section>

      <div className="grid">
        <section className="panel">
          <SectionTitle icon={<MessageSquare size={19} />} title="Discord" />
          <Field label="Client ID" value={settings.discord.clientId ?? ""} onChange={(value) => update("discord", "clientId", value)} />
          <Field label="Guild ID" value={settings.discord.guildId ?? ""} onChange={(value) => update("discord", "guildId", value)} />
          <Field
            label="Standup Channel ID"
            value={settings.discord.standupChannelId ?? ""}
            onChange={(value) => update("discord", "standupChannelId", value)}
          />
          <Field
            label="Meeting Channel ID"
            value={settings.discord.meetingChannelId ?? ""}
            onChange={(value) => update("discord", "meetingChannelId", value)}
          />
          <Field
            label="Admin Role IDs"
            value={settings.discord.adminRoleIds.join(", ")}
            onChange={(value) =>
              update(
                "discord",
                "adminRoleIds",
                value
                  .split(",")
                  .map((item) => item.trim())
                  .filter(Boolean)
              )
            }
          />
        </section>

        <section className="panel">
          <SectionTitle icon={<Database size={19} />} title="Notion" />
          <Field
            label="Standup Data Source ID"
            value={settings.notion.standupDataSourceId ?? ""}
            onChange={(value) => update("notion", "standupDataSourceId", value)}
          />
          <Field
            label="Meeting Notes Data Source ID"
            value={settings.notion.meetingNotesDataSourceId ?? ""}
            onChange={(value) => update("notion", "meetingNotesDataSourceId", value)}
          />
          <Field
            label="Meeting Notes Database URL"
            value={settings.notion.meetingNotesDatabaseUrl ?? ""}
            onChange={(value) => update("notion", "meetingNotesDatabaseUrl", value)}
          />
        </section>

        <section className="panel">
          <SectionTitle icon={<CalendarClock size={19} />} title="Standup" />
          <label className="switch-row">
            <span>Enabled</span>
            <input
              type="checkbox"
              checked={settings.standup.enabled}
              onChange={(event) => update("standup", "enabled", event.target.checked)}
            />
          </label>
          <div className="split">
            <Field label="Reminder" type="time" value={settings.standup.reminderTime} onChange={(value) => update("standup", "reminderTime", value)} />
            <Field
              label="Pre-standup"
              type="time"
              value={settings.standup.preStandupReminderTime}
              onChange={(value) => update("standup", "preStandupReminderTime", value)}
            />
          </div>
          <Field label="Standup Time" type="time" value={settings.standup.standupTime} onChange={(value) => update("standup", "standupTime", value)} />
          <Field label="Timezone" value={settings.standup.timezone} onChange={(value) => update("standup", "timezone", value)} />
          <Field label="Form URL" value={settings.standup.formUrl ?? ""} onChange={(value) => update("standup", "formUrl", value)} />
        </section>

        <section className="panel">
          <SectionTitle icon={<Webhook size={19} />} title="Granola" />
          <label className="field">
            <span>Mode</span>
            <select value={settings.granola.mode} onChange={(event) => update("granola", "mode", event.target.value as GranolaMode)}>
              <option value="manual">Manual</option>
              <option value="zapier-webhook">Zapier Webhook</option>
              <option value="api-poll">API Poll</option>
            </select>
          </label>
          <label className="field">
            <span>Default Publishing</span>
            <select
              value={settings.granola.defaultPublishMode}
              onChange={(event) =>
                update("granola", "defaultPublishMode", event.target.value as AppSettings["granola"]["defaultPublishMode"])
              }
            >
              <option value="approval">Approval</option>
              <option value="auto">Auto Post</option>
              <option value="draft">Draft Only</option>
            </select>
          </label>
          <Field label="Folder Name" value={settings.granola.folderName ?? ""} onChange={(value) => update("granola", "folderName", value)} />
          <Field
            label="Poll Interval"
            type="number"
            value={String(settings.granola.pollIntervalMinutes)}
            onChange={(value) => update("granola", "pollIntervalMinutes", Number(value))}
          />
        </section>
      </div>

      <section className="panel routing-panel">
        <div className="panel-head">
          <SectionTitle icon={<Webhook size={19} />} title="Routing Rules" />
          <button className="secondary" onClick={addRoutingRule}>
            <Plus size={17} />
            <span>Add</span>
          </button>
        </div>
        <div className="routing-list">
          {settings.routingRules.length === 0 ? (
            <div className="empty">Add rules to route Granola folders, keywords, or attendees to project channels.</div>
          ) : (
            settings.routingRules.map((rule, index) => (
              <div className="routing-row" key={rule.id}>
                <Field label="Name" value={rule.name} onChange={(value) => updateRoutingRule(index, "name", value)} />
                <Field label="Project" value={rule.project ?? ""} onChange={(value) => updateRoutingRule(index, "project", value)} />
                <Field
                  label="Title Keywords"
                  value={rule.titleKeywords.join(", ")}
                  onChange={(value) => updateRoutingRule(index, "titleKeywords", csv(value))}
                />
                <Field
                  label="Attendee Emails"
                  value={rule.attendeeEmails.join(", ")}
                  onChange={(value) => updateRoutingRule(index, "attendeeEmails", csv(value))}
                />
                <Field
                  label="Granola Folder"
                  value={rule.granolaFolderName ?? ""}
                  onChange={(value) => updateRoutingRule(index, "granolaFolderName", value)}
                />
                <Field
                  label="Discord Channel"
                  value={rule.discordChannelId ?? ""}
                  onChange={(value) => updateRoutingRule(index, "discordChannelId", value)}
                />
                <Field
                  label="Notion Source"
                  value={rule.notionDataSourceId ?? ""}
                  onChange={(value) => updateRoutingRule(index, "notionDataSourceId", value)}
                />
                <label className="field">
                  <span>Publishing</span>
                  <select
                    value={rule.publishMode}
                    onChange={(event) =>
                      updateRoutingRule(index, "publishMode", event.target.value as RoutingRuleConfig["publishMode"])
                    }
                  >
                    <option value="approval">Approval</option>
                    <option value="auto">Auto Post</option>
                    <option value="draft">Draft Only</option>
                  </select>
                </label>
                <label className="active-toggle">
                  <CheckCircle2 size={17} />
                  <input
                    type="checkbox"
                    checked={rule.isActive !== false}
                    onChange={(event) => updateRoutingRule(index, "isActive", event.target.checked)}
                  />
                </label>
                <button className="icon-button danger" aria-label={`Remove ${rule.name}`} onClick={() => removeRoutingRule(index)}>
                  <Trash2 size={17} />
                </button>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="panel roster-panel">
        <div className="panel-head">
          <SectionTitle icon={<Users size={19} />} title="Roster" />
          <button className="secondary" onClick={addPerson}>
            <Plus size={17} />
            <span>Add</span>
          </button>
        </div>
        <div className="roster">
          {settings.roster.map((person, index) => (
            <div className="roster-row" key={`${person.discordUserId}-${index}`}>
              <Field label="Name" value={person.name} onChange={(value) => updatePerson(index, "name", value)} />
              <Field label="Discord ID" value={person.discordUserId} onChange={(value) => updatePerson(index, "discordUserId", value)} />
              <Field label="Notion Name" value={person.notionName ?? ""} onChange={(value) => updatePerson(index, "notionName", value)} />
              <Field label="Granola Email" value={person.granolaEmail ?? ""} onChange={(value) => updatePerson(index, "granolaEmail", value)} />
              <Field label="GitHub" value={person.githubUsername ?? ""} onChange={(value) => updatePerson(index, "githubUsername", value)} />
              <Field label="Team" value={person.team ?? ""} onChange={(value) => updatePerson(index, "team", value)} />
              <label className="active-toggle">
                <CheckCircle2 size={17} />
                <input
                  type="checkbox"
                  checked={person.isActive !== false}
                  onChange={(event) => updatePerson(index, "isActive", event.target.checked)}
                />
              </label>
              <button className="icon-button danger" aria-label={`Remove ${person.name || "person"}`} onClick={() => removePerson(index)}>
                <Trash2 size={17} />
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="panel history-panel">
        <div className="panel-head">
          <SectionTitle icon={<FileText size={19} />} title="Meeting History" />
          <span className="subtle">{history.length} records</span>
        </div>
        <div className="history-list">
          {history.length === 0 ? (
            <div className="empty">No processed meeting notes yet.</div>
          ) : (
            history.slice(0, 8).map((record) => (
              <div className="history-item" key={record.id}>
                <div>
                  <strong>{record.title}</strong>
                  <p>{new Date(record.createdAt).toLocaleString()}</p>
                </div>
                <span className={`pill ${record.status}`}>{record.status}</span>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="panel graph-panel">
        <div className="panel-head">
          <SectionTitle icon={<Database size={19} />} title="Graph Memory" />
          <span className="subtle">
            {graphMemory?.enabled ? `${graphMemory.groupId} enabled` : "disabled"}
          </span>
        </div>
        <div className="metrics">
          <Metric icon={<ClipboardList size={20} />} label="Queued" value={`${graphSyncQueue?.stats.queued ?? 0}`} />
          <Metric icon={<Loader2 size={20} />} label="Processing" value={`${graphSyncQueue?.stats.processing ?? 0}`} />
          <Metric icon={<CheckCircle2 size={20} />} label="Completed" value={`${graphSyncQueue?.stats.completed ?? 0}`} />
          <Metric icon={<Trash2 size={20} />} label="Failed" value={`${graphSyncQueue?.stats.failed ?? 0}`} />
        </div>
        <div className="button-row">
          <button className="secondary" onClick={enqueueGraphBackfill} disabled={graphActionStatus !== "idle"}>
            {graphActionStatus === "backfilling" ? <Loader2 className="spin" size={17} /> : <Database size={17} />}
            <span>Queue Backfill</span>
          </button>
          <button className="secondary" onClick={drainGraphSync} disabled={graphActionStatus !== "idle"}>
            {graphActionStatus === "draining" ? <Loader2 className="spin" size={17} /> : <RefreshCw size={17} />}
            <span>Drain Graph Sync</span>
          </button>
        </div>

        <div className="graph-dashboard">
          <div className="graph-card span-two">
            <div className="card-head">
              <strong>Recent Change Sets</strong>
              <span className="subtle">{graphChangeSets.length} loaded</span>
            </div>
            <div className="graph-list">
              {graphChangeSets.length === 0 ? (
                <div className="empty">No validated graph change sets yet.</div>
              ) : (
                graphChangeSets.map((changeSet) => (
                  <div className="graph-row" key={changeSet.id}>
                    <div>
                      <strong>{shortKey(changeSet.meetingId)}</strong>
                      <p>
                        {changeSet.validationErrorCount} errors | {changeSet.validationWarningCount} warnings |{" "}
                        {formatMaybeDate(changeSet.appliedAt ?? changeSet.updatedAt)}
                      </p>
                      {changeSet.lastError ? <p className="danger-text">{changeSet.lastError}</p> : null}
                    </div>
                    <div className="pill-stack">
                      <span className={`pill ${changeSet.applyStatus}`}>{changeSet.applyStatus}</span>
                      <span className={`pill ${changeSet.validationStatus}`}>{changeSet.validationStatus}</span>
                      <button
                        className="mini-button"
                        onClick={() => replayGraphChangeSet(changeSet.id)}
                        disabled={Boolean(replayingGraphChangeSetId)}
                      >
                        {replayingGraphChangeSetId === changeSet.id ? <Loader2 className="spin" size={14} /> : <RefreshCw size={14} />}
                        <span>Replay</span>
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="graph-card">
            <div className="card-head">
              <strong>Typed Entities</strong>
              <span className="subtle">{graphEntities.length} hits</span>
            </div>
            <div className="search-row compact">
              <input
                aria-label="Search graph entities"
                placeholder="project:wallace, Ada, decision"
                value={graphEntityQuery}
                onChange={(event) => setGraphEntityQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void searchGraphEntities();
                }}
              />
              <button className="secondary" onClick={searchGraphEntities}>
                <RefreshCw size={17} />
                <span>Find</span>
              </button>
            </div>
            <div className="entity-list">
              {graphEntities.length === 0 ? (
                <div className="empty">Search entities to inspect their bounded context.</div>
              ) : (
                graphEntities.map((entity) => (
                  <button
                    className={`entity-button ${selectedGraphEntityKey === entity.stableKey ? "selected" : ""}`}
                    key={entity.stableKey}
                    onClick={() => {
                      setSelectedGraphEntityKey(entity.stableKey);
                      void refreshGraphEntityContext(entity.stableKey);
                    }}
                  >
                    <span>{graphEndpointLabel(entity)}</span>
                    <small>{entity.stableKey}</small>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="graph-card">
            <div className="card-head">
              <strong>Active Facts</strong>
              <span className="subtle">{graphFacts.length} recent</span>
            </div>
            <div className="graph-list">
              {graphFacts.length === 0 ? (
                <div className="empty">No active graph facts returned yet.</div>
              ) : (
                graphFacts.map((row, index) => (
                  <div className="graph-fact" key={`${row.fact?.factKey ?? "fact"}-${index}`}>
                    <strong>{graphFactLabel(row)}</strong>
                    <p>{row.evidence?.excerpt ?? row.evidence?.title ?? "No evidence excerpt attached."}</p>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="graph-card">
            <div className="card-head">
              <strong>Last Replay Diff</strong>
              <span className={`pill ${lastGraphReplayDiff?.passed ? "applied" : "queued"}`}>
                {lastGraphReplayDiff ? (lastGraphReplayDiff.passed ? "passed" : "review") : "none"}
              </span>
            </div>
            {lastGraphReplayDiff ? (
              <div className="graph-list">
                <div className="graph-fact">
                  <strong>
                    {lastGraphReplayDiff.expected.entities} entities | {lastGraphReplayDiff.expected.relations} relations | {lastGraphReplayDiff.expected.evidence} evidence
                  </strong>
                  <p>{formatMaybeDate(lastGraphReplayDiff.checkedAt)}</p>
                </div>
                {lastGraphReplayDiff.missing.entities.length ||
                lastGraphReplayDiff.missing.relations.length ||
                lastGraphReplayDiff.missing.retirements.length ||
                lastGraphReplayDiff.missing.evidence.length ? (
                  <div className="graph-fact diff-detail">
                    <strong>Missing readback</strong>
                    {lastGraphReplayDiff.missing.entities.length ? <p>Entities: {lastGraphReplayDiff.missing.entities.join(", ")}</p> : null}
                    {lastGraphReplayDiff.missing.relations.length ? (
                      <p>Relations: {lastGraphReplayDiff.missing.relations.map(graphDiffRelationLabel).join(" | ")}</p>
                    ) : null}
                    {lastGraphReplayDiff.missing.retirements.length ? (
                      <p>Retirements: {lastGraphReplayDiff.missing.retirements.map(graphDiffRelationLabel).join(" | ")}</p>
                    ) : null}
                    {lastGraphReplayDiff.missing.evidence.length ? <p>Evidence: {lastGraphReplayDiff.missing.evidence.join(", ")}</p> : null}
                  </div>
                ) : null}
                {lastGraphReplayDiff.errors.length ? (
                  <div className="graph-fact diff-detail">
                    <strong>Read errors</strong>
                    <p>{lastGraphReplayDiff.errors.join(" | ")}</p>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="empty">Replay a change set to verify graph readback.</div>
            )}
          </div>

          <div className="graph-card span-two">
            <div className="card-head">
              <strong>Entity Context</strong>
              <span className="subtle">{graphEntityContext?.entity?.stableKey ?? (selectedGraphEntityKey || "none selected")}</span>
            </div>
            {graphEntityContext?.entity ? (
              <div className="context-head">
                <div>
                  <strong>{graphEndpointLabel(graphEntityContext.entity)}</strong>
                  <p>{graphEntityContext.entity.aliases?.slice(0, 4).join(", ") || graphEntityContext.entity.type || "Entity"}</p>
                </div>
                <span className="pill meeting">{graphEntityContext.facts.length} facts</span>
              </div>
            ) : (
              <div className="empty">Select an entity to inspect facts, retirements, and evidence.</div>
            )}
            <div className="context-grid">
              <div>
                <strong className="mini-title">Current Facts</strong>
                <div className="graph-list">
                  {graphEntityContext?.facts.length ? (
                    graphEntityContext.facts.map((row, index) => (
                      <div className="graph-fact" key={`${row.fact?.factKey ?? "context"}-${index}`}>
                        <strong>{graphFactLabel(row)}</strong>
                        <p>{row.evidence?.excerpt ?? row.evidence?.title ?? "No evidence excerpt attached."}</p>
                      </div>
                    ))
                  ) : (
                    <div className="empty">No current facts for this entity.</div>
                  )}
                </div>
              </div>
              <div>
                <strong className="mini-title">Retirements</strong>
                <div className="graph-list">
                  {graphEntityContext?.retirements.length ? (
                    graphEntityContext.retirements.map((row, index) => (
                      <div className="graph-fact" key={`${row.retirement?.evidenceId ?? "retired"}-${index}`}>
                        <strong>{graphRetirementLabel(row)}</strong>
                        <p>{row.retirement?.reason ?? row.evidence?.excerpt ?? "No retirement reason attached."}</p>
                      </div>
                    ))
                  ) : (
                    <div className="empty">No retired facts for this entity.</div>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="graph-card">
            <div className="card-head">
              <strong>Timeline</strong>
              <span className="subtle">{graphTimeline?.events.length ?? 0} events</span>
            </div>
            <div className="timeline-list">
              {graphTimeline?.events.length ? (
                graphTimeline.events.map((event, index) => (
                  <div className="timeline-item" key={`${event.type}-${event.at ?? index}`}>
                    <span className={`pill ${event.type === "fact" ? "applied" : "failed"}`}>{event.type}</span>
                    <div>
                      <strong>{graphTimelineLabel(event)}</strong>
                      <p>{formatMaybeDate(event.at)}</p>
                    </div>
                  </div>
                ))
              ) : (
                <div className="empty">No entity timeline selected yet.</div>
              )}
            </div>
          </div>

          <div className="graph-card span-two">
            <div className="card-head">
              <strong>Semantic Search</strong>
              <span className="subtle">{graphResults.length} results</span>
            </div>
            <div className="search-row">
              <input
                aria-label="Search graph memory"
                placeholder="Ask about relationships, ownership, project history"
                value={graphQuery}
                onChange={(event) => setGraphQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void searchGraph();
                }}
              />
              <button className="secondary" onClick={searchGraph}>
                <RefreshCw size={17} />
                <span>Search Graph</span>
              </button>
            </div>
            <div className="brain-results">
              {graphResults.length === 0 ? (
                <div className="empty">Graph search results will appear here.</div>
              ) : (
                graphResults.map((result, index) => (
                  <div className="brain-result" key={result.uuid ?? String(index)}>
                    <span className="pill meeting">{result.score?.toFixed(2) ?? "graph"}</span>
                    <div>
                      <strong>{result.name ?? result.fact ?? "Graph fact"}</strong>
                      <p>{result.fact ?? JSON.stringify(result.raw)}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="graph-card">
            <div className="card-head">
              <strong>Sync Jobs</strong>
              <span className="subtle">{graphSyncQueue?.recent.length ?? 0} recent</span>
            </div>
            <div className="history-list">
              {graphSyncQueue?.recent.length ? (
                graphSyncQueue.recent.map((job) => (
                  <div className="knowledge-item" key={job.id}>
                    <div>
                      <strong>{job.entityId}</strong>
                      <p>{job.lastError ?? new Date(job.updatedAt).toLocaleString()}</p>
                    </div>
                    <span className={`pill ${job.status}`}>{job.status}</span>
                  </div>
                ))
              ) : (
                <div className="empty">No graph sync jobs yet.</div>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="brain-grid">
        <div className="panel ontology-panel">
          <div className="panel-head">
            <SectionTitle icon={<Database size={19} />} title="Ontology Cockpit" />
            <button className="secondary" onClick={() => void refreshOntology()} disabled={ontologyStatus !== "idle"}>
              {ontologyStatus === "loading" ? <Loader2 className="spin" size={17} /> : <RefreshCw size={17} />}
              <span>Refresh</span>
            </button>
          </div>
          <div className="ontology-mode-toggle" aria-label="Ontology mode">
            <button
              className={ontologyMode === "state" ? "selected" : ""}
              onClick={() => {
                setOntologyMode("state");
                void refreshOntology(ontologyType, ontologyProject, "state");
              }}
            >
              State
            </button>
            <button
              className={ontologyMode === "changed" ? "selected" : ""}
              onClick={() => {
                setOntologyMode("changed");
                void refreshOntology(ontologyType, ontologyProject, "changed");
              }}
            >
              Changed
            </button>
          </div>
          <div className="ontology-toolbar">
            <label className="field compact-field">
              <span>Type</span>
              <select
                value={ontologyType}
                disabled={ontologyMode === "changed"}
                onChange={(event) => {
                  const nextType = event.target.value as OntologyType;
                  setOntologyType(nextType);
                  setOntologyMode("state");
                  void refreshOntology(nextType, ontologyProject, "state");
                }}
              >
                <option value="goal">Goals</option>
                <option value="metric">Metrics</option>
                <option value="risk">Risks</option>
                <option value="blocker">Blockers</option>
                <option value="open_question">Open questions</option>
                <option value="capability">Capabilities</option>
                <option value="feature">Features</option>
                <option value="artifact">Artifacts</option>
                <option value="benchmark_report">Benchmarks</option>
              </select>
            </label>
            <label className="field compact-field">
              <span>Project</span>
              <input
                aria-label="Ontology project"
                value={ontologyProject}
                onChange={(event) => setOntologyProject(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void refreshOntology(ontologyType, ontologyProject, ontologyMode);
                }}
              />
            </label>
            <label className="field compact-field">
              <span>Search</span>
              <input
                aria-label="Ontology search"
                value={ontologyQuery}
                onChange={(event) => setOntologyQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void refreshOntology(ontologyType, ontologyProject, ontologyMode, ontologyQuery);
                }}
              />
            </label>
            {ontologyMode === "changed" ? (
              <label className="field compact-field">
                <span>Since</span>
                <input
                  aria-label="Ontology changed since"
                  type="datetime-local"
                  value={ontologySince}
                  onChange={(event) => setOntologySince(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void refreshOntology(ontologyType, ontologyProject, "changed");
                  }}
                />
              </label>
            ) : null}
          </div>
          {ontologyHealth ? (
            <div className={`ontology-health ${ontologyHealth.ok ? "ok" : "critical"}`}>
              <div>
                <strong>{ontologyHealth.ok ? "Ontology health passing" : "Ontology health needs repair"}</strong>
                <p>
                  {ontologyHealth.counts.materializedEntities} entities, {ontologyHealth.counts.materializedRelations} relations, {ontologyHealth.counts.materializedEvidence} evidence rows
                </p>
              </div>
              <span className={`pill ${ontologyHealth.ok ? "valid" : "invalid"}`}>
                {ontologyHealth.checks.filter((item) => !item.passed).length} issues
              </span>
            </div>
          ) : null}
          <div className="ontology-counts">
            {ontologySummary
              ? Object.entries(ontologySummary.counts).map(([type, count]) => (
                  <button
                    className={`ontology-count ${ontologyType === type ? "selected" : ""}`}
                    key={type}
                    onClick={() => {
                      setOntologyType(type as OntologyType);
                      setOntologyMode("state");
                      void refreshOntology(type as OntologyType, ontologyProject, "state");
                    }}
                  >
                    <span>{type.replace("_", " ")}</span>
                    <strong>{count}</strong>
                  </button>
                ))
              : null}
          </div>
          <div className="brain-results">
            {ontologyEntities.length === 0 ? (
              <div className="empty">No ontology entities returned for this filter.</div>
            ) : (
              ontologyEntities.map((entity) => (
                <button
                  className={`brain-result ontology-result ${selectedOntologyEvidence?.stableKey === entity.stableKey ? "selected" : ""}`}
                  key={entity.stableKey}
                  onClick={() => void loadOntologyEvidence(entity.stableKey)}
                >
                  <span className="pill meeting">{ontologyMode === "changed" ? entity.type.replace("_", " ") : `${entity.sourceMeetingIds.length} notes`}</span>
                  <div>
                    <strong>{entity.name}</strong>
                    <p>{entity.updatedAt ? `${entity.stableKey} | ${formatMaybeDate(entity.updatedAt)}` : entity.stableKey}</p>
                  </div>
                </button>
              ))
            )}
          </div>
          <div className="subtle">
            {ontologyMode === "changed"
              ? `${ontologyCount} changed entities since ${formatMaybeDate(apiSince(ontologySince))}`
              : `${ontologyCount} total matches across ${ontologySummary?.changeSetCount ?? 0} indexed change sets`}
          </div>
          {selectedOntologyEvidence ? (
            <div className="ontology-evidence-drawer">
              <div className="card-head">
                <strong>{selectedOntologyEvidence.entity?.name ?? selectedOntologyEvidence.stableKey}</strong>
                <span className="pill meeting">{selectedOntologyEvidence.evidence.length} evidence</span>
              </div>
              <div className="graph-list">
                {selectedOntologyEvidence.evidence.length ? (
                  selectedOntologyEvidence.evidence.slice(0, 5).map((item) => (
                    <div className="graph-fact" key={item.evidenceId}>
                      <strong>{item.title ?? item.source ?? item.evidenceId}</strong>
                      <p>{item.excerpt ?? item.url ?? item.evidenceId}</p>
                    </div>
                  ))
                ) : (
                  <div className="empty">No bounded evidence attached.</div>
                )}
              </div>
              <div className="subtle">{selectedOntologyEvidence.relations.length} linked relations</div>
            </div>
          ) : null}
        </div>
        <div className="panel">
          <div className="panel-head">
            <SectionTitle icon={<FileText size={19} />} title="Brain Search" />
          </div>
          <div className="search-row">
            <input
              aria-label="Search company brain"
              placeholder="Search decisions, action items, or meetings"
              value={brainQuery}
              onChange={(event) => setBrainQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void searchBrain();
              }}
            />
            <button className="secondary" onClick={searchBrain}>
              <RefreshCw size={17} />
              <span>Search</span>
            </button>
          </div>
          <div className="brain-results">
            {brainResults.length === 0 ? (
              <div className="empty">Search results will appear here.</div>
            ) : (
              brainResults.map((result) => (
                <div className="brain-result" key={`${result.type}-${result.id}`}>
                  <span className={`pill ${result.type}`}>{result.type}</span>
                  <div>
                    <strong>{result.title}</strong>
                    <p>{result.snippet}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="panel">
          <SectionTitle icon={<ClipboardList size={19} />} title="Recent Decisions" />
          <div className="history-list">
            {decisions.length === 0 ? (
              <div className="empty">No extracted decisions yet.</div>
            ) : (
              decisions.map((decision) => (
                <div className="knowledge-item" key={decision.id}>
                  <strong>{decision.text}</strong>
                  <span className={`pill ${decision.status}`}>{decision.status}</span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="panel">
          <SectionTitle icon={<CheckCircle2 size={19} />} title="Open Action Items" />
          <div className="history-list">
            {actionItems.length === 0 ? (
              <div className="empty">No extracted action items yet.</div>
            ) : (
              actionItems.map((action) => (
                <div className="knowledge-item" key={action.id}>
                  <div>
                    <strong>{action.text}</strong>
                    <p>{[action.owner, action.dueDate].filter(Boolean).join(" · ")}</p>
                  </div>
                  <span className={`pill ${action.status}`}>{action.status}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      <section className="panel secret-panel">
        <SectionTitle icon={<KeyRound size={19} />} title="Secrets" />
        <div className="secret-grid">
          {Object.entries(secrets).map(([key, value]) => (
            <div className="secret" key={key}>
              <span>{key}</span>
              <strong>{value ? "set" : "missing"}</strong>
            </div>
          ))}
        </div>
      </section>
    </main>
  );

  function update<Section extends keyof AppSettings, Key extends keyof AppSettings[Section]>(
    section: Section,
    key: Key,
    value: AppSettings[Section][Key]
  ) {
    setSettings((current) =>
      current
        ? {
            ...current,
            [section]: {
              ...current[section],
              [key]: value,
            },
          }
        : current
    );
  }

  function updatePerson<Key extends keyof PersonConfig>(index: number, key: Key, value: PersonConfig[Key]) {
    setSettings((current) => {
      if (!current) return current;
      const roster = current.roster.map((person, personIndex) =>
        personIndex === index ? { ...person, [key]: value } : person
      );
      return { ...current, roster };
    });
  }

  function addPerson() {
    setSettings((current) => (current ? { ...current, roster: [...current.roster, emptyPerson] } : current));
  }

  function removePerson(index: number) {
    setSettings((current) =>
      current ? { ...current, roster: current.roster.filter((_, personIndex) => personIndex !== index) } : current
    );
  }

  function addRoutingRule() {
    const nextRule: RoutingRuleConfig = {
      id: `route-${Date.now()}`,
      name: "New route",
      project: "",
      titleKeywords: [],
      attendeeEmails: [],
      granolaFolderName: "",
      discordChannelId: "",
      notionDataSourceId: "",
      publishMode: "approval",
      isActive: true,
    };
    setSettings((current) =>
      current ? { ...current, routingRules: [...current.routingRules, nextRule] } : current
    );
  }

  function updateRoutingRule<Key extends keyof RoutingRuleConfig>(
    index: number,
    key: Key,
    value: RoutingRuleConfig[Key]
  ) {
    setSettings((current) => {
      if (!current) return current;
      const routingRules = current.routingRules.map((rule, ruleIndex) =>
        ruleIndex === index ? { ...rule, [key]: value } : rule
      );
      return { ...current, routingRules };
    });
  }

  function removeRoutingRule(index: number) {
    setSettings((current) =>
      current
        ? { ...current, routingRules: current.routingRules.filter((_, ruleIndex) => ruleIndex !== index) }
        : current
    );
  }
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="metric">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="section-title">
      {icon}
      <h2>{title}</h2>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "time" | "number";
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function formatIssueEvent(event: IssueEventRecord): string {
  let detail: Record<string, unknown> = {};
  try {
    detail = JSON.parse(event.detailJson) as Record<string, unknown>;
  } catch {
    detail = {};
  }
  if (event.type === "assigned") return `${detail.previousOwner || "Unassigned"} -> ${detail.owner || "Unassigned"}`;
  if (event.type === "status_changed") return `${detail.previousStatus ?? "open"} -> ${detail.status ?? "open"}`;
  if (event.type === "commented") return String(detail.comment ?? "");
  if (event.type === "created") return String(detail.title ?? "Issue created");
  if (event.type === "updated") return "Metadata updated";
  return event.type;
}

function graphEndpointLabel(entity?: GraphEntityResult | null): string {
  if (!entity) return "Unknown entity";
  return entity.name || entity.stableKey || "Unknown entity";
}

function graphFactLabel(row: GraphFactRow): string {
  const subject = row.subject?.name || row.fact?.subjectKey || "subject";
  const relation = row.fact?.relation || "RELATES_TO";
  const object = row.object?.name || row.fact?.objectKey || "object";
  return `${subject} ${relation} ${object}`;
}

function graphRetirementLabel(row: GraphRetirementRow): string {
  const retirement = row.retirement;
  const subject = retirement?.subjectKey || "subject";
  const relation = retirement?.relation || "RETIRED";
  const object = retirement?.objectKey || "object";
  return `${subject} ${relation} ${object}`;
}

function graphTimelineLabel(event: GraphTimelineResponse["events"][number]): string {
  if (event.type === "fact") return graphFactLabel(event.item as GraphFactRow);
  return graphRetirementLabel(event.item as GraphRetirementRow);
}

function graphDiffRelationLabel(item: { subjectKey: string; relation: string; objectKey: string; evidenceId?: string }): string {
  return `${item.subjectKey} ${item.relation} ${item.objectKey}${item.evidenceId ? ` (${item.evidenceId})` : ""}`;
}

function shortKey(value?: string): string {
  if (!value) return "unknown";
  return value.length > 28 ? `${value.slice(0, 12)}...${value.slice(-8)}` : value;
}

function defaultSinceInput(): string {
  const date = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  date.setSeconds(0, 0);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function apiSince(value: string): string {
  const parsed = new Date(value.trim());
  return Number.isNaN(parsed.valueOf()) ? value.trim() : parsed.toISOString();
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function formatMaybeDate(value?: string): string {
  if (!value) return "unknown";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return date.toLocaleString();
}

function csv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

















