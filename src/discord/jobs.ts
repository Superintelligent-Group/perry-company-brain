import cron from "node-cron";
import { loadConfig } from "@core";
import { fetchStandupEntries, findMissingStandups } from "@notion";
import { getActiveRoster } from "@core";
import { formatMissing, formatSummary } from "./format";
import { sendToStandupChannel } from "./client";

/** Parses a HH:MM string into numeric hours and minutes. */
function parseHHMM(time: string): { hour: number; minute: number } {
  const [hh, mm] = time.split(":").map((s) => parseInt(s, 10));
  if (Number.isNaN(hh) || Number.isNaN(mm)) {
    throw new Error(`Invalid time string: ${time}`);
  }
  return { hour: hh, minute: mm };
}

/**
 * Schedules the daily standup reminders and summary posting.  Uses node‑cron
 * under the hood.  All tasks run in the configured timezone.
 */
export function scheduleJobs(): void {
  const config = loadConfig();
  const tz = config.TIMEZONE;
  // Reminder 1
  const { hour: r1Hour, minute: r1Min } = parseHHMM(config.REMINDER_TIME);
  cron.schedule(
    `0 ${r1Min} ${r1Hour} * * *`,
    async () => {
      const date = new Date();
      const entries = await fetchStandupEntries(date);
      const missing = findMissingStandups(entries, getActiveRoster());
      const content = formatMissing(missing, date);
      await sendToStandupChannel(content);
    },
    { timezone: tz }
  );
  // Reminder 2 (pre standup)
  const { hour: r2Hour, minute: r2Min } = parseHHMM(config.PRE_STANDUP_REMINDER_TIME);
  cron.schedule(
    `0 ${r2Min} ${r2Hour} * * *`,
    async () => {
      const date = new Date();
      const entries = await fetchStandupEntries(date);
      const missing = findMissingStandups(entries, getActiveRoster());
      const content = formatMissing(missing, date);
      await sendToStandupChannel(content);
    },
    { timezone: tz }
  );
  // Summary
  const { hour: sHour, minute: sMin } = parseHHMM(config.STANDUP_TIME);
  cron.schedule(
    `0 ${sMin} ${sHour} * * *`,
    async () => {
      const date = new Date();
      const entries = await fetchStandupEntries(date);
      const content = formatSummary(entries, date);
      await sendToStandupChannel(content);
    },
    { timezone: tz }
  );
  console.log(
    `Scheduled standup jobs at ${config.REMINDER_TIME}, ${config.PRE_STANDUP_REMINDER_TIME} and ${config.STANDUP_TIME} (${tz}).`
  );
}