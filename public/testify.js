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
const api = (path, body = {}) => fetch(`/api/hearings/${hearingId}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ participantId, ...body }) }).then(async (r) => ({ ok: r.ok, status: r.status, body: await r.json().catch(() => ({})) }));

if (!hearingId) showError("網址不完整。");
else load();

async function load() {
  const response = await fetch(`/api/hearings/${hearingId}`, { cache: "no-store" });
  if (response.status === 404) return showError("找不到這個公聽案。");
  if (response.status === 410) return showError("這個公聽案已被刪除。");
  const hearing = await response.json();
  document.title = `${hearing.title} · Pocket Maple`;
  el("title").textContent = hearing.title;
  el("description").textContent = hearing.description;
  el("state").textContent = hearing.status === "open" ? `${hearing.testimonies} 份意見${hearing.deadline ? ` · 截止 ${hearing.deadline}` : ""}` : "已截止";
  el("archive-link").href = `/r/${hearingId}`;
  renderAgenda(hearing.agenda);
  if (!hearing.askOrg) el("org-wrap").classList.add("hidden");
  if (hearing.requireSummary) el("summary").required = true;
  const mine = await api("/me");
  if (mine.body.testimony) {
    const t = mine.body.testimony;
    document.querySelector(`input[name=stance][value=${t.stance}]`).checked = true;
    el("name").value = t.name;
    el("org").value = t.org;
    el("summary").value = t.summary;
    el("text").value = t.text;
    el("submit").textContent = "更新我的意見";
    el("withdraw").classList.remove("hidden");
    el("status").textContent = "你已經留過意見；可以修改後再送出。";
  }
  if (hearing.status !== "open") {
    el("submit").disabled = true;
    el("status").textContent = "這個公聽案已經截止。";
  }
}

function renderAgenda(agenda) {
  const box = el("agenda");
  box.replaceChildren();
  const name = document.createElement("strong");
  name.textContent = agenda.name;
  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = [agenda.proposer, agenda.status, agenda.laws.join("、")].filter(Boolean).join(" · ");
  box.append(name, meta);
  if (agenda.reason) {
    const reason = document.createElement("p");
    reason.textContent = agenda.reason;
    box.append(reason);
  }
  if (agenda.progress.length) {
    const ol = document.createElement("ol");
    for (const step of agenda.progress) {
      const li = document.createElement("li");
      li.textContent = `${step.date} ${step.status}`;
      ol.append(li);
    }
    box.append(ol);
  }
  if (agenda.url) {
    const a = document.createElement("a");
    a.href = agenda.url;
    a.rel = "noopener";
    a.textContent = agenda.kind === "bill" ? "立法院議案資料" : "資料連結";
    box.append(a);
  }
}

el("form").addEventListener("submit", async (event) => {
  event.preventDefault();
  el("submit").disabled = true;
  const stance = (document.querySelector("input[name=stance]:checked") || {}).value;
  const result = await api("/testimonies", { stance, name: el("name").value, org: el("org").value, summary: el("summary").value, text: el("text").value });
  el("submit").disabled = false;
  if (!result.ok) return void (el("status").textContent = result.body.error || `送出失敗（${result.status}）`);
  el("status").textContent = result.body.testimony.revised ? "已更新你的意見。" : "已收到，謝謝。你的意見已進入公開檔案。";
  el("submit").textContent = "更新我的意見";
  el("withdraw").classList.remove("hidden");
});
el("withdraw").addEventListener("click", async () => {
  if (!confirm("撤回後會從公開檔案移除；截止前可以再送。")) return;
  const result = await api("/withdraw");
  el("status").textContent = result.body.ok ? "已撤回。" : "沒有可撤回的意見。";
  el("withdraw").classList.add("hidden");
  el("submit").textContent = "送出";
});
function showError(message) {
  el("error").textContent = message;
  el("error").classList.remove("hidden");
  el("title").textContent = "無法顯示";
  el("form").classList.add("hidden");
}
