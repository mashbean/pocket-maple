const hearingId = (location.pathname.match(/^\/r\/([a-z0-9]{10})/) || [])[1];
const el = (id) => document.getElementById(id);
const LABEL = { support: "支持", oppose: "反對", amend: "修正" };
let all = [];
let stance = "";
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
  el("state").textContent = hearing.status === "open" ? `收件中${hearing.deadline ? ` · 截止 ${hearing.deadline}` : ""}` : "已截止";
  el("testify-link").href = `/t/${hearingId}`;
  const agenda = el("agenda");
  agenda.replaceChildren();
  const name = document.createElement("strong");
  name.textContent = hearing.agenda.name;
  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = [hearing.agenda.proposer, hearing.agenda.status, hearing.agenda.laws.join("、"), hearing.agenda.kind === "bill" ? `議案編號 ${hearing.agenda.billNo}` : ""].filter(Boolean).join(" · ");
  agenda.append(name, meta);
  if (hearing.agenda.url) {
    const a = document.createElement("a");
    a.href = hearing.agenda.url;
    a.rel = "noopener";
    a.textContent = hearing.agenda.kind === "bill" ? "立法院議案資料" : "資料連結";
    agenda.append(a);
  }
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
    return i;
  }));
  render();
}

function render() {
  const query = el("search").value.trim().toLowerCase();
  const list = all.filter((t) => (!stance || t.stance === stance) && (!query || `${t.name} ${t.org} ${t.summary} ${t.text}`.toLowerCase().includes(query)));
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
    const pre = document.createElement("pre");
    pre.textContent = t.text;
    box.append(pre);
    return box;
  }));
  if (list.length === 0) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = "還沒有符合的意見。";
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
el("search").addEventListener("input", render);
function showError(message) {
  el("error").textContent = message;
  el("error").classList.remove("hidden");
  el("title").textContent = "無法顯示";
}
