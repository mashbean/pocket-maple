import { renderAgenda } from "/agenda.js";

const hearingId = (location.pathname.match(/^\/r\/([a-z0-9]{10})/) || [])[1];
const el = (id) => document.getElementById(id);
const LABEL = { support: "支持", oppose: "反對", amend: "修正" };
const CLAMP = 600;
let all = [];
let stance = "";
let order = "new";
if (!hearingId) showError("網址不完整。");
else load();

async function load() {
  const response = await fetch(`/api/hearings/${hearingId}/testimonies`, { cache: "no-store" });
  if (response.status === 404) return showError("找不到這個公聽案。");
  if (response.status === 410) return showError("這個公聽案已被刪除。");
  const { hearing, testimonies } = await response.json();
  all = testimonies;
  document.title = `${hearing.title} · 公開檔案`;
  el("title").textContent = hearing.title;
  el("description").textContent = hearing.description;
  const open = hearing.status === "open";
  el("state").textContent = open ? `收件中${hearing.deadline ? ` · 截止 ${hearing.deadline}` : ""}` : "已截止";
  el("testify-link").href = `/t/${hearingId}`;
  el("testify-top").href = `/t/${hearingId}`;
  if (!open) {
    el("testify-top").classList.add("hidden");
    el("testify-link").parentElement.classList.add("hidden");
  }
  el("agenda").replaceChildren(renderAgenda(hearing.agenda, { withName: hearing.agenda.name !== hearing.title }));
  const total = hearing.testimonies || 0;
  el("stats").replaceChildren(...[[total, "份意見"], [hearing.counts.support, "支持"], [hearing.counts.oppose, "反對"], [hearing.counts.amend, "修正"]].map(([value, label]) => {
    const node = document.createElement("div");
    node.className = "stat";
    const b = document.createElement("b");
    b.textContent = String(value);
    const span = document.createElement("span");
    span.textContent = label;
    node.append(b, span);
    return node;
  }));
  el("bar").replaceChildren(...["support", "oppose", "amend"].map((key) => {
    const i = document.createElement("i");
    i.className = key;
    i.style.width = total ? `${(hearing.counts[key] / total) * 100}%` : "0";
    i.title = `${LABEL[key]} ${hearing.counts[key]}`;
    return i;
  }));
  render();
  if (location.hash) document.querySelector(location.hash)?.scrollIntoView({ block: "center" });
}

function render() {
  const query = el("search").value.trim().toLowerCase();
  const list = all
    .filter((t) => (!stance || t.stance === stance) && (!query || `${t.name} ${t.org} ${t.summary} ${t.text}`.toLowerCase().includes(query)))
    .sort((a, b) => (order === "new" ? b.id - a.id : a.id - b.id));
  el("list").replaceChildren(...list.map((t) => {
    const box = document.createElement("article");
    box.className = "testimony";
    box.id = `testimony-${t.id}`;
    const head = document.createElement("div");
    head.className = "head";
    const tag = document.createElement("span");
    tag.className = `tag ${t.stance}`;
    tag.textContent = LABEL[t.stance];
    const who = document.createElement("span");
    who.className = "who";
    who.textContent = t.org ? `${t.name}（${t.org}）` : t.name;
    const meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent = `未驗證身分 · ${new Date(t.createdAt).toLocaleDateString("zh-Hant-TW")}${t.revised ? " · 已修改" : ""} · #${t.id}`;
    head.append(tag, who, meta);
    box.append(head);
    if (t.summary) {
      const summary = document.createElement("div");
      summary.className = "summary";
      summary.textContent = t.summary;
      box.append(summary);
    }
    const text = document.createElement("div");
    text.className = "text";
    const long = t.text.length > CLAMP && !location.hash.endsWith(`-${t.id}`);
    text.textContent = long ? `${t.text.slice(0, CLAMP)}…` : t.text;
    box.append(text);
    if (long) {
      const more = document.createElement("button");
      more.type = "button";
      more.className = "linkbtn more";
      more.textContent = `展開全文（${t.text.length.toLocaleString("zh-Hant-TW")} 字）`;
      more.addEventListener("click", () => {
        text.textContent = t.text;
        more.remove();
      });
      box.append(more);
    }
    return box;
  }));
  if (list.length === 0) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = all.length === 0 ? "還沒有人留意見，你可以是第一個。" : "沒有符合的意見。";
    el("list").append(p);
  }
}
for (const button of el("filters").querySelectorAll("button")) {
  button.addEventListener("click", () => {
    stance = button.dataset.stance;
    for (const other of el("filters").querySelectorAll("button")) other.setAttribute("aria-pressed", String(other === button));
    render();
  });
}
for (const button of el("order").querySelectorAll("button")) {
  button.addEventListener("click", () => {
    order = button.dataset.order;
    for (const other of el("order").querySelectorAll("button")) other.setAttribute("aria-pressed", String(other === button));
    render();
  });
}
el("search").addEventListener("input", render);
function showError(message) {
  el("error").textContent = message;
  el("error").classList.remove("hidden");
  el("title").textContent = "無法顯示";
}
