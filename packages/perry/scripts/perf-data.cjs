function syntheticMeetingNote(index) {
  const project = index % 3 === 0 ? "Wallace" : index % 3 === 1 ? "Platypi" : "Perry";
  return {
    source: "granola",
    sourceId: `synthetic-${index}`,
    title: `${project} product review ${index}`,
    creatorName: "Synthetic Runner",
    attendees: [
      { name: "Ada", email: "ada@doppel.example" },
      { name: "Grace", email: "grace@doppel.example" },
    ],
    startedAt: "2026-05-23T15:00:00.000Z",
    sourceUrl: `https://notes.granola.ai/synthetic-${index}`,
    summaryMarkdown: `Decisions:
- Use ${project} route ${index}.
- Keep source citations for project ${project}.

Action items:
- Ada: Review ${project} follow-up ${index} by tomorrow
- Grace: Update Notion docs for ${project} ${index}`,
  };
}

module.exports = {
  syntheticMeetingNote,
};
