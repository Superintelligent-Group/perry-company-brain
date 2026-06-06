import { Client } from "@notionhq/client";
import type { PageObjectResponse } from "@notionhq/client/build/src/api-endpoints";
import { loadConfig } from "@core";
import type { Person } from "@core";

/**
 * A parsed standup entry returned from Notion.  All properties are optional
 * because pages may be partially filled in.  The `personName` field comes
 * from the Notion database's person/text property representing who submitted
 * the standup.  When the database uses the "Person" type the name is taken
 * from the people list; otherwise it falls back to a rich text property.
 */
export interface StandupEntry {
  personName?: string;
  date?: string;
  yesterday?: string;
  today?: string;
  blockers?: string;
  status?: string;
  discordUserId?: string;
}

/** Helper to format a Date as YYYY-MM-DD in the configured timezone. */
export function formatDateForFilter(date: Date): string {
  const { TIMEZONE } = loadConfig();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return `${year}-${month}-${day}`;
}

/**
 * Queries the standup database for all entries matching a given ISO date
 * string.  Returns raw pages; transform them with `transformStandupPage`.
 */
export async function fetchStandupPages(dateString: string): Promise<PageObjectResponse[]> {
  const config = loadConfig();
  const notion = new Client({ auth: config.NOTION_TOKEN, notionVersion: "2025-09-03" } as any);
  const filter = {
    property: "Date",
    date: { equals: dateString },
  } as const;
  const pages: PageObjectResponse[] = [];
  let cursor: string | undefined;
  do {
    const response = await (notion as any).dataSources.query({
      data_source_id: config.NOTION_DATABASE_ID,
      filter,
      start_cursor: cursor,
      page_size: 100,
    });
    pages.push(...(response.results as PageObjectResponse[]));
    cursor = response.has_more ? response.next_cursor ?? undefined : undefined;
  } while (cursor);
  return pages;
}

/**
 * Transforms a Notion page into a StandupEntry by extracting common
 * properties.  This function makes a best effort to handle both Person and
 * text properties for the "Person" field.  Unknown properties are ignored.
 */
export function transformStandupPage(page: PageObjectResponse): StandupEntry {
  const props = (page.properties ?? {}) as Record<string, any>;
  const entry: StandupEntry = {};

  // Date property
  if (props.Date && props.Date.type === "date" && props.Date.date) {
    entry.date = props.Date.date.start;
  }

  // Person (could be a people or rich_text property)
  if (props.Person) {
    if (props.Person.type === "people" && Array.isArray(props.Person.people) && props.Person.people[0]) {
      entry.personName = props.Person.people[0].name;
    } else if (props.Person.type === "rich_text" && Array.isArray(props.Person.rich_text) && props.Person.rich_text[0]) {
      entry.personName = props.Person.rich_text
        .map((t: any) => (t.type === "text" ? t.text.content : ""))
        .join("")
        .trim();
    }
  }

  // Yesterday
  if (props.Yesterday && props.Yesterday.type === "rich_text") {
    entry.yesterday = props.Yesterday.rich_text
      .map((t: any) => (t.type === "text" ? t.text.content : ""))
      .join("")
      .trim();
  }
  // Today
  if (props.Today && props.Today.type === "rich_text") {
    entry.today = props.Today.rich_text
      .map((t: any) => (t.type === "text" ? t.text.content : ""))
      .join("")
      .trim();
  }
  // Blockers
  if (props.Blockers && props.Blockers.type === "rich_text") {
    entry.blockers = props.Blockers.rich_text
      .map((t: any) => (t.type === "text" ? t.text.content : ""))
      .join("")
      .trim();
  }
  // Status (could be select or status)
  if (props.Status) {
    if (props.Status.type === "select" && props.Status.select) {
      entry.status = props.Status.select.name;
    } else if (props.Status.type === "status" && props.Status.status) {
      entry.status = props.Status.status.name;
    }
  }
  // Discord Mention (custom text property containing the user id or handle)
  if (props.Discord && props.Discord.type === "rich_text") {
    const mention = props.Discord.rich_text
      .map((t: any) => (t.type === "text" ? t.text.content : ""))
      .join("")
      .trim();
    entry.discordUserId = mention.replace(/[<@!>]/g, "");
  }
  return entry;
}

/**
 * Fetches all standup entries for a given date and returns them in a parsed
 * format.  When there are no pages the returned array is empty.
 */
export async function fetchStandupEntries(date: Date): Promise<StandupEntry[]> {
  const dateString = formatDateForFilter(date);
  const pages = await fetchStandupPages(dateString);
  return pages.map(transformStandupPage);
}

/**
 * Computes which people from the roster have not submitted a standup for a
 * given date.  Matching is performed first by Discord ID if the entry
 * includes a `discordUserId`.  If not found, it falls back to matching the
 * `personName` property against the roster's notionName.
 */
export function findMissingStandups(
  entries: StandupEntry[],
  roster: Person[]
): Person[] {
  const submitted = new Set<string>();
  for (const entry of entries) {
    if (entry.discordUserId) {
      submitted.add(entry.discordUserId);
    } else if (entry.personName) {
      submitted.add(entry.personName.toLowerCase());
    }
  }
  return roster.filter((person) => {
    if (person.isActive === false) return false;
    // Check by Discord ID
    if (person.discordUserId && submitted.has(person.discordUserId)) return false;
    // Check by notionName
    if (person.notionName && submitted.has(person.notionName.toLowerCase())) return false;
    // If no matches, they are missing
    return true;
  });
}
