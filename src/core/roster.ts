import { loadAppSettings } from "./config";

/**
 * The roster defines who is expected to submit standup updates each day.
 */
export interface Person {
  name: string;
  discordUserId: string;
  notionName?: string;
  team?: string;
  timezone?: string;
  isActive?: boolean;
}

export function getRoster(): Person[] {
  return loadAppSettings().roster;
}

export function findPersonByDiscordId(userId: string): Person | undefined {
  return getRoster().find((person) => person.discordUserId === userId && person.isActive !== false);
}

export function getActiveRoster(): Person[] {
  return getRoster().filter((person) => person.isActive !== false);
}
