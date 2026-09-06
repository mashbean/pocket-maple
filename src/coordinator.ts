import { DurableObject } from "cloudflare:workers";

export const COORDINATOR_INSTANCE = "app";
const CREATE_PER_HOUR = 10;
const CREATE_PER_DAY = 50;

/** 全部署共用的一個 Durable Object：建立公聽案的頻率限制（每小時 10、每日 50）。 */
export class Coordinator extends DurableObject<Env> {
  private migrated = false;

  private sql() {
    if (!this.migrated) {
      this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS creations (created_at INTEGER NOT NULL)`);
      this.migrated = true;
    }
    return this.ctx.storage.sql;
  }

  async reserveCreation(): Promise<boolean> {
    const now = Date.now();
    return this.ctx.storage.transactionSync(() => {
      this.sql().exec(`DELETE FROM creations WHERE created_at < ?`, now - 24 * 60 * 60 * 1000);
      const day = Number(this.sql().exec(`SELECT COUNT(*) AS n FROM creations`).one().n);
      const hour = Number(this.sql().exec(`SELECT COUNT(*) AS n FROM creations WHERE created_at >= ?`, now - 60 * 60 * 1000).one().n);
      if (day >= CREATE_PER_DAY || hour >= CREATE_PER_HOUR) return false;
      this.sql().exec(`INSERT INTO creations (created_at) VALUES (?)`, now);
      return true;
    });
  }
}
