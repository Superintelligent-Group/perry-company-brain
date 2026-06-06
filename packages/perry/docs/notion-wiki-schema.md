# Notion Wiki Schema

Perry should write to Notion as a durable wiki, not as an unstructured note dump.
The TypeScript contract lives in `src/notionWikiSchema.ts`.

## Meeting Notes

- `Title`: meeting title.
- `Source`: Granola, Discord, manual, or future capture source.
- `Source ID`: idempotency/source id.
- `Date`: meeting start time.
- `Granola Link`: original note link when present.
- `Attendees`: compact attendee list.
- `Project`: routed project.
- `Discord Message`: posted announcement URL.
- `Graph Entity`: stable graph key, usually `meeting:<meetingId>`.

## Decisions

- `Decision`: decision text.
- `Meeting`: relation/backlink to meeting note.
- `Project`: routed or inferred project.
- `Status`: proposed, accepted, rejected.
- `Owner`: person or responsible party when extractable.
- `Evidence`: source excerpt or link.
- `Graph Fact`: stable fact key when projected into graph memory.

## Action Items

- `Action`: action text.
- `Meeting`: relation/backlink to meeting note.
- `Owner`: responsible person.
- `Due Date`: date if extracted.
- `Status`: open, done, wont-do.
- `Project`: routed or inferred project.
- `Source Action ID`: Perry action id.
- `Graph Entity`: stable graph key.

## Projects

- `Project`: project name.
- `Owner`: current owner.
- `Status`: active, paused, archived.
- `Discord Channel`: channel id or URL.
- `Repository`: primary repo.
- `Graph Entity`: stable graph key, usually `project:<slug>`.

Next implementation pass should create/sync decision, action, and project records
in addition to meeting pages, while preserving source links and graph keys.
