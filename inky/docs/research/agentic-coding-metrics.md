---
created: 2026-05-30
status: active
author: Claude main session (web-grounded research)
session: inky-phase3
branch: main
informed_by: User request to research proper engineering metrics in the age of agentic coding (LOC is misleading) and to check what top teams (Google, Spotify, Netflix, Anthropic) + startups actually do; Inky's existing GitHub activity extraction (src/types.ts, summarize.ts, github.ts)
notes: Web-grounded research (verified citations as of 2026-05-30) on engineering productivity/output & code-quality metrics for the agentic-coding era, mapped to what Inky can compute from GitHub data, to inform the optional stats panel. Supersedes the earlier offline draft.
---

# Software-Engineering Metrics for the Agentic-Coding Era

> Research backing Inky's optional stats panel. Verified against live sources (2024–2026). Bottom line up top: **measure the team, not the individual; favor outcomes and flow over volume; treat lines-of-code as cost, not output — especially now that agents write most of the code.**

## 0. Thesis

The information already lives in GitHub, but the *naïve* readings of it (LOC, commit counts, per-person rankings) are wrong, and agentic coding makes them more wrong. Every credible 2024–2026 framework and every top team converges on the same shape: a small set of **balanced, team-level** signals that pair *throughput* with *stability/quality*, plus *developer-experience* signals that volume metrics can't see. Inky should reflect that — which is why its panel is team-level, labels LOC "size, not score," and now pairs PR cycle time (throughput) with revert rate (stability).

## 1. Why LOC/churn is broken — and worse under agents

LOC has been known-harmful since the 1980s ("measuring programming progress by lines of code is like measuring aircraft building progress by weight"). The agentic wrinkle is that the old failure mode is now *industrialized*:

