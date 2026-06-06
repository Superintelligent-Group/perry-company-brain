function createSyntheticCompanyCorpus(options = {}) {
  const count = Math.max(1, Number(options.count || 100));
  const seed = Number(options.seed || 42);
  const includeEdgeCases = options.edgeCases !== false;
  const random = lcg(seed);
  const projects = ["Wallace", "Perry", "Atlas", "Notion Wiki", "Discord Ops", "Graph Memory"];
  const people = [
    { name: "Ada", email: "ada@doppel.example" },
    { name: "Ben", email: "ben@doppel.example" },
    { name: "Mira", email: "mira@doppel.example" },
    { name: "Chen", email: "chen@doppel.example" },
    { name: "Perry", email: "perry@doppel.example" },
  ];
  const topics = ["onboarding", "routing", "wiki publishing", "graph sync", "retrieval quality", "customer handoff"];
  const verbs = [
    "publish approved notes to Notion",
    "post concise updates to Discord",
    "keep graph sync asynchronous",
    "preserve retry state in SQLite",
    "measure retrieval quality weekly",
    "require approval before customer-visible posting",
  ];

  const ownerByProject = new Map(projects.map((project, index) => [project, people[index % people.length]]));
  const items = [];
  const duplicatePayloads = [];
  const edgeCaseCounts = {
    ownerChanges: 0,
    longTranscripts: 0,
    privateNotes: 0,
    duplicatePayloads: 0,
    missingSummaries: 0,
    sparseAttendees: 0,
  };

  for (let index = 0; index < count; index += 1) {
    const project = projects[index % projects.length];
    const topic = topics[Math.floor(random() * topics.length)];
    let owner = ownerByProject.get(project);
    const previousOwner = owner;
    const shouldChangeOwner = includeEdgeCases && index > 0 && index % 11 === 0;
    if (shouldChangeOwner) {
      owner = people[(people.indexOf(owner) + 2) % people.length];
      ownerByProject.set(project, owner);
      edgeCaseCounts.ownerChanges += 1;
    }

    const actionOwner = people[(people.indexOf(owner) + 1) % people.length];
    const date = new Date(Date.UTC(2026, 4, 1 + (index % 28), 14 + (index % 6), 0, 0));
    const noteId = `synthetic-${slug(project)}-${String(index + 1).padStart(4, "0")}`;
    const title = `${project} ${capitalize(topic)} Review ${String(index + 1).padStart(4, "0")}`;
    const decisionOne = shouldChangeOwner
      ? `${owner.name} now owns ${project} ${topic}; ${previousOwner.name} is the fallback reviewer.`
      : `${owner.name} owns ${project} ${topic} until the next planning review.`;
    const decisionTwo = `${project} should ${verbs[index % verbs.length]}.`;
    const actionOne = `${actionOwner.name}: Prepare the ${project} ${topic} follow-up by 2026-06-${String((index % 20) + 1).padStart(2, "0")}.`;
    const actionTwo = `${owner.name}: Verify ${project} documentation links.`;
    const hasLongTranscript = includeEdgeCases && index % 13 === 0;
    const hasPrivateNotes = includeEdgeCases && index % 5 === 0;
    const hasSparseAttendees = includeEdgeCases && index % 17 === 0;
    const missingSummary = includeEdgeCases && index % 29 === 0;

    if (hasLongTranscript) edgeCaseCounts.longTranscripts += 1;
    if (hasPrivateNotes) edgeCaseCounts.privateNotes += 1;
    if (hasSparseAttendees) edgeCaseCounts.sparseAttendees += 1;
    if (missingSummary) edgeCaseCounts.missingSummaries += 1;

    const summary = missingSummary
      ? ""
      : [
          "Decisions:",
          `- ${decisionOne}`,
          `- ${decisionTwo}`,
          "",
          "Action items:",
          `- ${actionOne}`,
          `- ${actionTwo}`,
        ].join("\n");

    const payload = {
      note_id: noteId,
      title,
      summary,
      my_notes: hasPrivateNotes ? `PRIVATE_SYNTHETIC_MARKER ${project} ${topic} escalation details.` : undefined,
      transcript: hasLongTranscript
        ? Array.from({ length: 80 }, (_, line) => `TRANSCRIPT_SYNTHETIC_MARKER ${project} ${topic} line ${line + 1}.`).join("\n")
        : `${owner.name} said ${project} ${topic} needs clear ownership and durable notes.`,
      calendar_event: {
        title,
        start_time: date.toISOString(),
      },
      attendees: hasSparseAttendees ? [] : [owner, actionOwner],
      folder_name: project,
      link: `https://notes.granola.example/${noteId}`,
    };

    const expected = {
      decisions: missingSummary ? [] : [decisionOne, decisionTwo],
      actions: missingSummary
        ? []
        : [
            { owner: actionOwner.name, text: actionOne.replace(`${actionOwner.name}: `, "") },
            { owner: owner.name, text: actionTwo.replace(`${owner.name}: `, "") },
          ],
      search: missingSummary
        ? [{ query: title, mustContain: project }]
        : [{ query: title, mustContain: project }],
    };

    items.push({
      id: noteId,
      project,
      topic,
      owner: owner.name,
      edgeCases: {
        ownerChange: shouldChangeOwner,
        longTranscript: hasLongTranscript,
        privateNotes: hasPrivateNotes,
        missingSummary,
        sparseAttendees: hasSparseAttendees,
      },
      payload,
      expected,
    });

    if (includeEdgeCases && index % 19 === 0) {
      duplicatePayloads.push(payload);
      edgeCaseCounts.duplicatePayloads += 1;
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    seed,
    count,
    edgeCaseCounts,
    items,
    duplicatePayloads,
  };
}

function lcg(seed) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function capitalize(value) {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

module.exports = {
  createSyntheticCompanyCorpus,
};
