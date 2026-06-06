function createSyntheticCompanyArcCorpus(options = {}) {
  const projectCount = Math.max(1, Number(options.projects || 6));
  const meetingsPerProject = Math.max(3, Number(options.meetingsPerProject || 5));
  const seed = Number(options.seed || 101);
  const random = lcg(seed);
  const projects = ["Wallace", "Perry", "Atlas", "Notion Wiki", "Discord Ops", "Graph Memory", "Context Engine", "Customer Brain"];
  const subjects = ["onboarding", "retrieval quality", "customer escalation", "graph sync", "wiki publishing", "Discord routing", "incident review", "evidence review"];
  const customers = ["Acme", "Northstar", "Helio", "Meridian", "ExampleCo", "Nimbus"];
  const people = [
    { name: "Ada", email: "ada@doppel.example" },
    { name: "Ben", email: "ben@doppel.example" },
    { name: "Mira", email: "mira@doppel.example" },
    { name: "Iris", email: "iris@doppel.example" },
    { name: "Kai", email: "kai@doppel.example" },
    { name: "Jules", email: "jules@doppel.example" },
    { name: "Sam", email: "sam@doppel.example" },
    { name: "Perry", email: "perry@doppel.example" },
  ];

  const items = [];
  const finalOwnership = [];
  const expectedSearch = [];
  const expectedOwnerActionMinimums = new Map();
  const arcSummaries = [];
  let ownershipChangeCount = 0;

  for (let projectIndex = 0; projectIndex < projectCount; projectIndex += 1) {
    const baseProject = projects[projectIndex % projects.length];
    const cohort = Math.floor(projectIndex / projects.length) + 1;
    const project = cohort === 1 ? baseProject : `${baseProject} Program ${cohort}`;
    const subject = `${project} ${subjects[(projectIndex + seed) % subjects.length]}`;
    const customer = customers[(projectIndex * 3 + seed) % customers.length];
    let owner = people[(projectIndex + seed) % people.length];
    let previousOwner;
    const fallback = people[(projectIndex + 2 + seed) % people.length];
    const arcId = slug(`${project}-${subject}`);

    for (let step = 0; step < meetingsPerProject; step += 1) {
      const shouldHandoff = step === Math.floor(meetingsPerProject / 2) || (meetingsPerProject > 4 && step === meetingsPerProject - 1 && projectIndex % 2 === 0);
      if (shouldHandoff) {
        previousOwner = owner;
        owner = nextOwner(people, owner, projectIndex + step);
        ownershipChangeCount += 1;
      }
      const reviewer = people[(people.indexOf(owner) + 1) % people.length];
      const actionOwner = people[(people.indexOf(owner) + 3 + step) % people.length];
      const date = new Date(Date.UTC(2026, 4, 1 + projectIndex, 9 + step, step, 0));
      const noteId = `arc-${String(projectIndex + 1).padStart(2, "0")}-${String(step + 1).padStart(2, "0")}-${arcId}`;
      const title = `${project} ${customer} Arc ${step + 1}: ${arcTitle(step, shouldHandoff)}`;
      const decisionOne = shouldHandoff
        ? `${owner.name} now owns ${subject}; ${previousOwner.name} is the fallback reviewer.`
        : `${owner.name} owns ${subject} until the next planning review.`;
      const decisionTwo = decisionForStep({ project, subject, customer, step, random });
      const actionOneText = actionForStep({ project, subject, customer, step });
      const actionTwoText = `Review evidence trail for ${subject} before the next arc checkpoint.`;
      const dueDay = String(Math.min(28, 3 + projectIndex + step)).padStart(2, "0");
      const summary = [
        "Decisions:",
        `- ${decisionOne}`,
        `- ${decisionTwo}`,
        "",
        "Action items:",
        `- ${actionOwner.name}: ${actionOneText} by 2026-06-${dueDay}.`,
        `- ${reviewer.name}: ${actionTwoText}`,
      ].join("\n");

      increment(expectedOwnerActionMinimums, actionOwner.name);
      increment(expectedOwnerActionMinimums, reviewer.name);
      expectedSearch.push({ query: `${project} ${customer} ${arcTitle(step, shouldHandoff)}`, mustContain: customer });
      if (shouldHandoff) expectedSearch.push({ query: `${owner.name} now owns ${project}`, mustContain: `${owner.name} now owns ${subject}` });

      items.push({
        id: noteId,
        project,
        subject,
        step,
        payload: {
          note_id: noteId,
          title,
          summary,
          my_notes: `PRIVATE_SYNTHETIC_MARKER ${project} arc ${step + 1} private operator note for ${customer}.`,
          transcript: transcriptForStep({ project, subject, owner: owner.name, customer, step }),
          calendar_event: {
            title,
            start_time: date.toISOString(),
          },
          attendees: [owner, reviewer, actionOwner],
          folder_name: project,
          link: `https://notes.granola.example/${noteId}`,
        },
        expected: {
          decisions: [decisionOne, decisionTwo],
          actions: [
            { owner: actionOwner.name, text: `${actionOneText} by 2026-06-${dueDay}.` },
            { owner: reviewer.name, text: actionTwoText },
          ],
          search: [{ query: `${project} ${customer}`, mustContain: customer }],
        },
      });
    }

    finalOwnership.push({
      project,
      subject,
      owner: owner.name,
      previousOwner: previousOwner?.name,
    });
    arcSummaries.push({ project, subject, customer, finalOwner: owner.name, previousOwner: previousOwner?.name });
  }

  return {
    generatedAt: new Date().toISOString(),
    seed,
    projectCount,
    meetingsPerProject,
    count: items.length,
    items,
    expected: {
      finalOwnership,
      ownershipChangeCount,
      ownerActionMinimums: Object.fromEntries(expectedOwnerActionMinimums),
      search: expectedSearch.slice(0, Math.max(20, projectCount * 4)),
      arcSummaries,
    },
  };
}

