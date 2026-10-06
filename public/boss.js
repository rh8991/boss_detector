// Boss page (boss.html): buttons to update the status. No sign-in.
import { $, api, connect, getStatus, onRender, setStatus } from "./app.js";

let busy = false;

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
  if (busy) return;
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
    const res = await fetch(api("/api/status"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error(String(res.status));
    setStatus(await res.json());
  } catch (e) {
    setStatus(before);
    $("err").textContent = e && e.message === "429"
      ? "יותר מדי עדכונים. נסה שוב בעוד דקה."
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

connect();
