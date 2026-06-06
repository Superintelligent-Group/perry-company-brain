import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRoadmapMarkdown } from './roadmap-md.js';

test('parses ## goals with checkbox tasks into open/closed counts', () => {
  const md = `# Roadmap

## Q3 Launch
- [x] Auth
- [x] Billing
- [ ] Dashboard

## Mobile app
- [ ] iOS
- [ ] Android
`;
  const goals = parseRoadmapMarkdown(md);
  assert.equal(goals.length, 2);
  assert.deepEqual(goals[0], { title: 'Q3 Launch', dueOn: undefined, openCount: 1, closedCount: 2 });
  assert.deepEqual(goals[1], { title: 'Mobile app', dueOn: undefined, openCount: 2, closedCount: 0 });
});

test('parses a (due: …) suffix and strips it from the title', () => {
  const goals = parseRoadmapMarkdown('## Ship v1 (due: 2026-09-01)\n- [ ] a\n');
  assert.equal(goals[0]!.title, 'Ship v1');
  assert.equal(goals[0]!.dueOn, '2026-09-01');
});

test('skips a heading with no checkbox tasks (prose, not a tracked goal)', () => {
  const md = `## Intro
Some prose, no tasks.

## Real goal
- [x] done
`;
  const goals = parseRoadmapMarkdown(md);
  assert.equal(goals.length, 1);
  assert.equal(goals[0]!.title, 'Real goal');
});

test('accepts [X], and -, *, + bullet markers', () => {
  const goals = parseRoadmapMarkdown('## G\n- [X] a\n* [ ] b\n+ [x] c\n');
  assert.deepEqual(goals[0], { title: 'G', dueOn: undefined, openCount: 1, closedCount: 2 });
});

test('counts indented (nested) tasks too', () => {
  const goals = parseRoadmapMarkdown('## G\n- [x] top\n    - [ ] nested\n');
  assert.deepEqual(goals[0], { title: 'G', dueOn: undefined, openCount: 1, closedCount: 1 });
});

test('tasks before any ## heading fall under an implicit goal named from the H1', () => {
  const goals = parseRoadmapMarkdown('# Project Plan\n- [x] a\n- [ ] b\n');
  assert.equal(goals.length, 1);
  assert.equal(goals[0]!.title, 'Project Plan');
  assert.deepEqual({ open: goals[0]!.openCount, closed: goals[0]!.closedCount }, { open: 1, closed: 1 });
});

test('tasks with no H1 or heading fall under a "Roadmap" goal', () => {
  const goals = parseRoadmapMarkdown('- [ ] a\n- [x] b\n');
  assert.equal(goals[0]!.title, 'Roadmap');
});

test('empty content yields no goals', () => {
  assert.deepEqual(parseRoadmapMarkdown(''), []);
});