function nextOwner(people, current, salt) {
  const currentIndex = people.indexOf(current);
  const offset = (Math.abs(salt) % (people.length - 1)) + 1;
  return people[(currentIndex + offset) % people.length];
}

function arcTitle(step, handoff) {
  if (step === 0) return "Kickoff";
  if (handoff) return "Ownership Handoff";
  if (step % 3 === 1) return "Customer Escalation";
  if (step % 3 === 2) return "Conflict Review";
  return "Evidence Review";
}

function decisionForStep({ project, subject, customer, step, random }) {
  if (step % 4 === 1) return `${project} must preserve ${customer} escalation evidence in Perry before Discord posting.`;
  if (step % 4 === 2) return `${project} will keep ${subject} graph updates asynchronous until replay diff is clean.`;
  if (step % 4 === 3) return `${project} should treat stale ${subject} actions as blockers during weekly review.`;
  const threshold = Math.round((0.7 + random() * 0.2) * 100) / 100;
  return `${project} retrieval quality target for ${customer} is ${threshold} minimum answer confidence.`;
}

function actionForStep({ project, subject, customer, step }) {
  if (step % 4 === 1) return `Prepare ${customer} escalation summary for ${project}`;
  if (step % 4 === 2) return `Replay graph evidence for ${subject}`;
  if (step % 4 === 3) return `Close stale actions linked to ${subject}`;
  return `Publish ${project} arc checkpoint for ${customer}`;
}

function transcriptForStep({ project, subject, owner, customer, step }) {
  return [
    `TRANSCRIPT_SYNTHETIC_MARKER ${project} arc step ${step + 1}.`,
    `${owner} discussed ${subject} with ${customer}.`,
    `The transcript intentionally includes richer context that must not leak to Discord by default.`,
  ].join(" ");
}

function increment(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

function lcg(seed) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

module.exports = {
  createSyntheticCompanyArcCorpus,
};