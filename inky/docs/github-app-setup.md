---
created: 2026-06-04
status: active
author: Claude main session
session: 00f2d3f5-05eb-4c65-a9d4-0147669a31d9
branch: main
informed_by: GitHub App auth build (roadmap-and-phase-6.md Track C "GitHub App" stepping stone, scoped to self-host); the existing least-privilege PAT setup in github-token-setup.md (same read-only permission set); src/github-auth.ts (selectGitHubAuth + resolveOctokit)
notes: How to authenticate Inky as a GitHub App installation instead of a personal access token, for self-hosting. Optional upgrade over the PAT — no expiry, higher rate limits, fine-grained per-org install, clean revoke. The same auth layer is what the future hosted multi-tenant tier reuses.
---

# GitHub App setup (self-host)

By default Inky authenticates with a [personal access token](github-token-setup.md).
You can instead authenticate as a **GitHub App installation** — an optional upgrade
that's worth it if you run Inky long-term:

- **No 90-day expiry** to rotate — the App mints short-lived installation tokens and
  refreshes them automatically.
- **Higher rate limits** than a PAT (helps for large orgs / all-repo scans).
- **Fine-grained, per-org install** with read-only permissions.
- **Clean revoke** — uninstall the App to cut off access in one click.

It's the same least-privilege, read-only access as the PAT — just a sturdier way to
hold it. (This is also the exact auth layer the future hosted tier uses, so setting it
up now future-proofs your install.)

> **PAT vs App:** you only need one. If you've already got the [PAT setup](github-token-setup.md)
> working, you can stay on it. If both are configured, **the App wins**.

## 1. Create the App

1. Go to **GitHub → Settings → Developer settings → GitHub Apps → New GitHub App**.
   (For an org-owned App: **Org Settings → Developer settings → GitHub Apps → New**.)
2. **GitHub App name:** `inky-<org>` (e.g. `inky-acme`) — must be globally unique.
3. **Homepage URL:** anything (e.g. your repo URL). Required but unused.
4. **Webhook:** **uncheck "Active."** Inky polls the API on a schedule; it doesn't
   need to receive webhooks. (Leaving it off means no webhook URL or secret to manage.)
5. **Repository permissions** — set exactly these to **Read-only**, leave everything
   else *No access* (same set as the PAT):

   | Permission | Access | Why |
   |---|---|---|
   | **Contents** | Read | Commits and per-file line counts across branches |
   | **Metadata** | Read | Baseline (repo list, branches) — auto-selected |
   | **Pull requests** | Read | PRs opened/merged + review activity |
   | **Issues** | Read | Issues opened/closed, and milestones (for status-vs-plan) |

6. **Where can this App be installed?** *Only on this account* is fine for self-host.
7. **Create GitHub App.**

## 2. Note the App ID and generate a private key

- On the App's settings page, copy the **App ID** (a number).
- Scroll to **Private keys → Generate a private key.** A `.pem` file downloads — this
  is a **secret**. Store it like any other credential (never commit it).

## 3. Install the App on your org

- On the App's page, **Install App** → choose your org.
- **Repository access:** **All repositories** (needed when your config uses `repos: []`
  to scan the whole org) or **Only select repositories** to limit it.

## 4. Point Inky at the App

**App ID** is not secret — put it in `inky.config.json` (or set `GITHUB_APP_ID`):

```jsonc
{
  "org": "your-org",
  "github": {
    "appId": "123456"
    // "installationId": 7654321  // optional — auto-discovered + logged on first run
  }
}
```

**The private key is a secret** — provide it via the environment, never config. Two ways:

```bash
# (a) a file path — simplest; works great with a Render Secret File or a mounted key
GITHUB_APP_PRIVATE_KEY_PATH=/path/to/inky-app.private-key.pem

# (b) inline — paste the PEM; a single-line value with literal \n is also accepted
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----
...
-----END RSA PRIVATE KEY-----"
```

That's it. Run any command (`inky standup --dry-run`, `inky serve`) and Inky
authenticates as the App. On the first run it discovers your org's **installation id**
and logs it — pin that as `github.installationId` to skip the (one) lookup call.

## Deploying the worker

On Render (or similar), add the `.pem` as a **Secret File** and point the path env var
at it — mirroring how `inky.config.json` is already mounted:

- **Render → your service → Environment → Secret Files:** add
  `inky-app.private-key.pem` (paste the key's contents).
- **Environment variables:** `GITHUB_APP_PRIVATE_KEY_PATH=/etc/secrets/inky-app.private-key.pem`
  and (if not in config) `GITHUB_APP_ID=123456`.

See [`deployment.md`](deployment.md) for the rest of the deploy.

## How Inky chooses (precedence)

`src/github-auth.ts` resolves auth purely from config + env:

1. **App** — when an **app id** is set (`github.appId`, else `GITHUB_APP_ID`). The app id
   is the signal of intent, so the App wins even when a PAT is also set — and if the
   private key is then missing or not a valid PEM, Inky **errors clearly** (it won't
   silently fall back to a PAT, which may carry broader scopes).
2. **PAT** — when no app id is set: `GITHUB_TOKEN` (or `GH_TOKEN`).
3. Neither → a clear error pointing back here.

## Security model (summary)

- **Least privilege** — read-only, only the four scopes above, only the repos you grant.
- **Short-lived tokens** — installation tokens last ~1 hour and auto-refresh; the
  long-lived private key stays on your host, sent only to github.com.
- **Never committed** — the `.pem`, `.env`, and `inky.config.json` are gitignored / host
  secrets.
- **Revocable** — uninstall the App (or delete the key) to cut off access instantly.
