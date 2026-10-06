# boss-status — הבוס במשרד?

> **בקצרה:** דף אינטרנט קטן שמראה בזמן אמת אם הבוס במשרד, ואם כן — פנויה או עסוקה.
> כל מי שיש לו את הקישור רואה את הסטטוס; רק מי שיש לו את קישור העריכה יכול לשנות אותו.
> אפשר גם לעדכן אוטומטית מהטלפון כשנכנסים/יוצאים מהמשרד (גיאופנס).
> הכל רץ על Cloudflare Workers בחינם.

A tiny real-time "is the boss in?" door plate. Three states — **in & free**, **in & busy**, **out** —
plus an optional short note ("חוזר ב־14:00"). Every open page updates within a couple of seconds.

<img src="docs/screenshot.png" alt="Viewer page: boss in the office and free" width="320">

## How it works

- **Cloudflare Worker** (TypeScript, no framework) serves the static page from `public/` and the
  JSON API under `/api/*`.
- One **Durable Object** (`StatusDO`) stores the current status and pushes changes to every open
  page over **Server-Sent Events**. If SSE is blocked, the page falls back to polling every 30 s.
- Frontend is plain HTML/CSS/JS, RTL Hebrew, light/dark, installable as a PWA.
- Two secrets: `EDITOR_TOKEN` (people who may change the status) and `HOOK_TOKEN`
  (the phone's geofence automation).

```
public/        index.html, app.js, styles.css, manifest, icons, images
src/index.ts   routing, auth, rate limit → Durable Object
src/status-do.ts  state, SSE fan-out, hook debounce, rate limit counter
src/validate.ts   pure validation/merge rules
test/          vitest (runs inside workerd via @cloudflare/vitest-pool-workers)
docs/geofence-shortcuts.md  iOS / Android automation setup
```

## Local development

Requires Node 20+.

```sh
npm i
cp .dev.vars.example .dev.vars     # then put two random strings in it
npx wrangler dev                   # http://localhost:8787
npm test                           # vitest
npm run typecheck
```

Open `http://localhost:8787/` (viewer) and `http://localhost:8787/?key=<EDITOR_TOKEN from .dev.vars>`
(editor) in two windows — changes in one show up in the other immediately.

## Deploy

```sh
npx wrangler login
openssl rand -hex 24 | npx wrangler secret put EDITOR_TOKEN
openssl rand -hex 24 | npx wrangler secret put HOOK_TOKEN
npm run deploy
```

Keep a copy of both tokens somewhere safe (a password manager) — Cloudflare won't show them again.
To rotate a token, run `wrangler secret put` again; old links stop working immediately.

The free Workers plan is enough (SQLite-backed Durable Objects are included).

## Sharing the links

| who | link | what they see |
|---|---|---|
| everyone | `https://boss-status.<your-subdomain>.workers.dev/` | the status card, read-only |
| the boss / editors | `https://boss-status.<your-subdomain>.workers.dev/?key=<EDITOR_TOKEN>` | card + controls |

Opening the editor link **once** stores the token in that browser and removes it from the address
bar. From then on the plain link shows the controls on that device. "יציאה ממצב עריכה" at the bottom
forgets the token.

Add to home screen: open the page in Safari/Chrome → Share → *Add to Home Screen*.
On iOS the home-screen app has its own storage separate from Safari, so if the controls don't appear
there, just bookmark/use the editor link in the browser instead.

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
  than 5 minutes ago, or if someone updated the status manually in the last 15 minutes — a manual
  choice always beats GPS flapping.
- Write endpoints (and `/api/auth/check`) allow 30 requests per minute per IP, then `429`.
- Tokens are compared in constant time.

Example:

```sh
curl -X POST https://…/api/status \
  -H "Authorization: Bearer $EDITOR_TOKEN" -H "content-type: application/json" \
  -d '{"state":"out","note":"חוזר ב־14:00"}'
```

## Automatic updates from the phone

See [docs/geofence-shortcuts.md](docs/geofence-shortcuts.md) for iOS Shortcuts and Android
(Tasker / MacroDroid) setup. Set this up only on the boss's own phone, with her consent.
