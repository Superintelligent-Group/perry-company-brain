---
created: 2026-06-04
status: active
author: Claude main session
session: 00f2d3f5-05eb-4c65-a9d4-0147669a31d9
branch: main
informed_by: Track A (adoption) of roadmap-and-phase-6.md §"Distribution"; the project plan §1 wedge, §2 competitive landscape, §3 open-core thesis; inky-status memory; the live MVP feature set (§10)
notes: Ready-to-post launch/distribution copy for Inky's go-to-market — awesome-list entries, an r/selfhosted post, a Product Hunt listing, and a "why we built this" blog draft. Open-core OSS adoption IS the go-to-market for the paid hosted tier, so this is the highest-leverage hour in Track A. Paste-and-go; tweak voice to taste.
---

# Inky — distribution kit

Track A's distribution assets, drafted to post. The thesis (plan §3): in open-core,
**OSS adoption is the go-to-market for the paid tier**, so seeding the right channels
is the highest-leverage move now. Everything below is paste-ready; adjust voice to
taste. Honest framing throughout — Inky reads *GitHub activity*, not "everything a
person did" (plan §8), and it's early.

**The one-line pitch (reuse everywhere):**
> Inky reads your org's GitHub activity and writes the team's daily standup to Discord — automatically, with zero human input.

**The wedge (one sentence):**
> Every other standup bot DMs a human "what did you do yesterday?"; Inky derives the answer from your commits, PRs, issues, and reviews — *derived, not solicited.*

---

## 1. awesome-selfhosted

