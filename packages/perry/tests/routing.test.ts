import assert from "node:assert/strict";
import test from "node:test";
import { AppSettingsSchema } from "@core";
import { resolveMeetingRoute } from "@meetings";

test("routes meetings by title keyword and attendee", () => {
  const settings = AppSettingsSchema.parse({
    discord: { meetingChannelId: "default-channel", adminRoleIds: [] },
    notion: { meetingNotesDataSourceId: "default-source" },
    standup: {},
    granola: {},
    roster: [],
    routingRules: [
      {
        id: "wallace",
        name: "Wallace",
        project: "Wallace",
        titleKeywords: ["wallace"],
        attendeeEmails: ["pm@doppel.example"],
        discordChannelId: "wallace-channel",
        notionDataSourceId: "wallace-source",
        publishMode: "approval",
      },
    ],
  });

  const route = resolveMeetingRoute(
    {
      source: "granola",
      title: "Wallace planning",
      attendees: [{ email: "pm@doppel.example" }],
      summaryMarkdown: "Decision: continue.",
    },
    settings
  );

  assert.equal(route.project, "Wallace");
  assert.equal(route.discordChannelId, "wallace-channel");
  assert.equal(route.notionDataSourceId, "wallace-source");
});
