const hearingId = (location.pathname.match(/^\/h\/([a-z0-9]{10})/) || [])[1];
const token = (location.hash.match(/admin=([0-9a-f]{32})/) || [])[1] || "";
const el = (id) => document.getElementById(id);
const headers = { "X-Hearing-Admin": token, "content-type": "application/json" };
let view = null;
if (!hearingId || !token) showError("需要主辦者連結（網址結尾的 #admin=…）。");
else load();

async function load() {
  const response = await fetch(`/api/hearings/${hearingId}/host`, { headers, cache: "no-store" });
  if (response.status === 401 || response.status === 403) return showError("管理權杖不正確。");
  if (response.status === 404) return showError("找不到這個公聽案。");
  view = await response.json();
  el("title").textContent = view.title || "（已刪除）";
  el("state").textContent = view.status === "open" ? "收件中" : view.status === "closed" ? "已截止" : "已刪除";
  el("testify-link").href = `${location.origin}/t/${hearingId}`;
  el("testify-link").textContent = `${location.origin}/t/${hearingId}`;
  el("archive-link").href = `${location.origin}/r/${hearingId}`;
  el("archive-link").textContent = `${location.origin}/r/${hearingId}`;
  el("toggle").textContent = view.status === "open" ? "截止" : "重新開放";
  el("toggle").disabled = view.status === "deleted";
  el("stats").replaceChildren(...[[view.testimonies, "份意見"], [view.counts.support, "支持"], [view.counts.oppose, "反對"], [view.counts.amend, "修正"]].map(([value, label]) => {
    const node = document.createElement("div");
    node.className = "stat";
    const b = document.createElement("b");
    b.textContent = String(value);
    const span = document.createElement("span");
    span.textContent = label;
    node.append(b, span);
    return node;
  }));
  for (const [id, file] of [["dl-testimonies", "testimonies.csv"], ["dl-tttc", "tttc.csv"], ["dl-json", "archive.json"]]) el(id).href = `/api/hearings/${hearingId}/export/${file}?token=${token}`;
  el("moderate").replaceChildren(...(view.list || []).map((t) => {
    const row = document.createElement("div");
    row.className = "toolbar";
    const label = document.createElement("span");
    label.textContent = `#${t.id} [${t.stance}] ${t.name}${t.org ? `（${t.org}）` : ""}：${(t.summary || t.text).slice(0, 60)}`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "button ghost";
    remove.textContent = "下架";
    remove.addEventListener("click", async () => {
      if (!confirm(`下架 #${t.id}？`)) return;
      await fetch(`/api/hearings/${hearingId}/testimonies/${t.id}/remove`, { method: "POST", headers, body: "{}" });
      load();
    });
    row.append(label, remove);
    return row;
  }));
}
el("refresh").addEventListener("click", load);
el("toggle").addEventListener("click", async () => {
  const status = view.status === "open" ? "closed" : "open";
  const response = await fetch(`/api/hearings/${hearingId}/status`, { method: "POST", headers, body: JSON.stringify({ status }) });
  el("admin-status").textContent = response.ok ? "已更新。" : `失敗（${response.status}）`;
  load();
});
el("delete").addEventListener("click", async () => {
  if (!confirm("確定刪除整個公聽案與所有意見？無法復原。")) return;
  const response = await fetch(`/api/hearings/${hearingId}`, { method: "DELETE", headers });
  el("admin-status").textContent = response.ok ? "已刪除。" : `刪除失敗（${response.status}）`;
  load();
});
function showError(message) {
  el("error").textContent = message;
  el("error").classList.remove("hidden");
  el("title").textContent = "無法顯示";
}
