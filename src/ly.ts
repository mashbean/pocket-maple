// 立法院即時 API（OpenFun 維護，免 token）的薄客戶端：搜法律、列某法律的法案、取單一法案快照。
import { type Agenda, cleanLine, cleanText } from "./schema";

export const CURRENT_TERM = 11;
const TIMEOUT_MS = 12_000;

export type LawHit = { code: string; name: string; aliases: string[]; status: string; latest: string };
export type BillHit = { billNo: string; name: string; proposer: string; status: string; date: string; laws: string[] };

export class LyError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** 「核子反應器設施管制法第六條條文修正草案」，請審議案。 → 核子反應器設施管制法第六條條文修正草案 */
export function cleanBillName(value: string): string {
  return value
    .replace(/[，,]\s*請審議案[。.]?\s*$/, "")
    .replace(/^本院委員[^「]{0,40}擬具/, "")
    .replace(/^「(.+)」$/, "$1")
    .replace(/^「/, "")
    .replace(/」$/, "")
    .trim();
}

export function isBillNo(value: string): boolean {
  return /^\d{15}$/.test(value);
}

/** 從貼上的字串抓議案編號：15 碼數字，或 ly.govapi.tw／ly.gov.tw 網址中的編號。 */
export function extractBillNo(value: string): string {
  const match = value.match(/\d{15}/);
  return match ? match[0] : "";
}

export async function searchLaws(origin: string, query: string, upstreamFetch: typeof fetch = fetch): Promise<LawHit[]> {
  const q = cleanLine(query, 60);
  if (!q) return [];
  // 上游的 q 是逐字模糊比對（「核管法」會撈到所有含「法」的法律），所以多抓一些再只留名稱或別名真的含查詢字串的。
  const body = await getJson(`${origin}/laws?q=${encodeURIComponent(q)}&limit=50`, upstreamFetch);
  const list = Array.isArray(body.laws) ? body.laws : [];
  const needle = q.toLowerCase();
  return list.filter(isRecord).map((law) => ({
    code: String(law.法律編號 ?? ""),
    name: cleanLine(law.名稱, 120),
    aliases: [...(Array.isArray(law.別名) ? law.別名 : []), ...(Array.isArray(law.其他名稱) ? law.其他名稱 : [])].map((item) => cleanLine(item, 80)).filter(Boolean),
    status: cleanLine(law.法律狀態, 20),
    latest: cleanLine(isRecord(law.最新版本) ? law.最新版本.日期 : "", 20),
  })).filter((law) => law.code && law.name && [law.name, ...law.aliases].some((text) => text.toLowerCase().includes(needle))).slice(0, 10);
}

export async function billsForLaw(origin: string, lawCode: string, upstreamFetch: typeof fetch = fetch, term = CURRENT_TERM): Promise<BillHit[]> {
  if (!/^\d{5}$/.test(lawCode)) throw new LyError("法律編號要是 5 碼數字", 400);
  const body = await getJson(`${origin}/bills?法律編號=${lawCode}&屆=${term}&limit=30`, upstreamFetch);
  const list = Array.isArray(body.bills) ? body.bills : [];
  return list.filter(isRecord).map(toBillHit).filter((bill) => bill.billNo && bill.name);
}

export async function fetchBill(origin: string, billNo: string, upstreamFetch: typeof fetch = fetch): Promise<Agenda> {
  if (!isBillNo(billNo)) throw new LyError("議案編號要是 15 碼數字", 400);
  const body = await getJson(`${origin}/bills/${billNo}`, upstreamFetch);
  const data = isRecord(body.data) ? body.data : null;
  if (!data || body.error === true) throw new LyError("立法院 API 找不到這個議案", 404);
  const hit = toBillHit(data);
  const progress = (Array.isArray(data.議案流程) ? data.議案流程 : []).filter(isRecord).map((step) => ({ status: cleanLine(step.狀態, 40), date: cleanLine(Array.isArray(step.日期) ? step.日期[step.日期.length - 1] : step.日期, 20) })).filter((step) => step.status).slice(-12);
  const url = typeof data.url === "string" && data.url.startsWith("https://") ? data.url : `https://ppg.ly.gov.tw/ppg/bills/${billNo}/details`;
  // 上游偶爾把別的議案的案由掛到這一筆：案由用《》點名的法律沒有一部是這個議案的相關法律時，就不採用。
  const reason = cleanText(data.案由, 2_000);
  const named = [...reason.matchAll(/《([^》]{2,40})》/g)].map((match) => match[1] as string);
  const reasonMatchesLaw = named.length === 0 || hit.laws.length === 0 || named.some((name) => hit.laws.some((law) => law.includes(name) || name.includes(law)));
  return { kind: "bill", billNo: hit.billNo, name: hit.name, proposer: hit.proposer, status: hit.status, laws: hit.laws, progress, reason: reasonMatchesLaw ? reason : "", url, fetchedAt: Date.now() };
}

function toBillHit(bill: Record<string, unknown>): BillHit {
  const proposers = Array.isArray(bill.提案人) ? bill.提案人.map((item) => cleanLine(item, 40)).filter(Boolean) : [];
  const unit = cleanLine(bill["提案單位/提案委員"], 120);
  return {
    billNo: String(bill.議案編號 ?? ""),
    name: cleanBillName(cleanLine(bill.議案名稱, 300)),
    proposer: proposers.length > 0 ? `${proposers.slice(0, 3).join("、")}${proposers.length > 3 ? ` 等 ${proposers.length} 人` : ""}` : unit,
    status: cleanLine(bill.議案狀態, 40),
    date: cleanLine(bill.最新進度日期, 20),
    laws: (Array.isArray(bill["法律編號:str"]) ? bill["法律編號:str"] : []).map((item) => cleanLine(item, 80)).filter(Boolean).slice(0, 10),
  };
}

async function getJson(url: string, upstreamFetch: typeof fetch): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await upstreamFetch(url, { headers: { Accept: "application/json", "User-Agent": "pocket-maple (+https://github.com/mashbean/pocket-maple)" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    throw new LyError(`立法院 API 沒有回應（${error instanceof Error ? error.name : "error"}）`, 502);
  }
  if (response.status === 404) throw new LyError("立法院 API 找不到這筆資料", 404);
  if (!response.ok) throw new LyError(`立法院 API 回應 ${response.status}`, 502);
  try {
    const body = (await response.json()) as unknown;
    return isRecord(body) ? body : {};
  } catch {
    throw new LyError("立法院 API 回應不是 JSON", 502);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
