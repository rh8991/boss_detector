# boss-status — הבוס במשרד?

> **בקצרה:** אתר קטן שמראה בזמן אמת אם הבוס במשרד, ואם כן — פנויה או עסוקה.
> - **דף הצופים:** `https://rh8991.github.io/boss_detector/` — רק מציג, מתעדכן לבד.
> - **דף הבוס:** `https://rh8991.github.io/boss_detector/boss.html` — נכנסים פעם אחת עם קוד ומעדכנים בלחיצה.
> - **אוטומטי מהאייפון:** כשהבוס מגיעה/יוצאת מהמשרד הסטטוס מתעדכן לבד — ראו [docs/iphone-shortcuts.md](docs/iphone-shortcuts.md).
>
> הדפים יושבים ב-GitHub Pages; השרת (שמירת הסטטוס ועדכון חי) רץ על Cloudflare Workers בחינם.

A tiny real-time "is the boss in?" door plate. Three states — **in & free**, **in & busy**, **out** —
plus an optional short note ("חוזר ב־14:00"). Every open page updates within a couple of seconds.

<img src="docs/screenshot.png" alt="Viewer page: boss in the office and free" width="320">

## How it works

```
 viewers ─┐                                    ┌─ Durable Object "StatusDO"
 boss ────┼─ GitHub Pages (public/) ── /api ──▶│   current status + SSE fan-out
          │   rh8991.github.io/boss_detector    └─ Cloudflare Worker (src/)
 iPhone ──┴──────── POST /api/hook ───────────▶    boss-status.<subdomain>.workers.dev
```

- **GitHub Pages** hosts the static pages from `public/` (plain HTML/CSS/JS, RTL Hebrew,
  light/dark, installable as a PWA). The deploy workflow writes the Worker URL into `config.js`.
- **Cloudflare Worker** (TypeScript, no framework) serves the JSON API under `/api/*`, with CORS
  for the origins in `ALLOWED_ORIGINS` (`wrangler.toml`). It also serves the same pages itself, so
  the `workers.dev` URL works as a fallback.
- One **Durable Object** stores the status and pushes changes to every open page over
  **Server-Sent Events**; pages fall back to polling every 30 s if SSE is blocked.
