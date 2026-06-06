export type GraphEntityType =
  | "meeting"
  | "person"
  | "project"
  | "decision"
  | "action_item"
  | "repository"
  | "customer"
  | "policy"
  | "goal"
  | "metric"
  | "risk"
  | "blocker"
  | "open_question"
  | "capability"
  | "feature"
  | "artifact"
  | "benchmark_report"
  | "channel"
  | "data_source"
  | "notion_page"
  | "discord_message"
  | "source_note";

export type GraphRelationType =
  | "CAPTURED_BY"
  | "ATTENDED_BY"
  | "ROUTED_TO_PROJECT"
  | "HAS_DECISION"
  | "HAS_ACTION_ITEM"
  | "ASSIGNED_TO"
  | "ASSIGNED_OWNER"
  | "HAS_FALLBACK_REVIEWER"
  | "MENTIONS_REPOSITORY"
  | "MENTIONS_CUSTOMER"
  | "REFERENCES_POLICY"
  | "MENTIONS_GOAL"
  | "MENTIONS_METRIC"
  | "MENTIONS_RISK"
  | "MENTIONS_BLOCKER"
  | "MENTIONS_OPEN_QUESTION"
  | "MENTIONS_CAPABILITY"
  | "MENTIONS_FEATURE"
  | "REFERENCES_ARTIFACT"
  | "REFERENCES_BENCHMARK_REPORT"
  | "VALIDATED_BY"
  | "SUPPORTS_GOAL"
  | "HAS_RISK"
  | "BLOCKED_BY"
  | "HAS_OPEN_QUESTION"
  | "IMPLEMENTS_CAPABILITY"
  | "ROUTED_TO_CHANNEL"
  | "WRITES_TO_DATA_SOURCE"
  | "DOCUMENTED_IN"
  | "POSTED_TO"
  | "DERIVED_FROM";

export interface GraphEntityUpsert {
  type: GraphEntityType;
  stableKey: string;
  name: string;
  aliases?: string[];
  properties?: Record<string, string | number | boolean | null>;
  evidenceIds: string[];
}

export interface GraphRelationAssertion {
  subjectKey: string;
  relation: GraphRelationType;
  objectKey: string;
  evidenceId: string;
  validFrom?: string;
  confidence: number;
  properties?: Record<string, string | number | boolean | null>;
}

export interface GraphRelationRetirement {
  subjectKey: string;
  relation: GraphRelationType;
  objectKey: string;
  evidenceId: string;
  validUntil: string;
  reason: string;
}

export interface GraphEvidenceLink {
  evidenceId: string;
  kind: "meeting" | "decision" | "action_item" | "source_link";
  source: "granola" | "perry" | "notion" | "discord";
  sourceId: string;
  meetingId: string;
  title?: string;
  excerpt?: string;
  url?: string;
}

export interface GraphChangeSet {
  schemaVersion: 1;
  sourceMeetingId: string;
  generatedAt: string;
  entities: GraphEntityUpsert[];
  relations: GraphRelationAssertion[];
  retirements: GraphRelationRetirement[];
  evidence: GraphEvidenceLink[];
  warnings: string[];
}

export interface GraphChangeSetValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export type CompanyOntologyEntityType = Extract<
  GraphEntityType,
  "goal" | "metric" | "risk" | "blocker" | "open_question" | "capability" | "feature" | "artifact" | "benchmark_report"
>;

export const companyOntologyEntityTypes: readonly CompanyOntologyEntityType[] = [
  "goal",
  "metric",
  "risk",
  "blocker",
  "open_question",
  "capability",
  "feature",
  "artifact",
  "benchmark_report",
];
