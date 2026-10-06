// Boss page (/boss): sign in once with the editor code, then update the status.
import { $, connect, getStatus, onRender, setStatus } from "./app.js";

const TOKEN_KEY = "bossStatus.editorToken";
let token = null;
let busy = false;

function readToken() { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } }
function storeToken(t) { try { localStorage.setItem(TOKEN_KEY, t); } catch {} }
function clearToken() { try { localStorage.removeItem(TOKEN_KEY); } catch {} }

function showSignedIn(on) {
  $("login").hidden = on;
  $("controls").hidden = !on;
  $("logout").hidden = !on;
  $("hint").hidden = !on;
}

async function check(t) {
  const res = await fetch("/api/auth/check", { headers: { authorization: `Bearer ${t}` }, cache: "no-store" });
  return res.status;
}

// Keep the buttons in sync with whatever status is shown (including live updates).
onRender((c) => {
  document.querySelectorAll("button[data-s]").forEach((b) =>
    b.setAttribute("aria-pressed", String(!!c && b.dataset.s === c.state)));
  document.querySelectorAll("button[data-a]").forEach((b) =>
    b.setAttribute("aria-pressed", String(!!c && c.state === "in" && b.dataset.a === c.avail)));
  $("availRow").hidden = !(c && c.state === "in");
  if (c && document.activeElement !== $("noteInput")) $("noteInput").value = c.note || "";
});

function setButtonsDisabled(d) {
  document.querySelectorAll(".controls button").forEach((b) => { b.disabled = d; });
}

async function write(patch) {
  if (!token || busy) return;
  busy = true;
  $("err").textContent = "";
  setButtonsDisabled(true);
  const before = getStatus();
  // Optimistic: mirror the server's merge rules locally, roll back on failure.
  const base = before || { state: "out", avail: "free", note: "" };
  const arriving = patch.state === "in" && patch.avail === undefined;
  setStatus({
    ...base,
    state: patch.state ?? base.state,
    avail: arriving ? "free" : (patch.avail ?? base.avail),
    note: patch.note ?? (arriving ? "" : base.note),
    updatedAt: new Date().toISOString(),
    source: "manual",
  });
  try {
    const res = await fetch("/api/status", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(patch),
    });
    if (res.status === 401) {
      token = null;
      clearToken();
      showSignedIn(false);
      throw new Error("unauthorized");
    }
    if (!res.ok) throw new Error(String(res.status));
    setStatus(await res.json());
  } catch (e) {
    setStatus(before);
    $("err").textContent = e && e.message === "unauthorized"
      ? "אין הרשאה לעדכן."
      : "העדכון לא נשמר. בדוק חיבור ונסה שוב.";
  } finally {
    busy = false;
    setButtonsDisabled(false);
  }
}

document.querySelectorAll("button[data-s]").forEach((b) =>
  b.addEventListener("click", () => {
    write(b.dataset.s === "in"
      ? { state: "in", avail: "free", note: "" }
      : { state: "out", note: $("noteInput").value.trim() });
  }));
document.querySelectorAll("button[data-a]").forEach((b) =>
  b.addEventListener("click", () => write({ state: "in", avail: b.dataset.a })));
$("saveNote").addEventListener("click", () => write({ note: $("noteInput").value.trim() }));
$("noteInput").addEventListener("keydown", (e) => { if (e.key === "Enter") $("saveNote").click(); });

$("login").addEventListener("submit", async (e) => {
  e.preventDefault();
  const t = $("codeInput").value.trim();
  if (!t) return;
  $("loginErr").textContent = "";
  try {
    const status = await check(t);
    if (status === 200) {
      token = t;
      storeToken(t);
      $("codeInput").value = "";
      showSignedIn(true);
    } else {
      $("loginErr").textContent = status === 429 ? "יותר מדי ניסיונות. נסה שוב בעוד דקה." : "קוד שגוי.";
    }
  } catch {
    $("loginErr").textContent = "אין חיבור. נסה שוב.";
  }
});

$("logout").addEventListener("click", (e) => {
  e.preventDefault();
  token = null;
  clearToken();
  showSignedIn(false);
});

(async function boot() {
  connect();
  // Optional shortcut: /boss?key=<code> signs in and strips the code from the address bar.
  const url = new URL(location.href);
  const key = url.searchParams.get("key");
  if (key) {
    url.searchParams.delete("key");
    history.replaceState(null, "", url.pathname + url.search + url.hash);
  }
  const t = key || readToken();
  if (!t) { showSignedIn(false); return; }
  try {
    const status = await check(t);
    if (status === 200) { token = t; storeToken(t); showSignedIn(true); return; }
    if (status === 401) clearToken();
  } catch {}
  showSignedIn(false);
})();
