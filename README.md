# boss-status — הבוס במשרד?

> **בקצרה:** אתר קטן שמראה בזמן אמת אם הבוס במשרד, ואם כן — פנויה או עסוקה.
> - **דף הצופים:** `https://rh8991.github.io/boss_detector/` — רק מציג, מתעדכן לבד.
> - **דף הבוס:** `https://rh8991.github.io/boss_detector/boss.html` — מעדכנים בלחיצה, בלי קוד.
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
- No sign-in: anyone who opens the boss page can update the status. One secret, `HOOK_TOKEN`,
  protects the iPhone automation endpoint.

```
public/        index.html + viewer.js (viewer), boss.html + boss.js (boss), app.js (shared),
               config.js (API URL), styles.css, manifest, icons, images
src/index.ts   routing, CORS, hook token check, rate limit → Durable Object
src/status-do.ts  state, SSE fan-out, hook debounce, rate limit counter
src/validate.ts   pure validation/merge rules
test/          vitest (runs inside workerd via @cloudflare/vitest-pool-workers)
.github/workflows/deploy.yml  test → Worker (+ its secrets) → GitHub Pages
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

Open `http://localhost:8787/` (viewer) and `http://localhost:8787/boss.html` (boss) in two
windows — changes on the boss page show up on the viewer
page immediately. Locally `config.js` is empty, so the pages call the API on the same origin.

## Deploy (one-time setup, all in the GitHub website)

The **Deploy** workflow does everything on each push to `main`: runs the tests, deploys the
Worker to Cloudflare, sets its secrets, and publishes the pages to GitHub Pages pointed at it.

1. **Cloudflare account** (free): sign up at dash.cloudflare.com. Under *Workers & Pages* open the
   overview once so the account gets its `<subdomain>.workers.dev` address.
2. **Cloudflare API token**: *My Profile → API Tokens → Create Token → template "Edit Cloudflare
   Workers"* → create, copy it. The **Account ID** is on the Workers & Pages overview (right side).
3. **GitHub repo → Settings → Secrets and variables → Actions → New repository secret**, add three:

   | secret | value |
   |---|---|
   | `CLOUDFLARE_API_TOKEN` | the token from step 2 |
   | `CLOUDFLARE_ACCOUNT_ID` | the account ID from step 2 |
   | `HOOK_TOKEN` | a different random string, for the iPhone |

4. **GitHub repo → Settings → Pages → Build and deployment → Source: GitHub Actions**.
   GitHub Pages for a *private* repository needs a paid plan (GitHub Pro); on a free account make the
   repository public (the tokens live in secrets, not in the code).
5. **Actions → Deploy → Run workflow** (or push to `main`). When it finishes the pages are at
   `https://rh8991.github.io/boss_detector/` and the Worker URL is printed in the *worker* job log.

Changing the hook token later: update the GitHub secret and re-run the workflow.

Deploying the Worker by hand instead (`npx wrangler login`,
`npx wrangler secret put HOOK_TOKEN`, `npm run deploy`) also works: then skip the Cloudflare secrets
and set the repository **variable** `BOSS_API_URL` to the Worker URL.

If the GitHub Pages address is not `https://rh8991.github.io`, change `ALLOWED_ORIGINS` in
`wrangler.toml` (comma-separated origins, no path).

Then set up the iPhone with [docs/iphone-shortcuts.md](docs/iphone-shortcuts.md) — on the boss's own
iPhone, with her consent.

## The pages

| who | link | what they see |
|---|---|---|
| everyone | `https://rh8991.github.io/boss_detector/` | the status card, updates live, read-only |
| the boss | `https://rh8991.github.io/boss_detector/boss.html` | the same card + buttons to update it |

There is no sign-in: anyone who opens the boss page can change the status. The viewer page has no
link to it and has no buttons, so share the boss link only with the boss. If that ever becomes a
problem, a sign-in code can be added back.

Add to home screen: open the page in Safari → Share → *Add to Home Screen*.

## API

Status object:

```json
{ "state": "in", "avail": "free", "note": "", "updatedAt": "2026-10-06T08:30:00.000Z", "source": "manual" }
```

| method | path | auth | behavior |
|---|---|---|---|
| GET | `/api/status` | none | current status, `204` if never set |
| GET | `/api/stream` | none | SSE: `event: status` with the current status on connect and on every change; `: ping` every 25 s |
| POST | `/api/status` | none | partial `{state?, avail?, note?}` merged into the current status; returns the new status |
| POST | `/api/hook?token=<HOOK_TOKEN>` | query token | `{"event":"enter"}` → in & free, `{"event":"exit"}` → out; `source: "geofence"` |

Rules:

- `state` ∈ `in`/`out`, `avail` ∈ `free`/`busy`; anything else → `400`. Unknown fields are ignored.
  `note` is trimmed and capped at 80 characters.
- Setting `state: "in"` without `avail` means "just arrived": `avail` becomes `free` and the note is
  cleared. Setting `state: "out"` keeps the note.
- `/api/hook` is ignored (`200 {"ignored": true, "reason": …}`) if the same event was applied less
  than 5 minutes ago, or if the status was updated manually in the last 15 minutes — a manual
  choice always beats GPS flapping.
- Write endpoints allow 30 requests per minute per IP, then `429`.
- The hook token is compared in constant time. CORS is allowed only for `ALLOWED_ORIGINS`.

Example:

```sh
curl -X POST https://…/api/status \
  -H "content-type: application/json" \
  -d '{"state":"out","note":"חוזר ב־14:00"}'
```
