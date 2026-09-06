/** 議程卡：建立頁、留言頁、檔案頁共用。名稱與頁面標題相同時可以不重複。 */
export function renderAgenda(agenda, { withName = true } = {}) {
  const box = document.createElement("div");
  box.className = "agenda";
  if (withName) {
    const name = document.createElement("div");
    name.className = "name";
    name.textContent = agenda.name;
    box.append(name);
  }
  const meta = document.createElement("div");
  meta.className = "meta";
  for (const text of [agenda.proposer ? `提案：${agenda.proposer}` : "", agenda.status ? `狀態：${agenda.status}` : "", agenda.laws && agenda.laws.length ? `相關法律：${agenda.laws.join("、")}` : "", agenda.kind === "bill" ? `議案編號 ${agenda.billNo}` : ""].filter(Boolean)) {
    const span = document.createElement("span");
    span.textContent = text;
    meta.append(span);
  }
  if (agenda.url) {
    const a = document.createElement("a");
    a.href = agenda.url;
    a.rel = "noopener";
    a.target = "_blank";
    a.textContent = agenda.kind === "bill" ? "立法院議案資料 ↗" : "資料連結 ↗";
    meta.append(a);
  }
  box.append(meta);
  if (agenda.reason) {
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = "案由";
    const reason = document.createElement("p");
    reason.className = "reason";
    reason.textContent = agenda.reason;
    details.append(summary, reason);
    box.append(details);
  }
  if (agenda.progress && agenda.progress.length) {
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    const last = agenda.progress[agenda.progress.length - 1];
    summary.textContent = `議案流程（最新：${last.date} ${last.status}）`;
    const ol = document.createElement("ol");
    for (const step of agenda.progress) {
      const li = document.createElement("li");
      li.textContent = `${step.date} ${step.status}`;
      ol.append(li);
    }
    details.append(summary, ol);
    box.append(details);
  }
  return box;
}
