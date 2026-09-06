import { renderAgenda } from "/agenda.js";

const el = (id) => document.getElementById(id);
let tab = "law";
let billNo = "";
let snapshot = null;
let bills = [];
let pickedLaw = null;
const OPEN_STATUSES = /交付審查|審查|排入院會|逕付|協商|一讀/;
const CLOSED_STATUSES = /三讀|審查完畢|通過|撤回|不予審議|退回/;

// ---- 分頁 ----
for (const button of document.querySelectorAll("[role=tab]")) {
  button.addEventListener("click", () => switchTab(button.dataset.tab));
}
function switchTab(next) {
  tab = next;
  for (const other of document.querySelectorAll("[role=tab]")) other.setAttribute("aria-selected", String(other.dataset.tab === tab));
  for (const name of ["law", "no", "manual"]) el(`tab-${name}`).classList.toggle("hidden", name !== tab);
  if (tab === "manual") clearPick();
}

// ---- 搜法律 ----
el("law-search").addEventListener("click", searchLaws);
el("law-q").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    searchLaws();
  }
});
el("bill-no").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    fetchBill(el("bill-no").value, el("no-status"));
  }
});
async function searchLaws() {
  const q = el("law-q").value.trim();
  if (!q) return void (el("law-status").textContent = "輸入法律名稱再搜。");
  el("law-status").textContent = "搜尋中…";
  el("bill-wrap").classList.add("hidden");
  el("law-hits").replaceChildren();
  const response = await fetch(`/api/laws?q=${encodeURIComponent(q)}`);
  const body = await response.json();
  if (!response.ok) return void (el("law-status").textContent = body.error || "搜尋失敗");
  if (body.laws.length === 0) return void (el("law-status").textContent = "找不到。資料庫用的是正式名稱與少數別名；試試更完整的名稱，例如「核子反應器設施管制法」。");
  el("law-status").textContent = `${body.laws.length} 部法律，點一部看本屆的法案。`;
  el("law-hits").replaceChildren(...body.laws.map((law) => {
    const hit = document.createElement("button");
    hit.type = "button";
    hit.className = "hit";
    const name = document.createElement("div");
    name.className = "name";
    name.textContent = law.name;
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = `${law.status} · 最新版本 ${law.latest}${law.aliases.length ? ` · 別名：${law.aliases.join("、")}` : ""}`;
    hit.append(name, meta);
    hit.addEventListener("click", () => listBills(law, hit));
    return hit;
  }));
}
async function listBills(law, hit) {
  pickedLaw = law;
  for (const other of el("law-hits").children) other.classList.toggle("picked", other === hit);
  el("law-status").textContent = `正在列出第 11 屆與「${law.name}」相關的法案…`;
  const response = await fetch(`/api/bills?law=${law.code}`);
  const body = await response.json();
  if (!response.ok) return void (el("law-status").textContent = body.error || "查詢失敗");
  bills = body.bills;
  el("law-status").textContent = "";
  if (bills.length === 0) return void (el("law-status").textContent = "本屆沒有相關法案；可以改用「貼議案編號」或「手動輸入」。");
  el("bill-wrap").classList.remove("hidden");
  renderBills();
  el("bill-wrap").scrollIntoView({ behavior: "smooth", block: "start" });
}
el("only-open").addEventListener("change", renderBills);
function statusKind(status) {
  if (CLOSED_STATUSES.test(status)) return "done";
  if (OPEN_STATUSES.test(status)) return "open";
  return "";
}
function renderBills() {
  const onlyOpen = el("only-open").checked;
  const list = bills.filter((bill) => !onlyOpen || statusKind(bill.status) !== "done");
  el("bill-title").textContent = `${pickedLaw.name}：第 11 屆 ${bills.length} 件${onlyOpen ? `，還在審的 ${list.length} 件` : ""}`;
  el("bill-hits").replaceChildren(...list.map((bill) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "hit";
    const name = document.createElement("div");
    name.className = "name";
    name.textContent = bill.name;
    const meta = document.createElement("div");
    meta.className = "meta";
    const badge = document.createElement("span");
    badge.className = `badge ${statusKind(bill.status)}`;
    badge.textContent = bill.status;
    meta.append(badge, `${bill.proposer}`, `${bill.date}`);
    item.append(name, meta);
    item.addEventListener("click", () => fetchBill(bill.billNo, el("law-status")));
    return item;
  }));
  if (list.length === 0) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = "這部法律本屆的法案都已經審完；取消勾選就能看全部。";
    el("bill-hits").append(p);
  }
}

// ---- 帶入法案 ----
el("bill-fetch").addEventListener("click", () => fetchBill(el("bill-no").value, el("no-status")));
async function fetchBill(value, statusNode) {
  if (!value.trim()) return void (statusNode.textContent = "貼上議案編號或網址。");
  statusNode.textContent = "帶入法案中…";
  const response = await fetch(`/api/bills?no=${encodeURIComponent(value)}`);
  const body = await response.json();
  if (!response.ok) return void (statusNode.textContent = body.error || "帶入失敗");
  snapshot = body.agenda;
  billNo = snapshot.billNo;
  statusNode.textContent = "";
  el("snapshot").replaceChildren(renderAgenda(snapshot, { withName: true }));
  el("picker").classList.add("hidden");
  el("picked").classList.remove("hidden");
  if (!el("title").value) el("title").value = snapshot.name.slice(0, 120);
  el("picked").scrollIntoView({ behavior: "smooth", block: "center" });
}
el("repick").addEventListener("click", () => {
  clearPick();
  el("picker").classList.remove("hidden");
});
function clearPick() {
  billNo = "";
  snapshot = null;
  el("picked").classList.add("hidden");
}

// ---- 建立 ----
el("create").addEventListener("submit", async (event) => {
  event.preventDefault();
  // 在搜尋框或議案編號框按 Enter 會觸發表單送出：改成搜尋／帶入，而不是建立。
  if (document.activeElement === el("law-q")) return searchLaws();
  if (document.activeElement === el("bill-no")) return fetchBill(el("bill-no").value, el("no-status"));
  const status = el("status");
  if (tab !== "manual" && !billNo) {
    status.textContent = "先帶入一個法案，或改用手動輸入。";
    el("picker").scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  if (tab === "manual" && !el("m-name").value.trim()) {
    status.textContent = "請輸入議程項目名稱。";
    el("m-name").focus();
    return;
  }
  if (!el("confirmed").checked) return void (status.textContent = "請先勾選告知事項。");
  el("submit").disabled = true;
  status.textContent = "正在建立…";
  try {
    const payload = {
      title: el("title").value,
      description: el("description").value,
      deadline: el("deadline").value,
      askOrg: el("ask-org").checked,
      requireSummary: el("require-summary").checked,
      confirmed: true,
    };
    if (tab === "manual") payload.agenda = { name: el("m-name").value, proposer: el("m-proposer").value, status: el("m-status").value, laws: el("m-laws").value.split(/[,，]/).map((s) => s.trim()).filter(Boolean), url: el("m-url").value, reason: el("m-reason").value };
    else payload.billNo = billNo;
    const response = await fetch("/api/hearings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const body = await response.json();
    if (!response.ok) return void (status.textContent = body.error || `建立失敗（${response.status}）`);
    for (const [id, url] of [["testify-link", body.urls.testify], ["archive-link", body.urls.archive], ["host-link", body.urls.host]]) {
      const a = el(id);
      a.href = url;
      a.textContent = url;
    }
    el("result").classList.remove("hidden");
    status.textContent = "已建立。";
    el("result").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "建立失敗。";
  } finally {
    el("submit").disabled = false;
  }
});
