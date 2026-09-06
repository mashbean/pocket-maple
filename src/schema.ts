export class SchemaError extends Error {}

export const DEFAULT_MAX_TESTIMONIES = 2000;
export const MAX_TESTIMONY_CHARS = 4_000;
export const STANCES = ["support", "oppose", "amend"] as const;
export type Stance = (typeof STANCES)[number];

/** 議程項目快照：來自立法院 API 的法案，或主辦者手動輸入（公聽會、地方議會）。 */
export type Agenda = {
  kind: "bill" | "manual";
  billNo: string;
  name: string;
  proposer: string;
  status: string;
  laws: string[];
  progress: { status: string; date: string }[];
  reason: string;
  url: string;
  fetchedAt: number;
};

export type Settings = {
  title: string;
  description: string;
  agenda: Agenda;
  /** 截止（ISO 日期字串，空＝不設） */
  deadline: string;
  askOrg: boolean;
  requireSummary: boolean;
};

export function normalizeSettings(raw: unknown, agenda: Agenda): Settings {
  const record = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const title = cleanLine(record.title, 120) || agenda.name.slice(0, 120);
  if (!title) throw new SchemaError("先幫這個公聽案取一個名字");
  const deadline = typeof record.deadline === "string" && /^\d{4}-\d{2}-\d{2}$/.test(record.deadline) ? record.deadline : "";
  return { title, description: cleanText(record.description, 2_000), agenda, deadline, askOrg: record.askOrg !== false, requireSummary: record.requireSummary !== false };
}

export function normalizeManualAgenda(raw: unknown): Agenda {
  const record = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const name = cleanLine(record.name, 200);
  if (!name) throw new SchemaError("請輸入議程項目名稱（法案、公聽會或議案）");
  return { kind: "manual", billNo: "", name, proposer: cleanLine(record.proposer, 120), status: cleanLine(record.status, 60), laws: (Array.isArray(record.laws) ? record.laws : []).map((law) => cleanLine(law, 80)).filter(Boolean).slice(0, 10), progress: [], reason: cleanText(record.reason, 2_000), url: cleanUrl(record.url), fetchedAt: Date.now() };
}

export function normalizeTestimony(raw: unknown, settings: Settings): { stance: Stance; name: string; org: string; summary: string; text: string } {
  const record = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const stance = STANCES.find((item) => item === record.stance);
  if (!stance) throw new SchemaError("立場要是 support（支持）、oppose（反對）或 amend（修正）");
  const name = cleanLine(record.name, 60);
  if (!name) throw new SchemaError("請留下名字或化名");
  const text = cleanText(record.text, MAX_TESTIMONY_CHARS);
  if (text.length < 20) throw new SchemaError("證詞至少 20 字");
  const summary = cleanLine(record.summary, 200);
  if (settings.requireSummary && !summary) throw new SchemaError("請用一句話說你的重點");
  return { stance, name, org: settings.askOrg ? cleanLine(record.org, 120) : "", summary, text };
}

export function cleanLine(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

export function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/\r\n?/g, "\n").replace(/[\t ]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);
}

export function cleanUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && url.href.length <= 2_048 ? url.href : "";
  } catch {
    return "";
  }
}
