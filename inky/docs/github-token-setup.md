---
created: 2026-05-30
status: active
author: Claude main session
session: inky-spec-planning
branch: main
informed_by: User request for secure, least-privilege token setup (also for OSS users); GitHub fine-grained PAT docs
notes: How to create a secure, least-privilege GitHub token for Inky (fine-grained PAT preferred), where to store it, and the security model. Linked from the README.
---

# GitHub token setup

Inky reads your organization's GitHub activity (commits, pull requests,
reviews, issues) through the GitHub API. To do that it needs a **read-only**
token. This guide creates one with the *least privilege* needed.

> **You hold the token.** Inky is code *you* run — self-hosted, not a service run
> by someone else. The token lives in your `.env` (gitignored) when running
> locally, or in your host's encrypted secrets when you deploy the worker (e.g.
> Render → Environment). Either way it is sent only to `github.com` — never to the
> Inky authors, Anthropic, or any third party. The only thing that leaves is the
> finished standup text, and only to the Discord webhook you configure.

## Recommended: a fine-grained personal access token (read-only)

Fine-grained tokens can be scoped to a single org, specific repositories, and
read-only permissions — far safer than a classic token.

1. Go to **GitHub → Settings → Developer settings → Personal access tokens →
   Fine-grained tokens → Generate new token**.
2. **Token name:** `inky-<org>` (e.g. `inky-acme`).
3. **Expiration:** set one (e.g. 90 days). Rotate when it lapses.
4. **Resource owner:** select your **organization** (not your personal account).
   - If the org requires approval for fine-grained tokens, an org owner must
     approve it under Org Settings → Personal access tokens.
5. **Repository access:** **All repositories** if you want the whole org (this is
   required when `repos: []` in your config, so Inky can list + read every repo) —
   or **Only select repositories** to limit the standup to specific repos (match
   them to `repos: [...]` in your config).
6. **Repository permissions** — set these to **Read-only**, leave everything else
   *No access*:

   | Permission | Access | Why Inky needs it |
   |---|---|---|
   | **Contents** | Read | List commits and per-file line counts across branches |
   | **Metadata** | Read | Required baseline (repo list, branches) — auto-selected |
   | **Pull requests** | Read | PRs opened/merged and review activity |
   | **Issues** | Read | Issues opened/closed in the window |

7. **Generate token** and copy it (you won't see it again).

That token can *only read* the repos you selected. It cannot push code, change
settings, delete anything, or touch other organizations.

## Alternative: a classic personal access token

If fine-grained tokens aren't available to you, a classic token works but is
coarser (it grants broad access to everything your account can reach):

1. **Settings → Developer settings → Personal access tokens → Tokens (classic) →
   Generate new token (classic)**.
2. Scope: **`repo`** (full control of private repos — broader than ideal) and
   **`read:org`** (to list org repos).
3. Set an expiration and generate.

Prefer the fine-grained token whenever possible.

## Where to put it

Store the token in `.env` (which is gitignored — never commit it):

```bash
cp .env.example .env
# then edit .env:
GITHUB_TOKEN=github_pat_xxxxxxxxxxxxxxxxxxxx
```

Inky reads `GITHUB_TOKEN` (or `GH_TOKEN`) from the environment.

**Deploying the worker?** Don't commit the token — put it in your host's
environment/secrets instead (e.g. **Render → your service → Environment →
`GITHUB_TOKEN`**). Same token, same least-privilege; it just lives in the host's
encrypted env rather than a local `.env`. See [`deployment.md`](deployment.md).

## Security model (summary)

- **Least privilege** — read-only, only the repos you need, only the 4 scopes above.
- **Local only** — token stays in `.env`; sent only to github.com.
- **Never committed** — `.env` and `inky.config.json` are gitignored.
- **Expiring + rotated** — set an expiration; regenerate periodically.
- **Revocable** — delete the token in GitHub settings at any time to cut off access.

## Prefer not to manage a token? Use a GitHub App

A PAT is the simplest way to start, but you can instead authenticate as a
**GitHub App installation** — no expiry to rotate, higher rate limits, and a clean
revoke (uninstall). Same read-only access; it's just a sturdier way to hold it, and
it's the same auth the future hosted tier uses. See
[`github-app-setup.md`](github-app-setup.md). You only need one of the two — if both
are configured, the App wins.