- **Agents generate verbose code by default**, so diff volume decouples almost entirely from value. A high "lines/day" now reads as a *negative* quality signal, not a positive one ([Faros AI](https://www.faros.ai/blog/lines-of-code-metric-ai-vanity-outcome), [InfoWorld](https://www.infoworld.com/article/4135492/ai-agents-and-bad-productivity-metrics.html)).
- **Every line is a liability** to secure, observe, and maintain; making code cheaper to write *increases* total work by manufacturing more liability per hour ([Antifound: "Codegen is not productivity"](https://www.antifound.com/posts/codegen-is-not-productivity/)).
- LOC is now being used to *justify AI spend*, which is exactly the streetlight-effect trap ([thomaspowell.com](https://thomaspowell.com/2026/02/11/lines-of-code-metric-ai-maintenance-cost/)).

**Implication for Inky:** keep LOC visible (people want the scale of change) but explicitly framed as *size, not score*, and never as the headline. Done.

## 2. The established frameworks (and what they actually measure)

### DORA — the four keys + the AI findings
Deployment frequency, lead time for changes, change failure rate, failed-deployment recovery time. Two keys are throughput, two are stability — deliberately balanced. The AI findings are the headline for us:

- **2024 report:** as AI adoption rose, the model estimated **throughput −1.5%** and **stability −7.2%** — AI sped up individual coding but hurt *delivery*, because larger AI-generated change lists violate small-batch/testing fundamentals ([DORA 2024](https://dora.dev/research/2024/dora-report/), [Google Cloud](https://cloud.google.com/blog/products/devops-sre/announcing-the-2024-dora-report), [RedMonk](https://redmonk.com/rstephens/2024/11/26/dora2024/)).
- **2025 report:** throughput **reversed to positive** (teams now ship more with AI) but **stability remains negative**; AI adoption hit ~90%. The framing shifted to *"AI amplifies what already exists"* — strong teams get stronger, weak teams get more unstable — and DORA replaced the low/med/high/elite tiers with **seven team archetypes**, and added a **rework** signal ([Google Cloud 2025](https://cloud.google.com/blog/products/ai-machine-learning/announcing-the-2025-dora-report), [Faros takeaways](https://www.faros.ai/blog/key-takeaways-from-the-dora-report-2025), [RedMonk 2025](https://redmonk.com/rstephens/2025/12/18/dora2025/)).

The throughput↔stability tension is *the* agentic-era story, and it's exactly the pair Inky now shows (PR cycle time + revert rate).

### SPACE — five dimensions, no single number
Satisfaction & well-being, Performance, Activity, Communication & collaboration, Efficiency & flow. From Forsgren, Storey, Maddila, Zimmermann, Houck, Butler (Microsoft Research / GitHub / UVic, 2021). Core rule: **measure ≥3 dimensions at once, mixing objective metrics with surveys**; no one number captures productivity ([ACM Queue](https://queue.acm.org/detail.cfm?id=3454124), [CACM](https://cacm.acm.org/practice/the-space-of-developer-productivity/)). Inky can only touch *Activity* (and weakly *Performance*) from GitHub — a reason to be humble about what a GitHub-only tool can claim.

### DX Core 4 — the 2025 practitioner consolidation
Folds DORA + SPACE + DevEx into four **oppositional** dimensions ([getdx.com](https://getdx.com/dx-core-4/), [InfoQ](https://www.infoq.com/news/2025/01/dx-core-4-framework/)):
- **Speed** — *diffs per engineer* (throughput; controversial, used only with guardrails)
- **Effectiveness** — Developer Experience Index (survey-based)
- **Quality** — *change failure rate*
- **Impact** — *% of time on new capabilities* (vs. maintenance/KTLO)

"Oppositional" is the key idea: never show speed without quality next to it.

### Google — Goals/Signals/Metrics (GSM)
From *Software Engineering at Google*: start with a **Goal**, define **Signals** (what you'd see if you achieved it), then **Metrics** (measurable proxies). Explicitly designed to **prevent the streetlight effect** — measuring what's easy instead of what matters. Google frames productivity as five components (quality, attention/flow, intellectual complexity, tempo/velocity, satisfaction) ([SWE at Google, ch.7](https://abseil.io/resources/swe-book/html/ch07.html)). Lesson for Inky: a stat is only worth showing if it traces back to a real goal — otherwise it's noise.

### DevEx — the developer-experience lens (what volume can't see)
From the SPACE authors (Noda, Forsgren, Storey, Greiler): three dimensions — **feedback loops, cognitive load, flow state** ([InfoQ](https://www.infoq.com/articles/devex-metrics-framework/)). GitHub activity can't measure these; honest scope boundary for Inky.

## 3. The McKinsey debate (why individual metrics backfire)
McKinsey's Aug-2023 "Yes, you can measure developer productivity" drew a ~12,000-word rebuttal from Gergely Orosz and Kent Beck: it measures **effort/output, not outcomes/impact**, and measuring early in the effort→output→outcome→impact chain **creates perverse incentives** ([Pragmatic Engineer pt.1](https://newsletter.pragmaticengineer.com/p/measuring-developer-productivity), [pt.2](https://newsletter.pragmaticengineer.com/p/measuring-developer-productivity-part-2), [LeadDev](https://leaddev.com/career-development/what-mckinsey-got-wrong-about-developer-productivity)). This is the strongest argument for Inky keeping per-person stats *optional* and team-level by default — Goodhart's law is not hypothetical here.

## 4. What leading teams actually do

- **Netflix — "context, not control."** Productivity teams take a *contextualized* view and explicitly **refuse to rank developers or teams against each other**: every team's space, users, and lifecycle stage differ, so cross-comparison is "downright dangerous for morale" ([Dev Interrupted/LinearB](https://linearb.io/dev-interrupted/blog/creating-a-culture-of-engineering-productivity-at-netflix)). → Inky default: team-level, no leaderboard.
- **Spotify — workflow + perception, and fleet-scale automation.** Pairs workflow metrics with **quarterly DevEx surveys**; built **Fleet Management** to apply code transforms across thousands of components (Apollo upgrades 200→<7 days). In 2025 they ran a **background coding agent ("Honk") that opened 1,500+ PRs** — concrete proof that "PRs/commits" volume now partly reflects *agents*, not people ([The New Stack](https://thenewstack.io/metrics-driven-developer-productivity-engineering-at-spotify/), [Spotify Eng: Honk](https://engineering.atspotify.com/2025/11/spotifys-background-coding-agent-part-1)). → reinforces: never read raw PR/commit counts as human output.
- **Google — GSM + heavy investment in review health and code-review research** (§2). → a metric needs a goal behind it.
- **Anthropic — throughput up, but paired with judgment.** Internally, adopting Claude Code drove a **67% increase in merged PRs per engineer per day**, the majority of code is now written by Claude Code, and engineers shifted to architecture/orchestration of parallel agents; self-reported Claude usage went 28%→59% of work and +20%→+50% productivity ([Anthropic: How AI is transforming work](https://www.anthropic.com/research/how-ai-is-transforming-work-at-anthropic), [How Anthropic teams use Claude Code](https://claude.com/blog/how-anthropic-teams-use-claude-code)). Note their headline is **merged-PRs-per-engineer** — a throughput metric Inky already has — but it only means something alongside review and stability.
- **Startups (2025–2026 consensus).** Favor **outcome/time-to-value and cycle time** over velocity; adopt DORA (now often + a **rework-rate** 5th signal); and explicitly **don't** use individual PR-count/story-point velocity as a performance metric — it just gets gamed ([Revelo](https://www.revelo.com/blog/engineering-metrics-2025), [Stack Overflow: beyond speed](https://stackoverflow.blog/2025/05/12/beyond-speed-measuring-engineering-success-by-impact-not-velocity/), [getdx: metrics top teams use](https://getdx.com/blog/engineering-metrics-top-teams/)).

**Common thread across all of them:** team-level, balanced (speed *with* quality), outcome-leaning, survey-augmented where possible, and deeply wary of individual rankings.

## 5. Code-quality signals derivable from GitHub data only

| Signal | What it indicates | Noise / gameability |
|---|---|---|
| **Revert / explicit-revert rate** | Stability — change that had to be undone | Low N is noisy; only true reverts (not `fix:`, which is normal work) |
| **Median PR cycle time** (open→merged) | Flow/throughput; review latency | Promotion/auto-merge PRs drag it to ~0 (exclude them); fast-merge teams read as minutes |
| **Time-to-first-review** | The new bottleneck once agents speed up coding | Needs pairing PR-open with first non-self review |
| **PR size distribution** | Batch size (a DORA fundamental); agents inflate it | Easy to split/pad PRs |
| **Unshipped→shipped ratio** | WIP vs. delivered | Branch-workflow dependent |
| **Test-file touch ratio** | Test discipline alongside change | Gameable; touching ≠ meaningful tests |
| **Bug-labeled issue rate** | Defect inflow | Label hygiene varies wildly |
| **Churn-of-churn** (lines rewritten soon after merge) | Instability / rework | Needs cross-window history |

## 6. Recommendation table for Inky

Reflecting what the build already extracts (`src/types.ts`, `computeOrgTotals`/`computeTeamStats` in `summarize.ts`, `fetchCommits`/`fetchPullRequests` in `github.ts`). **All team-level.**

| Metric | Signals | In Inky today | Caveat |
|---|---|---|---|
| PRs merged / opened | Throughput | ✅ shipped | Promotion PRs inflate counts |
| **Median PR cycle time** | Flow/throughput | ✅ shipped (excludes promotions) | Fast-merge teams → minutes; not quality |
| **Revert rate** | Stability | ✅ shipped | True reverts only; noisy at low N |
| Commits + unshipped | Activity / WIP visibility | ✅ shipped | Activity ≠ output |
| Net LOC (noise-filtered) | Size of change | ✅ shipped, labeled *size, not score* | Never a productivity headline |
| Reviews given | Collaboration | ✅ shipped | Count ≠ review depth |
| Unshipped→shipped ratio | Delivery vs. WIP | ✅ derivable (unshipped flag) | Branch-workflow dependent |
| **Time-to-first-review** | Review bottleneck | ✅ shipped — derived from in-window reviews + PR open times (no new fetch needed) | Only shows when the team reviews PRs |
| **PR size distribution** | Batch size | ✅ shipped (% small + XS/S/M/L/XL spread, promotions excluded) | Agentic inflation; raw PR add/del (not noise-filtered) |
| Test-file touch ratio | Test discipline | ⏳ needs fetch (filenames discarded in churn loop) | Gameable |
| Bug-labeled issue rate | Defect inflow | ⏳ needs labels (not fetched) | Label hygiene |
| Change failure rate / MTTR | DORA quality | ❌ needs deploy/CI data (out of GitHub-activity scope) | Only if CI integrated |

## 7. Framing guidance (inform, don't surveil)
- **Team-level by default**; per-person behind an explicit opt-in (Inky: `statsPerPerson`). Netflix/McKinsey/startup consensus.
- **Always pair speed with stability** (DX Core 4 "oppositional"): cycle time next to revert rate, never throughput alone.
- **Label cost as cost:** LOC is *size, not score* (done).
- **No leaderboards, no "top contributor," no single productivity score.**
- Acknowledge the ceiling: GitHub-only ≈ SPACE's *Activity* dimension; it cannot see satisfaction, cognitive load, or business impact. Don't over-claim.

## 8. If I were building Inky's stats block
- **Daily** — keep it a terse pulse, stats *off* by default (Inky does this): the narrative is enough.
- **Weekly+** — the team panel, in this order: PRs merged/opened → **median PR cycle time** → **median time-to-first-review** (when the team reviews) → **PR size distribution** (% small + XS/S/M/L/XL) → commits (+unshipped) → **revert rate** → repos → net LOC (*size, not score*). **This is shipped** — including time-to-first-review (derived from in-window reviews + PR open times, no extra fetch) and the PR size distribution (% small headline + the spread, promotions excluded).
- **Next, in value order:**
  1. **Week-over-week trends** on the above — a single number is a snapshot; the *direction* is the signal.
  2. **Test-file touch ratio** — needs retaining filenames in the churn loop; a weak but cheap discipline signal.
- **Avoid:** per-person LOC/commit leaderboards, raw unfiltered LOC headlines, any single "productivity score."

## Sources
- DORA 2024 report — https://dora.dev/research/2024/dora-report/ · https://cloud.google.com/blog/products/devops-sre/announcing-the-2024-dora-report · https://redmonk.com/rstephens/2024/11/26/dora2024/
- DORA 2025 report — https://cloud.google.com/blog/products/ai-machine-learning/announcing-the-2025-dora-report · https://www.faros.ai/blog/key-takeaways-from-the-dora-report-2025 · https://redmonk.com/rstephens/2025/12/18/dora2025/
- SPACE framework — https://queue.acm.org/detail.cfm?id=3454124 · https://cacm.acm.org/practice/the-space-of-developer-productivity/
- DX Core 4 — https://getdx.com/dx-core-4/ · https://www.infoq.com/news/2025/01/dx-core-4-framework/ · https://leaddev.com/reporting/dx-core-4-aims-to-unify-developer-productivity-frameworks
- DevEx framework — https://www.infoq.com/articles/devex-metrics-framework/
- Google GSM / SWE at Google — https://abseil.io/resources/swe-book/html/ch07.html
- McKinsey debate — https://newsletter.pragmaticengineer.com/p/measuring-developer-productivity · https://newsletter.pragmaticengineer.com/p/measuring-developer-productivity-part-2 · https://leaddev.com/career-development/what-mckinsey-got-wrong-about-developer-productivity
- LOC critique — https://www.faros.ai/blog/lines-of-code-metric-ai-vanity-outcome · https://www.antifound.com/posts/codegen-is-not-productivity/ · https://www.infoworld.com/article/4135492/ai-agents-and-bad-productivity-metrics.html
- Netflix — https://linearb.io/dev-interrupted/blog/creating-a-culture-of-engineering-productivity-at-netflix
- Spotify — https://thenewstack.io/metrics-driven-developer-productivity-engineering-at-spotify/ · https://engineering.atspotify.com/2025/11/spotifys-background-coding-agent-part-1
- Anthropic — https://www.anthropic.com/research/how-ai-is-transforming-work-at-anthropic · https://claude.com/blog/how-anthropic-teams-use-claude-code
- Startups — https://www.revelo.com/blog/engineering-metrics-2025 · https://stackoverflow.blog/2025/05/12/beyond-speed-measuring-engineering-success-by-impact-not-velocity/ · https://getdx.com/blog/engineering-metrics-top-teams/
