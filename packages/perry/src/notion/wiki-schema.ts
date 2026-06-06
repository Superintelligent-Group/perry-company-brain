export const meetingNotesSchema = {
  title: "Title",
  source: "Source",
  sourceId: "Source ID",
  date: "Date",
  granolaLink: "Granola Link",
  attendees: "Attendees",
  project: "Project",
  discordMessage: "Discord Message",
  graphEntity: "Graph Entity",
} as const;

export const decisionSchema = {
  title: "Decision",
  meeting: "Meeting",
  project: "Project",
  status: "Status",
  owner: "Owner",
  evidence: "Evidence",
  graphFact: "Graph Fact",
} as const;

export const actionItemSchema = {
  title: "Action",
  meeting: "Meeting",
  owner: "Owner",
  dueDate: "Due Date",
  status: "Status",
  project: "Project",
  sourceActionId: "Source Action ID",
  graphEntity: "Graph Entity",
} as const;

export const projectSchema = {
  title: "Project",
  owner: "Owner",
  status: "Status",
  discordChannel: "Discord Channel",
  repository: "Repository",
  graphEntity: "Graph Entity",
} as const;

export const notionWikiSchemas = {
  meetingNotes: meetingNotesSchema,
  decisions: decisionSchema,
  actionItems: actionItemSchema,
  projects: projectSchema,
} as const;
