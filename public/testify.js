import { renderAgenda } from "/agenda.js";

const hearingId = (location.pathname.match(/^\/t\/([a-z0-9]{10})/) || [])[1];
const el = (id) => document.getElementById(id);
const KEY = `pocket-maple:participant:${hearingId}`;
let participantId = "";
try {
  participantId = localStorage.getItem(KEY) || "";
  if (!participantId) {
    participantId = crypto.randomUUID();
    localStorage.setItem(KEY, participantId);
  }
} catch {
  participantId = crypto.randomUUID();
}
let hearing = null;
const api = (path, body = {}) => fetch(`/api/hearings/${hearingId}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ participantId, ...body }) }).then(async (r) => ({ ok: r.ok, status: r.status, body: await r.json().catch(() => ({})) }));

if (!hearingId) showError("網址不完整。");
else load();

async function load() {
  const response = await fetch(`/api/hearings/${hearingId}`, { cache: "no-store" });
  if (response.status === 404) return showError("找不到這個公聽案。");
  if (response.status === 410) return showError("這個公聽案已被刪除。");
  hearing = await response.json();
  document.title = `${hearing.title} · 留下意見`;
  el("title").textContent = hearing.title;
  el("description").textContent = hearing.description;
  const open = hearing.status === "open";
  el("state").textContent = open ? `${hearing.testimonies} 份意見${hearing.deadline ? ` · 截止 ${hearing.deadline}` : ""}` : "已截止";
  el("archive-link").href = `/r/${hearingId}`;
  el("agenda").replaceChildren(renderAgenda(hearing.agenda, { withName: hearing.agenda.name !== hearing.title }));
  if (!hearing.askOrg) el("org-wrap").classList.add("hidden");
  if (hearing.requireSummary) el("summary-label").classList.add("req");
  const mine = await api("/me");
  if (mine.body.testimony) fillMine(mine.body.testimony);
  if (!open) {
    el("submit").disabled = true;
    el("status").textContent = "這個公聽案已經截止，不能再送或修改。";
  }
}

function fillMine(t) {
  const radio = document.querySelector(`input[name=stance][value=${t.stance}]`);
  if (radio) radio.checked = true;
  el("name").value = t.name;
  el("org").value = t.org;
  el("summary").value = t.summary;
  el("text").value = t.text;
  updateCounters();
  showDone(t, false);
}

function showDone(t, fresh) {
  el("done").classList.remove("hidden");
  el("done-title").textContent = fresh ? (t.revised ? "已更新你的意見" : "已收到你的意見") : "你已經留過意見";
  el("done-text").textContent = `#${t.id} · ${t.stance === "support" ? "支持" : t.stance === "oppose" ? "反對" : "修正"} · ${t.name}${t.org ? `（${t.org}）` : ""}。截止前可以修改或撤回。`;
  el("done-link").href = `/r/${hearingId}#testimony-${t.id}`;
  el("form").classList.add("hidden");
  el("withdraw").classList.remove("hidden");
  el("submit").textContent = "更新我的意見";
  if (fresh) el("done").scrollIntoView({ behavior: "smooth", block: "center" });
}
el("edit-again").addEventListener("click", () => {
  el("done").classList.add("hidden");
  el("form").classList.remove("hidden");
  el("form").scrollIntoView({ behavior: "smooth", block: "start" });
});

function updateCounters() {
  el("summary-count").textContent = String(el("summary").value.length);
  el("text-count").textContent = el("text").value.length.toLocaleString("zh-Hant-TW");
}
el("summary").addEventListener("input", updateCounters);
el("text").addEventListener("input", updateCounters);

el("form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const stance = (document.querySelector("input[name=stance]:checked") || {}).value;
  if (!stance) return void (el("status").textContent = "先選一個立場。");
  if (!el("name").value.trim()) {
    el("status").textContent = "請留名字或化名。";
    el("name").focus();
    return;
  }
  if (el("text").value.trim().length < 20) {
    el("status").textContent = "書面意見至少 20 字。";
    el("text").focus();
    return;
  }
  el("submit").disabled = true;
  el("status").textContent = "送出中…";
  const result = await api("/testimonies", { stance, name: el("name").value, org: el("org").value, summary: el("summary").value, text: el("text").value });
  el("submit").disabled = false;
  if (!result.ok) return void (el("status").textContent = result.body.error || `送出失敗（${result.status}）`);
  el("status").textContent = "";
  showDone(result.body.testimony, true);
});
el("withdraw").addEventListener("click", async () => {
  if (!confirm("撤回後會從公開檔案移除；截止前可以再送。")) return;
  const result = await api("/withdraw");
  el("done").classList.add("hidden");
  el("form").classList.remove("hidden");
  el("withdraw").classList.add("hidden");
  el("submit").textContent = "送出意見";
  el("status").textContent = result.body.ok ? "已撤回。" : "沒有可撤回的意見。";
});
function showError(message) {
  el("error").textContent = message;
  el("error").classList.remove("hidden");
  el("title").textContent = "無法顯示";
  el("form").classList.add("hidden");
}
