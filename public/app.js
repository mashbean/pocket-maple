const el = (id) => document.getElementById(id);
const status = el("status");
let tab = "law";
let billNo = "";
let snapshot = null;

for (const button of document.querySelectorAll("[role=tab]")) {
  button.addEventListener("click", () => {
    tab = button.dataset.tab;
    for (const other of document.querySelectorAll("[role=tab]")) other.setAttribute("aria-selected", String(other === button));
    for (const name of ["law", "no", "manual"]) el(`tab-${name}`).classList.toggle("hidden", name !== tab);
    if (tab === "manual") {
      billNo = "";
      snapshot = null;
      el("snapshot").classList.add("hidden");
    }
  });
}

el("law-search").addEventListener("click", searchLaws);
el("law-q").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    searchLaws();
  }
});
async function searchLaws() {
  status.textContent = "搜尋中…";
  el("bill-hits").replaceChildren();
  const response = await fetch(`/api/laws?q=${encodeURIComponent(el("law-q").value)}`);
  const body = await response.json();
  if (!response.ok) return void (status.textContent = body.error || "搜尋失敗");
  status.textContent = body.laws.length ? "" : "找不到這個法律。";
  el("law-hits").replaceChildren(...body.laws.map((law) => {
    const hit = document.createElement("div");
    hit.className = "hit";
    hit.innerHTML = `<div></div><div class="meta"></div>`;
    hit.firstChild.textContent = law.name;
    hit.lastChild.textContent = `${law.code} · ${law.status} · 最新版本 ${law.latest}${law.aliases.length ? ` · 別名：${law.aliases.join("、")}` : ""}`;
    hit.addEventListener("click", () => listBills(law, hit));
    return hit;
  }));
}
async function listBills(law, hit) {
  for (const other of el("law-hits").children) other.classList.toggle("picked", other === hit);
  status.textContent = `正在列出第 11 屆與「${law.name}」相關的法案…`;
  const response = await fetch(`/api/bills?law=${law.code}`);
  const body = await response.json();
  if (!response.ok) return void (status.textContent = body.error || "查詢失敗");
  status.textContent = body.bills.length ? `${body.bills.length} 件，點一件帶入。` : "本屆沒有相關法案；可以改用手動輸入。";
  el("bill-hits").replaceChildren(...body.bills.map((bill) => {
    const item = document.createElement("div");
    item.className = "hit";
    item.innerHTML = `<div></div><div class="meta"></div>`;
    item.firstChild.textContent = bill.name;
    item.lastChild.textContent = `${bill.proposer} · ${bill.status} · ${bill.date} · ${bill.billNo}`;
    item.addEventListener("click", () => fetchBill(bill.billNo, item));
    return item;
  }));
}
el("bill-fetch").addEventListener("click", () => fetchBill(el("bill-no").value));
async function fetchBill(value, item) {
  if (item) for (const other of el("bill-hits").children) other.classList.toggle("picked", other === item);
  status.textContent = "帶入法案中…";
  const response = await fetch(`/api/bills?no=${encodeURIComponent(value)}`);
  const body = await response.json();
  if (!response.ok) return void (status.textContent = body.error || "帶入失敗");
  snapshot = body.agenda;
  billNo = snapshot.billNo;
  const box = el("snapshot");
  box.replaceChildren();
  const name = document.createElement("strong");
  name.textContent = snapshot.name;
  const meta = document.createElement("div");
  meta.className = "hint";
  meta.textContent = `${snapshot.proposer} · ${snapshot.status} · ${snapshot.laws.join("、")}`;
  const reason = document.createElement("p");
  reason.textContent = snapshot.reason;
  box.append(name, meta, reason);
  box.classList.remove("hidden");
  if (!el("title").value) el("title").value = snapshot.name.slice(0, 120);
  status.textContent = "已帶入。";
}

el("create").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!el("confirmed").checked) return void (status.textContent = "請先確認你會告知參與者。");
  if (tab !== "manual" && !billNo) return void (status.textContent = "先帶入一個法案，或改用手動輸入。");
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
