# Automatic in/out from the phone (geofence)

The phone sends one small HTTP request when it arrives at or leaves the office:

```
POST https://boss-status.<your-subdomain>.workers.dev/api/hook?token=<HOOK_TOKEN>
Content-Type: application/json

{"event":"enter"}      ← arrived  → "במשרד · פנוי"
{"event":"exit"}       ← left     → "לא במשרד"
```

The page then shows "(אוטומטי)" next to the update time.

Built-in safety rules:

- The same event repeated within 5 minutes is ignored (GPS jitter at the door).
- If the status was changed by hand in the last 15 minutes, the hook is ignored — a manual choice
  always wins.

> **Consent:** this tracks a person's location. Set it up only on the boss's own phone, by her or
> with her explicit agreement, and tell her how to turn it off (disable the automation or rotate
> `HOOK_TOKEN`). Use `HOOK_TOKEN`, never `EDITOR_TOKEN`, so the phone can only send enter/exit.

Test the URL first from a computer:

```sh
curl -X POST "https://…/api/hook?token=$HOOK_TOKEN" -H "content-type: application/json" -d '{"event":"enter"}'
```

---

## iOS — Shortcuts app

Create **two** personal automations, one for arriving and one for leaving.

1. Open **Shortcuts** → **Automation** tab → **+** (New Automation).
2. Choose **Arrive**.
   - **Location** → search for the office address → set a reasonable radius (≈100–150 m).
   - Time: **Any Time**.
   - Select **Run Immediately** (not "Run After Confirmation"). Turn off **Notify When Run** if you
     don't want a banner. Tap **Next**.
3. **New Blank Automation** → **Add Action** → search **Get Contents of URL**.
   - URL: `https://boss-status.<your-subdomain>.workers.dev/api/hook?token=<HOOK_TOKEN>`
   - Tap the **›** arrow to expand:
     - **Method:** `POST`
     - **Headers:** add `Content-Type` = `application/json`
     - **Request Body:** `JSON` → add a field: key `event`, type **Text**, value `enter`
4. Tap **Done**.
5. Repeat steps 1–4 with **Leave** instead of **Arrive** and `exit` as the value.

Notes:

- Location Services must be on for Shortcuts (Settings → Privacy & Security → Location Services →
  Shortcuts → *While Using* is enough for automations on recent iOS; *Precise Location* helps).
- Arrive/Leave can fire a few minutes late; that's iOS, not the server.

## Android — Tasker

1. **Profiles** tab → **+** → **Location** → pick the office on the map, radius ≈100–150 m → back.
2. **New Task** → name it `Office enter` → **+** → **Net → HTTP Request**:
   - **Method:** `POST`
   - **URL:** `https://boss-status.<your-subdomain>.workers.dev/api/hook?token=<HOOK_TOKEN>`
   - **Headers:** `Content-Type:application/json`
   - **Body:** `{"event":"enter"}`
3. Back on the profile, long-press the task → **Add Exit Task** → new task `Office exit` with the same
   HTTP Request but body `{"event":"exit"}`.
4. Make sure Tasker is exempt from battery optimisation (Android Settings → Apps → Tasker →
   Battery → Unrestricted), otherwise location profiles may not fire.

## Android — MacroDroid (simpler alternative)

1. **Add Macro** → Trigger **Location → Geofence Trigger** → create a geofence around the office →
   **Area entered**.
2. Action **Connectivity → HTTP Request**:
   - Method `POST`, URL as above, content type `application/json`, body `{"event":"enter"}`.
3. Save. Create a second macro with **Area exited** and body `{"event":"exit"}`.

---

## Turning it off

- Disable/delete the automation on the phone, **or**
- Rotate the hook token: `openssl rand -hex 24 | npx wrangler secret put HOOK_TOKEN` — all existing
  automations stop working until updated.
