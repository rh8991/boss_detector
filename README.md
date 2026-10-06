# boss-status — הבוס במשרד?

> **בקצרה:** דף אינטרנט קטן שמראה בזמן אמת אם הבוס במשרד, ואם כן — פנויה או עסוקה.
> יש שני דפים: **דף הצופים** (`/`) — רק מציג את הסטטוס ומתעדכן לבד,
> ו**דף הבוס** (`/boss`) — נכנסים פעם אחת עם קוד עריכה ומעדכנים בלחיצה.
> הכל רץ על Cloudflare Workers בחינם. (זיהוי אוטומטי מהטלפון — בשלב הבא.)

A tiny real-time "is the boss in?" door plate. Three states — **in & free**, **in & busy**, **out** —
plus an optional short note ("חוזר ב־14:00"). Every open page updates within a couple of seconds.

<img src="docs/screenshot.png" alt="Viewer page: boss in the office and free" width="320">

## How it works

- **Cloudflare Worker** (TypeScript, no framework) serves the static page from `public/` and the
  JSON API under `/api/*`.
- One **Durable Object** (`StatusDO`) stores the current status and pushes changes to every open
  page over **Server-Sent Events**. If SSE is blocked, the page falls back to polling every 30 s.
- Frontend is plain HTML/CSS/JS, RTL Hebrew, light/dark, installable as a PWA.
- Two pages: `/` for viewers (read-only) and `/boss` for the boss (sign in once with the
  editor code, then update). One secret: `EDITOR_TOKEN`, the boss's sign-in code.

```
public/        index.html + viewer.js (viewer), boss.html + boss.js (boss), app.js (shared), styles.css, manifest, icons, images
src/index.ts   routing, auth, rate limit → Durable Object
src/status-do.ts  state, SSE fan-out, rate limit counter
src/validate.ts   pure validation/merge rules
test/          vitest (runs inside workerd via @cloudflare/vitest-pool-workers)
```

## Local development

Requires Node 20+.

```sh
npm i
cp .dev.vars.example .dev.vars     # then put a random string in it
npx wrangler dev                   # http://localhost:8787
npm test                           # vitest
npm run typecheck
```

Open `http://localhost:8787/` (viewer) and `http://localhost:8787/boss` (sign in with the
`EDITOR_TOKEN` from `.dev.vars`) in two windows — changes on the boss page show up on the viewer
page immediately.

## Deploy

```sh
npx wrangler login
npx wrangler secret put EDITOR_TOKEN   # type the boss's code (long and random, e.g. from `openssl rand -hex 16`)
npm run deploy
```

Keep the code somewhere safe (a password manager) — Cloudflare won't show it again.
To change it, run `wrangler secret put EDITOR_TOKEN` again; signed-in devices are signed out on their next update.

The free Workers plan is enough (SQLite-backed Durable Objects are included).

## The two pages

| who | link | what they see |
|---|---|---|
| everyone | `https://boss-status.<your-subdomain>.workers.dev/` | the status card, updates live, read-only |
| the boss | `https://boss-status.<your-subdomain>.workers.dev/boss` | the same card + buttons to update it |

On `/boss` the boss enters the editor code once; the browser remembers it ("התנתקות" forgets it).
Shortcut: `/boss?key=<EDITOR_TOKEN>` signs in directly and removes the code from the address bar.
Without the code, `/boss` only shows the card and the sign-in box — the viewer page has no editing
code at all.

Add to home screen: open the page in Safari/Chrome → Share → *Add to Home Screen*.

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
| GET | `/api/auth/check` | Bearer token | `200` if the editor token is valid, else `401` |

Rules:

- `state` ∈ `in`/`out`, `avail` ∈ `free`/`busy`; anything else → `400`. Unknown fields are ignored.
  `note` is trimmed and capped at 80 characters.
- Setting `state: "in"` without `avail` means "just arrived": `avail` becomes `free` and the note is
  cleared. Setting `state: "out"` keeps the note.
- Write endpoints (and `/api/auth/check`) allow 30 requests per minute per IP, then `429`.
- Tokens are compared in constant time.

Example:

```sh
curl -X POST https://…/api/status \
  -H "Authorization: Bearer $EDITOR_TOKEN" -H "content-type: application/json" \
  -d '{"state":"out","note":"חוזר ב־14:00"}'
```

## Next step

Automatic in/out detection from the boss's phone (geofence) — not built yet.
