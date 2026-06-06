// rows — split out of the former monolithic meeting-store.ts
import { type MeetingNote } from "@meetings";
import { type ActionItemRecord, type ApprovalRecord, type ApprovalSummaryRecord, type DecisionRecord, type GraphChangeSetRecord, type GraphSyncJobRecord, type IngestionJobRecord, type IssueEventRecord, type IssueRecord, type MeetingRecord, type PivotRecord, type Row, type UserRecord } from "./types";
import { optionalString } from "./db";

export function meetingFromRow(row: Row): MeetingRecord {
  return {
    id: String(row.id),
    source: String(row.source) as MeetingNote["source"],
    sourceId: optionalString(row.source_id),
    title: String(row.title),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    notionPageId: optionalString(row.notion_page_id),
    notionUrl: optionalString(row.notion_url),
    discordMessageUrl: optionalString(row.discord_message_url),
    status: String(row.status) as MeetingRecord["status"],
    error: optionalString(row.error),
  };
}

export function decisionFromRow(row: Row): DecisionRecord {
  return {
    id: String(row.id),
    meetingId: String(row.meeting_id),
    text: String(row.text),
    status: String(row.status) as DecisionRecord["status"],
    createdAt: String(row.created_at),
  };
}

export function actionFromRow(row: Row): ActionItemRecord {
  return {
    id: String(row.id),
    meetingId: String(row.meeting_id),
    text: String(row.text),
    owner: optionalString(row.owner),
    dueDate: optionalString(row.due_date),
    status: String(row.status) as ActionItemRecord["status"],
    createdAt: String(row.created_at),
  };
}

export function userFromRow(row: Row): UserRecord {
  return {
    id: String(row.id),
    displayName: String(row.display_name),
    email: optionalString(row.email),
    discordUserId: optionalString(row.discord_user_id),
    notionUserId: optionalString(row.notion_user_id),
    githubUsername: optionalString(row.github_username),
    team: optionalString(row.team),
    timezone: optionalString(row.timezone),
    isActive: Number(row.is_active) !== 0,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function issueFromRow(row: Row): IssueRecord {
  return {
    id: String(row.id),
    project: optionalString(row.project),
    title: String(row.title),
    description: optionalString(row.description),
    status: String(row.status) as IssueRecord["status"],
    priority: String(row.priority) as IssueRecord["priority"],
    owner: optionalString(row.owner),
    sourceMeetingId: optionalString(row.source_meeting_id),
    sourceActionId: optionalString(row.source_action_id),
    dueDate: optionalString(row.due_date),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function issueEventFromRow(row: Row): IssueEventRecord {
  return {
    id: String(row.id),
    issueId: String(row.issue_id),
    type: String(row.type) as IssueEventRecord["type"],
    actor: optionalString(row.actor),
    detailJson: String(row.detail_json),
    meetingId: optionalString(row.meeting_id),
    createdAt: String(row.created_at),
  };
}

export function pivotFromRow(row: Row): PivotRecord {
  return {
    id: String(row.id),
    project: optionalString(row.project),
    subject: String(row.subject),
    previousOwner: optionalString(row.previous_owner),
    newOwner: optionalString(row.new_owner),
    fallbackReviewer: optionalString(row.fallback_reviewer),
    reason: String(row.reason),
    sourceDecisionId: String(row.source_decision_id),
    sourceMeetingId: String(row.source_meeting_id),
    affectedIssueIds: JSON.parse(String(row.affected_issue_ids_json)) as string[],
    createdAt: String(row.created_at),
  };
}

export function approvalFromRow(row: Row): ApprovalRecord {
  return {
    id: String(row.id),
    meetingId: String(row.meeting_id),
    title: String(row.title),
    payloadJson: String(row.payload_json),
    announcement: String(row.announcement),
    knowledgeJson: String(row.knowledge_json),
    routeJson: String(row.route_json),
    status: String(row.status) as ApprovalRecord["status"],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function approvalSummaryFromRow(row: Row): ApprovalSummaryRecord {
  return {
    id: String(row.id),
    meetingId: String(row.meeting_id),
    title: String(row.title),
    announcement: String(row.announcement),
    routeProject: optionalString(row.route_project),
    routeReason: optionalString(row.route_reason),
    publishMode: optionalString(row.publish_mode),
    decisionCount: Number(row.decision_count ?? 0),
    actionItemCount: Number(row.action_item_count ?? 0),
    status: String(row.status) as ApprovalRecord["status"],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function ingestionJobFromRow(row: Row): IngestionJobRecord {
  return {
    id: String(row.id),
    type: String(row.type) as IngestionJobRecord["type"],
    idempotencyKey: String(row.idempotency_key),
    status: String(row.status) as IngestionJobRecord["status"],
    payloadJson: String(row.payload_json),
    resultJson: optionalString(row.result_json),
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    notBefore: String(row.not_before),
    lockedAt: optionalString(row.locked_at),
    lastError: optionalString(row.last_error),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function graphSyncJobFromRow(row: Row): GraphSyncJobRecord {
  return {
    id: String(row.id),
    entityType: String(row.entity_type) as GraphSyncJobRecord["entityType"],
    entityId: String(row.entity_id),
    status: String(row.status) as GraphSyncJobRecord["status"],
    payloadJson: String(row.payload_json),
    resultJson: optionalString(row.result_json),
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    notBefore: String(row.not_before),
    lockedAt: optionalString(row.locked_at),
    lastError: optionalString(row.last_error),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function graphChangeSetFromRow(row: Row): GraphChangeSetRecord {
  return {
    id: String(row.id),
    meetingId: String(row.meeting_id),
    graphSyncJobId: String(row.graph_sync_job_id),
    groupId: String(row.group_id),
    validationStatus: String(row.validation_status) as GraphChangeSetRecord["validationStatus"],
    validationErrorsJson: String(row.validation_errors_json),
    validationWarningsJson: String(row.validation_warnings_json),
    changeSetJson: String(row.change_set_json),
    applyStatus: String(row.apply_status) as GraphChangeSetRecord["applyStatus"],
    appliedAt: optionalString(row.applied_at),
    lastError: optionalString(row.last_error),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