- Two secrets: `EDITOR_TOKEN` (the boss's sign-in code) and `HOOK_TOKEN` (the iPhone automation).

```
public/        index.html + viewer.js (viewer), boss.html + boss.js (boss), app.js (shared),
               config.js (API URL), styles.css, manifest, icons, images
src/index.ts   routing, CORS, auth, rate limit → Durable Object
src/status-do.ts  state, SSE fan-out, hook debounce, rate limit counter
src/validate.ts   pure validation/merge rules
test/          vitest (runs inside workerd via @cloudflare/vitest-pool-workers)
.github/workflows/deploy.yml  test → GitHub Pages (+ Worker if a Cloudflare token is set)
docs/iphone-shortcuts.md      iPhone automation setup (Hebrew)
```

## Local development

Requires Node 20+.

```sh
npm i
cp .dev.vars.example .dev.vars     # then put random strings in it
npx wrangler dev                   # http://localhost:8787
npm test                           # vitest
npm run typecheck
```

Open `http://localhost:8787/` (viewer) and `http://localhost:8787/boss.html` (sign in with the
`EDITOR_TOKEN` from `.dev.vars`) in two windows — changes on the boss page show up on the viewer
page immediately. Locally `config.js` is empty, so the pages call the API on the same origin.

## Deploy (one-time setup)

### 1. The Worker (API)

```sh
npx wrangler login
npx wrangler secret put EDITOR_TOKEN   # the boss's sign-in code (long and random, e.g. `openssl rand -hex 16`)
npx wrangler secret put HOOK_TOKEN     # a different random string, for the iPhone
npm run deploy                         # prints https://boss-status.<subdomain>.workers.dev
```

Keep both codes somewhere safe (a password manager) — Cloudflare won't show them again.
The free Workers plan is enough (SQLite-backed Durable Objects are included).

If the GitHub Pages address is not `https://rh8991.github.io`, change `ALLOWED_ORIGINS` in
`wrangler.toml` (comma-separated origins, no path) and deploy again.

### 2. GitHub Pages (the pages)

1. Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Repo **Settings → Secrets and variables → Actions → Variables → New repository variable**:
   `BOSS_API_URL` = the Worker URL from step 1 (e.g. `https://boss-status.<subdomain>.workers.dev`).
3. Merge to `main` (or run the **Deploy** workflow manually). The workflow runs the tests and
   publishes `public/` to `https://rh8991.github.io/boss_detector/`.

Optional — let the same workflow deploy the Worker on every push to `main`: add repository
**secrets** `CLOUDFLARE_API_TOKEN` (template "Edit Cloudflare Workers") and `CLOUDFLARE_ACCOUNT_ID`.
Without them the Worker job just skips. Secrets set with `wrangler secret put` persist across deploys.

### 3. The iPhone

Follow [docs/iphone-shortcuts.md](docs/iphone-shortcuts.md) on the boss's own iPhone, with her consent.

## The pages

| who | link | what they see |
|---|---|---|
| everyone | `https://rh8991.github.io/boss_detector/` | the status card, updates live, read-only |
| the boss | `https://rh8991.github.io/boss_detector/boss.html` | the same card + buttons to update it |

On the boss page she enters the editor code once; the browser remembers it ("התנתקות" forgets it).
Shortcut: `boss.html?key=<EDITOR_TOKEN>` signs in directly and removes the code from the address bar.
The viewer page has no editing code at all.

Note: every project site under `rh8991.github.io` shares one browser origin, so other GitHub Pages
sites of this account could read the remembered code. Fine for a personal account; use a custom
domain if that matters.

Add to home screen: open the page in Safari → Share → *Add to Home Screen*. On iPhone the
home-screen app keeps its own storage, so sign in once more inside it.

## API

Status object:

```json
{ "state": "in", "avail": "free", "note": "", "updatedAt": "2026-10-06T08:30:00.000Z", "source": "manual" }
```

| method | path | auth | behavior |
|---|---|---|---|
| GET | `/api/status` | none | current status, `204` if never set |
| GET | `/api/stream` | none | SSE: `event: status` with the current status on connect and on every change; `: ping` every 25 s |
| POST | `/api/status` | `Authorization: Bearer <EDITOR_TOKEN>` | partial `{state?, avail?, note?}` merged into the current status; returns the new status |
| POST | `/api/hook?token=<HOOK_TOKEN>` | query token | `{"event":"enter"}` → in & free, `{"event":"exit"}` → out; `source: "geofence"` |
| GET | `/api/auth/check` | Bearer token | `200` if the editor token is valid, else `401` |

Rules:

- `state` ∈ `in`/`out`, `avail` ∈ `free`/`busy`; anything else → `400`. Unknown fields are ignored.
  `note` is trimmed and capped at 80 characters.
- Setting `state: "in"` without `avail` means "just arrived": `avail` becomes `free` and the note is
  cleared. Setting `state: "out"` keeps the note.
- `/api/hook` is ignored (`200 {"ignored": true, "reason": …}`) if the same event was applied less
  than 5 minutes ago, or if the status was updated manually in the last 15 minutes — a manual
  choice always beats GPS flapping.
- Write endpoints (and `/api/auth/check`) allow 30 requests per minute per IP, then `429`.
- Tokens are compared in constant time. CORS is allowed only for `ALLOWED_ORIGINS`.

Example:

```sh
curl -X POST https://…/api/status \
  -H "Authorization: Bearer $EDITOR_TOKEN" -H "content-type: application/json" \
  -d '{"state":"out","note":"חוזר ב־14:00"}'
```
