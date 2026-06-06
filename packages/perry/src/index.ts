import { registerSlashCommands, startDiscord } from "@discord";
import { scheduleJobs } from "@discord";
import { startAdminServer } from "@server";

async function main(): Promise<void> {
  try {
    // Register slash commands in the configured guild.  This is idempotent and
    // will update commands if their definitions change.
    await registerSlashCommands();
    // Start the Discord client and begin listening for interactions.
    await startDiscord();
    // Kick off the daily cron jobs for reminders and summary posting.
    scheduleJobs();
    if (process.env.PERRY_ADMIN_SERVER !== "false") {
      startAdminServer();
    }
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

// Catch unhandled promise rejections to avoid silent failures.
process.on("unhandledRejection", (err) => {
  console.error("Unhandled rejection:", err);
});

main();
