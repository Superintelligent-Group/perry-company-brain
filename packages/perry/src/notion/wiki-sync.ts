import { Client } from "@notionhq/client";
import { loadAppSettings } from "@core";
import type { ActionItemRecord, DecisionRecord, IssueRecord } from "@store";
import { actionItemSchema, decisionSchema, projectSchema } from "./wiki-schema";

export interface SyncedWikiRecord {
  id: string;
  url?: string;
  dryRun: boolean;
  kind: "decision" | "action_item" | "project";
}

export async function syncDecisionRecordToNotion(decision: DecisionRecord): Promise<SyncedWikiRecord | undefined> {
  if (isDryRun()) return dryRunRecord("decision", decision.id);
  const dataSourceId = process.env.NOTION_DECISIONS_DATA_SOURCE_ID;
  if (!dataSourceId) return undefined;
  const page = await notionClient().pages.create({
    parent: { data_source_id: dataSourceId } as any,
    properties: {
      [decisionSchema.title]: { title: [{ text: { content: decision.text.slice(0, 1900) } }] },
      [decisionSchema.meeting]: { rich_text: [{ text: { content: decision.meetingId } }] },
      [decisionSchema.status]: { select: { name: decision.status } },
      [decisionSchema.evidence]: { rich_text: [{ text: { content: decision.id } }] },
    },
  } as any);
  return notionRecord("decision", page);
}

export async function syncActionItemRecordToNotion(action: ActionItemRecord): Promise<SyncedWikiRecord | undefined> {
  if (isDryRun()) return dryRunRecord("action_item", action.id);
  const dataSourceId = process.env.NOTION_ACTION_ITEMS_DATA_SOURCE_ID;
  if (!dataSourceId) return undefined;
  const page = await notionClient().pages.create({
    parent: { data_source_id: dataSourceId } as any,
    properties: {
      [actionItemSchema.title]: { title: [{ text: { content: action.text.slice(0, 1900) } }] },
      [actionItemSchema.meeting]: { rich_text: [{ text: { content: action.meetingId } }] },
      [actionItemSchema.owner]: action.owner ? { rich_text: [{ text: { content: action.owner } }] } : undefined,
      [actionItemSchema.dueDate]: action.dueDate ? { date: { start: action.dueDate } } : undefined,
      [actionItemSchema.status]: { select: { name: action.status } },
      [actionItemSchema.sourceActionId]: { rich_text: [{ text: { content: action.id } }] },
    },
  } as any);
  return notionRecord("action_item", page);
}

export async function syncProjectRecordToNotion(project: Pick<IssueRecord, "project" | "owner" | "status">): Promise<SyncedWikiRecord | undefined> {
  if (!project.project) return undefined;
  if (isDryRun()) return dryRunRecord("project", project.project);
  const dataSourceId = process.env.NOTION_PROJECTS_DATA_SOURCE_ID;
  if (!dataSourceId) return undefined;
  const page = await notionClient().pages.create({
    parent: { data_source_id: dataSourceId } as any,
    properties: {
      [projectSchema.title]: { title: [{ text: { content: project.project } }] },
      [projectSchema.owner]: project.owner ? { rich_text: [{ text: { content: project.owner } }] } : undefined,
      [projectSchema.status]: { select: { name: project.status } },
      [projectSchema.graphEntity]: { rich_text: [{ text: { content: `project:${slug(project.project)}` } }] },
    },
  } as any);
  return notionRecord("project", page);
}

function notionClient(): Client {
  const notionToken = process.env.NOTION_TOKEN;
  if (!notionToken) throw new Error("NOTION_TOKEN is required for Notion wiki sync");
  return new Client({ auth: notionToken, notionVersion: "2025-09-03" } as any);
}

function isDryRun(): boolean {
  return process.env.PERRY_NOTION_DRY_RUN === "true";
}

function dryRunRecord(kind: SyncedWikiRecord["kind"], id: string): SyncedWikiRecord {
  return {
    id: `dry-run-${kind}-${slug(id)}`,
    url: `https://notion.example/perry-dry-run/${kind}/${encodeURIComponent(id)}`,
    dryRun: true,
    kind,
  };
}

function notionRecord(kind: SyncedWikiRecord["kind"], page: any): SyncedWikiRecord {
  return { id: page.id, url: "url" in page ? page.url : undefined, dryRun: false, kind };
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 80);
}
