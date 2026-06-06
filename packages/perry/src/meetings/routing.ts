import type { AppSettings, RoutingRuleConfig } from "@core";
import type { MeetingNote } from "./note";

export interface MeetingRoute {
  ruleId?: string;
  ruleName?: string;
  project?: string;
  discordChannelId?: string;
  notionDataSourceId?: string;
  publishMode: "approval" | "auto" | "draft";
  reason: string;
}

export function resolveMeetingRoute(note: MeetingNote, settings: AppSettings): MeetingRoute {
  const matchingRule = settings.routingRules
    .filter((rule) => rule.isActive !== false)
    .map((rule) => ({ rule, score: scoreRule(rule, note) }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.rule;

  if (!matchingRule) {
    return {
      publishMode: settings.granola.defaultPublishMode,
      discordChannelId: settings.discord.meetingChannelId,
      notionDataSourceId: settings.notion.meetingNotesDataSourceId,
      reason: "No routing rule matched; using default meeting settings",
    };
  }

  return {
    ruleId: matchingRule.id,
    ruleName: matchingRule.name,
    project: matchingRule.project,
    discordChannelId: matchingRule.discordChannelId ?? settings.discord.meetingChannelId,
    notionDataSourceId: matchingRule.notionDataSourceId ?? settings.notion.meetingNotesDataSourceId,
    publishMode: matchingRule.publishMode,
    reason: `Matched routing rule: ${matchingRule.name}`,
  };
}

function scoreRule(rule: RoutingRuleConfig, note: MeetingNote): number {
  let score = 0;
  const title = note.title.toLowerCase();
  const folder = note.folderName?.toLowerCase();
  const attendees = new Set(note.attendees.map((attendee) => attendee.email?.toLowerCase()).filter(Boolean));

  if (rule.granolaFolderName && folder === rule.granolaFolderName.toLowerCase()) score += 8;
  for (const keyword of rule.titleKeywords) {
    if (keyword && title.includes(keyword.toLowerCase())) score += 4;
  }
  for (const email of rule.attendeeEmails) {
    if (attendees.has(email.toLowerCase())) score += 3;
  }

  return score;
}
