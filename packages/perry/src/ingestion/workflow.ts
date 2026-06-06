import { loadAppSettings, type AppSettings } from "@core";
import { enqueueMeetingGraphSync } from "@graph";
import { sendToChannel, sendToMeetingChannel } from "@discord";
import { extractKnowledge } from "@extraction";
import { formatMeetingAnnouncement, normalizeGranolaZapierPayload } from "@meetings";
import { createMeetingNotePage } from "@notion";
import {
  createApproval,
  findMeetingRecord,
  getApproval,
  meetingRecordFromNote,
  replaceMeetingKnowledge,
  type ApprovalRecord,
  type MeetingRecord,
  updateApprovalStatus,
  upsertMeetingRecord,
} from "@store";
import { resolveMeetingRoute, type MeetingRoute } from "@meetings";

export interface MeetingWorkflowResult {
  duplicate: boolean;
  dryRun: boolean;
  announcement: string;
  record: MeetingRecord;
  knowledge?: ReturnType<typeof extractKnowledge>;
  route?: MeetingRoute;
  approval?: ApprovalRecord;
  notionPageId?: string;
  notionUrl?: string;
  discordMessageUrl?: string;
}

export async function processGranolaZapierPayload(
  payload: unknown,
  options: { dryRun?: boolean; force?: boolean; bypassApproval?: boolean } = {}
): Promise<MeetingWorkflowResult> {
  const note = normalizeGranolaZapierPayload(payload);
  const settings = loadAppSettings();
  const route = resolveMeetingRoute(note, settings);
  const duplicate = options.force ? undefined : findMeetingRecord(note);
  if (duplicate && duplicate.status === "processed") {
    const knowledge = extractKnowledge(note);
    return {
      duplicate: true,
      dryRun: false,
      announcement: formatMeetingAnnouncement(note, duplicate.notionUrl),
      record: duplicate,
      knowledge,
      route,
      notionPageId: duplicate.notionPageId,
      notionUrl: duplicate.notionUrl,
      discordMessageUrl: duplicate.discordMessageUrl,
    };
  }

  if (options.dryRun) {
    const record = meetingRecordFromNote(note, "dry-run");
    const knowledge = extractKnowledge(note);
    const announcement = formatMeetingAnnouncement(note);
    return {
      duplicate: false,
      dryRun: true,
      announcement,
      record,
      knowledge,
      route,
    };
  }

  const knowledge = extractKnowledge(note);
  const publishMode = options.bypassApproval ? "auto" : route.publishMode;
  if (publishMode !== "auto") {
    const record = upsertMeetingRecord(meetingRecordFromNote(note, "dry-run"));
    replaceMeetingKnowledge(record.id, knowledge);
    const approval = createApproval({
      id: `approval:${record.id}`,
      meetingId: record.id,
      title: record.title,
      payloadJson: JSON.stringify(payload),
      announcement: formatMeetingAnnouncement(note),
      knowledgeJson: JSON.stringify(knowledge),
      routeJson: JSON.stringify(route),
      routeProject: route.project,
      routeReason: route.reason,
      publishMode: route.publishMode,
      decisionCount: knowledge.decisions.length,
      actionItemCount: knowledge.actionItems.length,
      status: "pending",
    });
    return {
      duplicate: false,
      dryRun: true,
      announcement: approval.announcement,
      record,
      knowledge,
      route,
      approval,
    };
  }

  const record = meetingRecordFromNote(note, "processed");
  const notionPage = await createMeetingNotePage(note, { dataSourceId: route.notionDataSourceId });
  const announcement = formatMeetingAnnouncement(note, notionPage?.url);
  const discordMessageUrl = route.discordChannelId
    ? await sendToChannel(route.discordChannelId, announcement)
    : await sendToMeetingChannel(announcement);
  const saved = upsertMeetingRecord({
    ...record,
    updatedAt: new Date().toISOString(),
    notionPageId: notionPage?.id,
    notionUrl: notionPage?.url,
    discordMessageUrl,
  });
  replaceMeetingKnowledge(saved.id, knowledge);
  enqueueMeetingGraphSync({
    note,
    record: saved,
    knowledge,
    route,
    notionUrl: notionPage?.url,
    discordMessageUrl,
  });

  return {
    duplicate: false,
    dryRun: false,
    announcement,
    record: saved,
    knowledge,
    route,
    notionPageId: notionPage?.id,
    notionUrl: notionPage?.url,
    discordMessageUrl,
  };
}

export function tryProcessGranolaApprovalPayloadSync(
  payload: unknown,
  options: { force?: boolean; bypassApproval?: boolean; settings?: AppSettings } = {}
): MeetingWorkflowResult | undefined {
  if (options.bypassApproval) return undefined;

  const note = normalizeGranolaZapierPayload(payload);
  const settings = options.settings ?? loadAppSettings();
  const route = resolveMeetingRoute(note, settings);
  if (route.publishMode === "auto") return undefined;

  const duplicate = options.force ? undefined : findMeetingRecord(note);
  if (duplicate && duplicate.status === "processed") {
    const knowledge = extractKnowledge(note);
    return {
      duplicate: true,
      dryRun: false,
      announcement: formatMeetingAnnouncement(note, duplicate.notionUrl),
      record: duplicate,
      knowledge,
      route,
      notionPageId: duplicate.notionPageId,
      notionUrl: duplicate.notionUrl,
      discordMessageUrl: duplicate.discordMessageUrl,
    };
  }

  const knowledge = extractKnowledge(note);
  const record = upsertMeetingRecord(meetingRecordFromNote(note, "dry-run"));
  replaceMeetingKnowledge(record.id, knowledge);
  const approval = createApproval({
    id: `approval:${record.id}`,
    meetingId: record.id,
    title: record.title,
    payloadJson: JSON.stringify(payload),
    announcement: formatMeetingAnnouncement(note),
    knowledgeJson: JSON.stringify(knowledge),
    routeJson: JSON.stringify(route),
    routeProject: route.project,
    routeReason: route.reason,
    publishMode: route.publishMode,
    decisionCount: knowledge.decisions.length,
    actionItemCount: knowledge.actionItems.length,
    status: "pending",
  });
  return {
    duplicate: false,
    dryRun: true,
    announcement: approval.announcement,
    record,
    knowledge,
    route,
    approval,
  };
}

export function previewGranolaZapierPayload(payload: unknown): MeetingWorkflowResult {
  const note = normalizeGranolaZapierPayload(payload);
  const route = resolveMeetingRoute(note, loadAppSettings());
  const record = meetingRecordFromNote(note, "dry-run");
  const knowledge = extractKnowledge(note);
  return {
    duplicate: Boolean(findMeetingRecord(note)),
    dryRun: true,
    announcement: formatMeetingAnnouncement(note),
    record,
    knowledge,
    route,
  };
}

export async function approvePendingMeeting(approvalId: string): Promise<MeetingWorkflowResult> {
  const approval = getApproval(approvalId);
  if (!approval) {
    throw new Error(`Approval ${approvalId} not found`);
  }
  if (approval.status !== "pending") {
    throw new Error(`Approval ${approvalId} is ${approval.status}`);
  }
  updateApprovalStatus(approvalId, "approved");
  const result = await processGranolaZapierPayload(JSON.parse(approval.payloadJson), {
    force: true,
    bypassApproval: true,
  });
  updateApprovalStatus(approvalId, "posted");
  return result;
}

export function rejectPendingMeeting(approvalId: string): ApprovalRecord {
  const updated = updateApprovalStatus(approvalId, "rejected");
  if (!updated) {
    throw new Error(`Approval ${approvalId} not found`);
  }
  return updated;
}
