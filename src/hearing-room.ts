import { DurableObject } from "cloudflare:workers";
import { csvTable } from "./csv";
import { cleanBillName } from "./ly";
import { DEFAULT_MAX_TESTIMONIES, SchemaError, STANCES, type Settings, type Stance, normalizeTestimony } from "./schema";

export type Status = "open" | "closed" | "deleted";
type HearingMeta = Settings & { hearingId: string; status: Status; createdAt: number; updatedAt: number; adminHash: string };
export type CreateInput = { hearingId: string; adminHash: string; settings: Settings };
type Fail = { ok: false; status: number; error: string };

export type Testimony = { id: number; stance: Stance; name: string; org: string; summary: string; text: string; createdAt: number; updatedAt: number; revised: boolean };
export type PublicHearing = Settings & { hearingId: string; status: Status; counts: Record<Stance, number>; testimonies: number; createdAt: number; updatedAt: number };

/** 一個議程項目一個 Durable Object：議程快照與所有證詞。 */
export class HearingRoom extends DurableObject<Env> {
  private migrated = false;

  private sql() {
    if (!this.migrated) {
      const sql = this.ctx.storage.sql;
      sql.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
      sql.exec(`CREATE TABLE IF NOT EXISTS testimonies (id INTEGER PRIMARY KEY AUTOINCREMENT, hash TEXT NOT NULL UNIQUE, stance TEXT NOT NULL, name TEXT NOT NULL, org TEXT NOT NULL, summary TEXT NOT NULL, text TEXT NOT NULL, removed INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
      this.migrated = true;
    }
    return this.ctx.storage.sql;
  }

  private meta(): HearingMeta | null {
    const rows = this.sql().exec(`SELECT value FROM meta WHERE key = 'hearing'`).toArray();
    if (rows.length === 0) return null;
    try {
      return JSON.parse(String(rows[0]?.value)) as HearingMeta;
    } catch {
      return null;
    }
  }

  private setMeta(meta: HearingMeta): void {
    this.sql().exec(`INSERT INTO meta (key, value) VALUES ('hearing', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, JSON.stringify(meta));
  }

  async create(input: CreateInput): Promise<{ ok: true } | { ok: false; error: string }> {
    if (this.meta()) return { ok: false, error: "hearing already exists" };
    const now = Date.now();
    this.setMeta({ ...input.settings, hearingId: input.hearingId, status: "open", createdAt: now, updatedAt: now, adminHash: input.adminHash });
    return { ok: true };
  }

  async publicHearing(): Promise<PublicHearing | null> {
    const meta = this.meta();
    return meta ? this.toPublic(meta) : null;
  }

  /** 一台裝置一份證詞；關閉前可修改。 */
  async testify(input: { hash: string; testimony: unknown }): Promise<{ ok: true; testimony: Testimony } | Fail> {
    const meta = this.meta();
    if (!meta) return { ok: false, status: 404, error: "not found" };
    if (meta.status === "deleted") return { ok: false, status: 410, error: "deleted" };
    if (meta.status !== "open") return { ok: false, status: 409, error: "這個公聽案已經截止" };
    if (meta.deadline && new Date(`${meta.deadline}T23:59:59+08:00`).getTime() < Date.now()) return { ok: false, status: 409, error: `已過截止日 ${meta.deadline}` };
    let normalized;
    try {
      normalized = normalizeTestimony(input.testimony, meta);
    } catch (error) {
      if (error instanceof SchemaError) return { ok: false, status: 400, error: error.message };
      throw error;
    }
    const existing = this.sql().exec(`SELECT id FROM testimonies WHERE hash = ?`, input.hash).toArray();
    if (existing.length === 0) {
      const limit = Number(this.env.MAX_TESTIMONIES) > 0 ? Number(this.env.MAX_TESTIMONIES) : DEFAULT_MAX_TESTIMONIES;
      const count = Number(this.sql().exec(`SELECT COUNT(*) AS n FROM testimonies WHERE removed = 0`).one().n);
      if (count >= limit) return { ok: false, status: 409, error: `已達 ${limit} 份證詞上限` };
    }
    const now = Date.now();
    // 先查再更新：upsert 即使走更新也會消耗 AUTOINCREMENT，證詞編號會跳號。
    if (existing.length > 0) {
      this.sql().exec(`UPDATE testimonies SET stance = ?, name = ?, org = ?, summary = ?, text = ?, updated_at = ?, removed = 0 WHERE hash = ?`, normalized.stance, normalized.name, normalized.org, normalized.summary, normalized.text, now, input.hash);
    } else {
      this.sql().exec(`INSERT INTO testimonies (hash, stance, name, org, summary, text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, input.hash, normalized.stance, normalized.name, normalized.org, normalized.summary, normalized.text, now, now);
    }
    this.setMeta({ ...meta, updatedAt: now });
    return { ok: true, testimony: this.mine(input.hash) as Testimony };
  }

  async myTestimony(hash: string): Promise<Testimony | null> {
    return this.mine(hash);
  }

  async withdraw(hash: string): Promise<boolean> {
    const changed = this.sql().exec(`UPDATE testimonies SET removed = 1, updated_at = ? WHERE hash = ? AND removed = 0`, Date.now(), hash);
    return changed.rowsWritten > 0;
  }

  async list(): Promise<Testimony[]> {
    return this.sql().exec(`SELECT id, stance, name, org, summary, text, created_at, updated_at FROM testimonies WHERE removed = 0 ORDER BY id`).toArray().map((row) => toTestimony(row as Record<string, unknown>));
  }

  async removeTestimony(id: number): Promise<boolean> {
    const changed = this.sql().exec(`UPDATE testimonies SET removed = 1, updated_at = ? WHERE id = ? AND removed = 0`, Date.now(), id);
    return changed.rowsWritten > 0;
  }

  async verifyAdmin(hash: string): Promise<boolean> {
    const meta = this.meta();
    return Boolean(meta) && timingSafeEqual(meta?.adminHash ?? "", hash);
  }

  async setStatus(status: "open" | "closed"): Promise<Status | null> {
    const meta = this.meta();
    if (!meta || meta.status === "deleted") return null;
    this.setMeta({ ...meta, status, updatedAt: Date.now() });
    return status;
  }

  async deleteHearing(): Promise<boolean> {
    const meta = this.meta();
    if (!meta) return false;
    await this.ctx.storage.deleteAll();
    this.migrated = false;
    this.sql();
    this.setMeta({ ...meta, title: "", description: "", agenda: { ...meta.agenda, name: "", reason: "" }, status: "deleted", updatedAt: Date.now() });
    return true;
  }

  async exportTestimoniesCsv(): Promise<string> {
    const rows = (await this.list()).map((item) => [`testimony-${item.id}`, item.stance, item.name, item.org, item.summary, item.text, new Date(item.createdAt).toISOString(), item.revised ? 1 : 0]);
    return csvTable(["id", "stance", "name", "org", "summary", "text", "created_at", "revised"], rows);
  }

  /** tttc.csv：一句話重點（沒有就用全文前 400 字）。 */
  async exportTttcCsv(): Promise<string> {
    const rows = (await this.list()).map((item) => [`testimony-${item.id}`, `${item.name}${item.org ? `（${item.org}）` : ""}`, `[${stanceLabel(item.stance)}] ${item.summary || item.text.slice(0, 400)}`]);
    return csvTable(["id", "interview", "comment"], rows);
  }

  private mine(hash: string): Testimony | null {
    const rows = this.sql().exec(`SELECT id, stance, name, org, summary, text, created_at, updated_at FROM testimonies WHERE hash = ? AND removed = 0`, hash).toArray();
    return rows.length > 0 ? toTestimony(rows[0] as Record<string, unknown>) : null;
  }

  private toPublic(meta: HearingMeta): PublicHearing {
    const { adminHash: _adminHash, ...rest } = meta;
    // 早期建立的案子存的是「」＋「，請審議案。」的原始名稱；讀取時一併清理，新舊一致。
    if (rest.agenda.kind === "bill") {
      rest.agenda = { ...rest.agenda, name: cleanBillName(rest.agenda.name) };
      rest.title = cleanBillName(rest.title);
    }
    const counts = { support: 0, oppose: 0, amend: 0 } as Record<Stance, number>;
    for (const row of this.sql().exec(`SELECT stance, COUNT(*) AS n FROM testimonies WHERE removed = 0 GROUP BY stance`).toArray()) {
      const stance = STANCES.find((item) => item === String(row.stance));
      if (stance) counts[stance] = Number(row.n);
    }
    return { ...rest, counts, testimonies: counts.support + counts.oppose + counts.amend };
  }
}

export function stanceLabel(stance: Stance): string {
  return stance === "support" ? "支持" : stance === "oppose" ? "反對" : "修正";
}

function toTestimony(row: Record<string, unknown>): Testimony {
  return { id: Number(row.id), stance: String(row.stance) as Stance, name: String(row.name), org: String(row.org), summary: String(row.summary), text: String(row.text), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at), revised: Number(row.updated_at) !== Number(row.created_at) };
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return diff === 0;
}