Submit via PR to [awesome-selfhosted/awesome-selfhosted](https://github.com/awesome-selfhosted/awesome-selfhosted).
Best-fit section: **Communication - Custom Communication Systems** (or *Software
Development - Project Management*). Entry format the list requires (alphabetical
within section, license + language tags, no trailing period rules vary — match
neighbors):

```markdown
- [Inky](https://github.com/Doppel-Labs/inky) - Reads your organization's GitHub activity (commits, PRs, issues, reviews) and writes the team's daily/weekly standup to Discord automatically — no human input. AI-summarized, bring-your-own-LLM-key, with an optional status-vs-roadmap block. `MIT` `Nodejs`
```

Checklist before opening the PR (awesome-selfhosted is strict):
- [ ] Repo has a clear description, a license file (✓ MIT), and isn't a thin wrapper.
- [ ] Add to the **alphabetical** position within the chosen section.
- [ ] Project is self-hostable and documented (✓ `docs/deployment.md`).
- [ ] One entry, one section. Read their `CONTRIBUTING.md` for current tag syntax.

## 2. awesome-discord / awesome lists for bots

- [awesome-discord-communities](https://github.com/mhdhejazi/awesome-discord-communities) is *communities*, not bots — skip.
- Better targets: **awesome-discord** bot/library lists and **awesome-standup**-style
  lists if they exist; otherwise the general dev-tools awesome lists. Use the same
  one-liner. Only submit where Inky genuinely fits — irrelevant PRs get closed and
  burn goodwill.

## 3. r/selfhosted post

Subreddit rules: it must be genuinely self-hostable (✓), no pure-marketing tone,
disclose you're the author. Flair: **Release** or **Software – Other**.

**Title:**
> I built a Discord bot that writes your team's daily standup from GitHub activity — no "what did you do yesterday?" prompts (self-hosted, MIT)

**Body:**
```markdown
Every standup bot I tried (Geekbot, DailyBot, Standuply) works the same way: it DMs
each person "what did you do yesterday?" and waits for them to type an answer. But
that information already exists — it's in your commits, PRs, issues, and reviews.

So I built **Inky**: it reads your org's GitHub activity over the last day (or week)
and *writes the standup for you* — per person and project-wide — and posts it to
Discord. Zero human input. The inversion is the whole point: derived, not solicited.

What it does:
- Pulls commits / PRs / issues / reviews across all your org's repos via the GitHub API
- Collapses multiple commit identities into one person (alias map)
- Writes an AI summary grounded in the real activity (it summarizes, never invents —
  every claim ties to a concrete event), or a deterministic mechanical digest with no
  API key at all
- A team stats panel on weekly reports (PR cycle time, time-to-first-review, PR size
  distribution, revert rate) — labeled *size, not score*
- An optional "Status vs plan" block that reconciles activity against your GitHub
  Milestones (what advanced, what's stalled, what's at risk)
- Runs on its own schedule (daily + weekly from one worker) **and** answers an
  on-demand `/standup` slash command

It's **open-core** (MIT): free to self-host, bring-your-own LLM key (Anthropic / Groq
/ OpenAI, or any OpenAI-compatible endpoint). A managed hosted tier will come later
for teams who don't want to run it, but the self-host tool is and stays free.

Deploys to any always-on host (Render/Railway/Fly/Docker) — there's a `render.yaml`
and step-by-step docs. Node/TypeScript.

A note on framing: Inky reports *GitHub activity*, not "everything a person did" — it
can't see design work, calls, or planning. It's a team-visibility aid, not a
performance ranker, and I've tried hard to keep it that way.

Repo: https://github.com/Doppel-Labs/inky

I'm the author — happy to answer anything. Feedback on the roadmap (Slack delivery,
non-GitHub roadmap sources) very welcome.
```

*Tip:* post mid-week, morning US time; reply to early comments fast (r/selfhosted
rewards author engagement). Cross-post to **r/discordapp** and **r/devops** only if
it lands well — don't spray.

## 4. Product Hunt

**Name:** Inky
**Tagline (≤60 chars):**
> Your team's daily standup, written from GitHub
**Topics:** Developer Tools, Discord, GitHub, Open Source, Productivity

**Description:**
```
Inky reads your org's GitHub activity — commits, PRs, issues, reviews — and writes
your team's daily and weekly standup to Discord automatically. No "what did you do
yesterday?" prompts: the update is derived from work that already happened, not
solicited from people.

Open-core and MIT-licensed: self-host it free with your own LLM key (Anthropic, Groq,
or OpenAI). AI summaries are grounded in real activity — it summarizes, never invents.
Weekly reports add a team stats panel (PR cycle time, review latency, PR size), and an
optional status-vs-roadmap block reconciles activity against your GitHub Milestones.

Runs on a schedule and answers an on-demand /standup command. A managed hosted tier is
on the roadmap; the self-host tool stays free.
```

**Maker's first comment:**
```
Hi PH 👋 I built Inky because every standup tool makes a human re-type what's already
in GitHub. Inky inverts that — it reads the activity and writes the standup, so nobody
fills out a form. It's open-source (MIT) and self-hosted with your own LLM key; a
hosted tier comes later. It's early — I'd love feedback, especially on what roadmap
sources (Linear? Notion? a declared ROADMAP.md?) and delivery targets (Slack?) you'd
want next.
```

*Assets to attach:* the banner (`assets/inky-banner.png`), the logo as the thumbnail
(`assets/inky-logo-1024.png`), and — when captured — a screenshot/GIF of a real posted
standup (currently deferred). Launch 12:01am PT; line up a few people to engage early.

## 5. "Why we built Inky" — blog draft (~500 words)

> ### Standups ask the wrong question
>
> Every async standup bot on the market does the same thing: at 9am it DMs each person
> *"what did you do yesterday?"* and waits for them to type an answer. Geekbot,
> DailyBot, Standuply — same shape. We accepted it for years.
>
> But look at what actually happens in that exchange. A developer who spent yesterday
> shipping three PRs and reviewing two more stops, context-switches, and *re-types a
> summary of work that is already perfectly recorded* — in their commits, their pull
> requests, their issue comments, their reviews. The standup tool asks a human to
> hand-transcribe a database it could just read.
>
> That's the bug. Inky is the fix.
>
> ### Derived, not solicited
>
> Inky reads your organization's GitHub activity over the last day — or week — and
> *writes the standup for you*. Per person, project-wide, posted to Discord. Nobody
> fills out a form. The entire product is one inversion: the update is **derived from
> work that happened, not solicited from the people who did it.**
>
> Under the hood it pulls commits, PRs, issues, and reviews across every repo in your
> org, collapses each person's multiple git identities into one, filters out the noise
> (lockfiles, generated files, promotion PRs), and hands a *factual digest* to an LLM
> with one strict instruction: summarize this, never invent. Every sentence in the
> output ties to a real event. If you don't want AI in the loop at all, the
> deterministic digest runs with no API key.
>
> ### Numbers before narrative
>
> On weekly reports, Inky leads with a stats panel — PR cycle time, time-to-first-
> review, PR size distribution, revert rate — drawn straight from the data and grounded
> in real engineering-research (DORA, SPACE, DX Core 4). One rule we hold firm:
> lines-of-code is labeled *size, not score.* Inky is a team-visibility aid, not a
> performance ranker. It reports GitHub activity — not design work, not calls, not the
> planning nobody committed. We say so, out loud, in the tool.
>
> ### Where it's going
>
> Inky can already reconcile activity against your GitHub Milestones and tell you what
> advanced, what stalled, and what's at risk — *status vs. plan*, computed mechanically,
> narrated honestly. Next: roadmap sources beyond Milestones (a declared ROADMAP.md,
> Linear, Notion), week-over-week trends, and Slack delivery.
>
> ### Open-core, and the free part stays free
>
> Inky is MIT-licensed and self-hosted with your own LLM key — Anthropic, Groq, or
> OpenAI. A managed hosted tier is coming for teams who'd rather not run a worker, but
> the self-host tool is the product, not a trial. If your team lives in GitHub and
> talks in Discord, point Inky at your org and never write a standup again.
>
> **[github.com/Doppel-Labs/inky](https://github.com/Doppel-Labs/inky)**

*Where to publish:* the repo's own `/docs` or a dev.to / Hashnode cross-post; link it
from the r/selfhosted thread and the PH maker comment.

---

## Sequencing (don't dump all at once)

1. **Seed Discussions** (welcome post) + flip on the Discussions feature.
2. **awesome-selfhosted PR** — slow to merge, start it first.
3. **Blog post** live (it's the link everything else points to).
4. **r/selfhosted** post (mid-week AM) — the biggest single spike for self-host tools.
5. **Product Hunt** once there's a demo GIF — the visual sells it; launching without
   one leaves conversions on the table.

Capture the demo GIF/screenshot before the PH launch — it's the one missing asset and
the highest-converting one there.
