import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { billsForLaw, extractBillNo, fetchBill, searchLaws } from "../src/ly";

const uuid = (seed: string) => `${seed.padEnd(8, "0").slice(0, 8)}-0000-4000-8000-000000000000`;
const BILL = {
  屆: 11, 議案編號: "202110231310000", 議案名稱: "「核子反應器設施管制法第六條條文修正草案」，請審議案。", 提案人: ["陳菁徽", "王育敏", "李彥秀", "羅廷瑋"], "提案單位/提案委員": "本院委員陳菁徽等17人", 議案狀態: "排入院會", 最新進度日期: "2026-08-28", "法律編號:str": ["核子反應器設施管制法"], 法律編號: ["02711"],
  議案流程: [{ 狀態: "一讀", 日期: ["2026-08-01"] }, { 狀態: "排入院會", 日期: ["2026-08-28"] }], 案由: "為使核能電廠得於安全審查通過後延長運轉，爰擬具本修正草案。", url: "https://ppg.ly.gov.tw/ppg/bills/202110231310000/details",
};
const mockFetch = (routes: Record<string, unknown>) => (async (input: RequestInfo | URL) => {
  const url = new URL(String(input));
  const key = `${url.pathname}${url.search}`;
  const hit = routes[decodeURIComponent(key)];
  return hit === undefined ? new Response("nope", { status: 404 }) : new Response(JSON.stringify(hit), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  const response = await SELF.fetch(path.startsWith("http") ? path : `https://example.com${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  return { status: response.status, body: (await response.json()) as Record<string, any> };
}

describe("ly client", () => {
  it("extracts a bill number from a pasted id or URL", () => {
    expect(extractBillNo("https://ppg.ly.gov.tw/ppg/bills/202110231310000/details")).toBe("202110231310000");
    expect(extractBillNo(" 202110231310000 ")).toBe("202110231310000");
    expect(extractBillNo("abc")).toBe("");
  });

  it("searches laws, lists a law's bills in the current term and snapshots one bill, all token-free", async () => {
    const upstream = mockFetch({
      "/laws?q=核子&limit=10": { laws: [{ 法律編號: "02711", 名稱: "核子反應器設施管制法", 別名: ["核管法"], 其他名稱: [], 法律狀態: "現行", 最新版本: { 日期: "2025-05-13" } }] },
      "/bills?法律編號=02711&屆=11&limit=30": { bills: [BILL] },
      "/bills/202110231310000": { error: false, data: BILL },
    });
    expect(await searchLaws("https://ly.test", "核子", upstream)).toEqual([{ code: "02711", name: "核子反應器設施管制法", aliases: ["核管法"], status: "現行", latest: "2025-05-13" }]);
    const bills = await billsForLaw("https://ly.test", "02711", upstream);
    expect(bills[0]).toMatchObject({ billNo: "202110231310000", proposer: "陳菁徽、王育敏、李彥秀 等 4 人", status: "排入院會", laws: ["核子反應器設施管制法"] });
    await expect(billsForLaw("https://ly.test", "12", upstream)).rejects.toThrow(/5 碼/);
    const agenda = await fetchBill("https://ly.test", "202110231310000", upstream);
    expect(agenda).toMatchObject({ kind: "bill", billNo: "202110231310000", status: "排入院會", reason: "為使核能電廠得於安全審查通過後延長運轉，爰擬具本修正草案。", url: "https://ppg.ly.gov.tw/ppg/bills/202110231310000/details" });
    expect(agenda.progress).toEqual([{ status: "一讀", date: "2026-08-01" }, { status: "排入院會", date: "2026-08-28" }]);
    await expect(fetchBill("https://ly.test", "999999999999999", upstream)).rejects.toThrow(/找不到/);
  });

  it("turns an unreachable Legislative Yuan API into a clean 502 through the Worker", async () => {
    expect((await SELF.fetch("https://example.com/api/bills?law=12")).status).toBe(400);
    const dead = await SELF.fetch("https://example.com/api/laws?q=核子");
    expect(dead.status).toBe(502);
    expect(((await dead.json()) as Record<string, any>).error).toContain("立法院 API");
    expect((await post("/api/hearings", { billNo: "202110231310000", confirmed: true })).status).toBe(502);
  });
});

describe("Pocket Maple worker", () => {
  it("creates a hearing, takes stance + testimony per device, archives, exports, closes and deletes", async () => {
    expect((await post("/api/hearings", { agenda: { name: "x" }, confirmed: false })).status).toBe(400);
    const created = await post("/api/hearings", { agenda: { name: "核子反應器設施管制法第六條修正草案（委員會審查）", proposer: "本院委員陳菁徽等17人", status: "排入院會", laws: ["核子反應器設施管制法"], url: "https://ppg.ly.gov.tw/ppg/bills/202110231310000/details", reason: "為使核能電廠得於安全審查通過後延長運轉。" }, description: "委員會審查前徵求書面意見。", deadline: "2099-12-31", confirmed: true });
    expect(created.status).toBe(201);
    expect(created.body.agenda).toMatchObject({ kind: "manual", proposer: "本院委員陳菁徽等17人", laws: ["核子反應器設施管制法"] });
    expect(created.body.title).toContain("核子反應器設施管制法");
    const api = created.body.urls.api as string;
    const admin = { "X-Hearing-Admin": created.body.adminToken as string };

    expect((await post(`${api}/testimonies`, { participantId: uuid("a"), stance: "maybe", name: "阿德", text: "太短" })).status).toBe(400);
    expect((await post(`${api}/testimonies`, { participantId: uuid("a"), stance: "oppose", name: "阿德", text: "我家離核三五公里，撤離道路只有一條，這條修正案沒有處理這件事。" })).status).toBe(400);
    const t1 = await post(`${api}/testimonies`, { participantId: uuid("a"), stance: "oppose", name: "阿德", org: "恆春鎮民", summary: "撤離道路沒解決前不該延役", text: "我家離核三五公里，撤離道路只有一條，這條修正案沒有處理這件事。" });
    expect(t1.status).toBe(200);
    expect(t1.body.testimony).toMatchObject({ id: 1, stance: "oppose", name: "阿德", org: "恆春鎮民", revised: false });
    const t1b = await post(`${api}/testimonies`, { participantId: uuid("a"), stance: "amend", name: "阿德", org: "恆春鎮民", summary: "加上撤離道路完工為延役前提", text: "我家離核三五公里，撤離道路只有一條。建議修正案加上第二條撤離道路完工作為延役前提。" });
    expect(t1b.body.testimony).toMatchObject({ id: 1, stance: "amend", revised: true });
    expect((await post(`${api}/testimonies`, { participantId: uuid("b"), stance: "support", name: "Vivian", org: "園區廠務", summary: "供電穩定", text: "廠裡一次跳電損失幾千萬，安全審查通過就該延役。" })).status).toBe(200);
    expect((await post(`${api}/testimonies`, { participantId: uuid("c"), stance: "oppose", name: "美惠", summary: "核廢沒去處", text: "核廢料最終處置場址沒有選定，延役等於把問題再推十年。" })).status).toBe(200);
    expect((await post(`${api}/me`, { participantId: uuid("a") })).body.testimony.stance).toBe("amend");
    expect((await post(`${api}/withdraw`, { participantId: uuid("c") })).body.ok).toBe(true);
    expect((await post(`${api}/me`, { participantId: uuid("c") })).body.testimony).toBeNull();

    const pub = (await (await SELF.fetch(api)).json()) as Record<string, any>;
    expect(pub.counts).toEqual({ support: 1, oppose: 0, amend: 1 });
    expect(pub.adminHash).toBeUndefined();
    const archive = (await (await SELF.fetch(`${api}/testimonies`)).json()) as Record<string, any>;
    expect(archive.testimonies.map((t: any) => t.name)).toEqual(["阿德", "Vivian"]);
    const tttc = (await (await SELF.fetch(`${api}/export/tttc.csv?token=${created.body.adminToken}`)).text()).trimEnd().split("\n");
    expect(tttc).toEqual(["id,interview,comment", "testimony-1,阿德（恆春鎮民）,[修正] 加上撤離道路完工為延役前提", "testimony-2,Vivian（園區廠務）,[支持] 供電穩定"]);
    const csvText = (await (await SELF.fetch(`${api}/export/testimonies.csv`, { headers: admin })).text()).trimEnd().split("\n");
    expect(csvText[0]).toBe("id,stance,name,org,summary,text,created_at,revised");
    expect(csvText[1]).toContain("testimony-1,amend,阿德,恆春鎮民,");

    for (const seed of ["d", "e", "f"]) expect((await post(`${api}/testimonies`, { participantId: uuid(seed), stance: "support", name: seed, summary: "s", text: "這是用來填滿上限的證詞，內容至少要二十個字才會被接受。" })).status).toBe(200);
    expect((await post(`${api}/testimonies`, { participantId: uuid("9"), stance: "support", name: "x", summary: "s", text: "這是第五份，應該被五份的上限擋掉才對，內容夠長。" })).status).toBe(409);
    expect((await post(`${api}/testimonies/2/remove`, {}, admin)).body.ok).toBe(true);
    expect((await post(`${api}/status`, { status: "closed" }, admin)).body.status).toBe("closed");
    expect((await post(`${api}/testimonies`, { participantId: uuid("a"), stance: "support", name: "阿德", summary: "s", text: "關閉後不能再送，這段文字只是為了夠長。" })).status).toBe(409);
    const page = await SELF.fetch(created.body.urls.archive, { redirect: "manual" });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Pocket Maple");
    expect((await SELF.fetch(api, { method: "DELETE", headers: admin })).status).toBe(200);
    expect((await SELF.fetch(api)).status).toBe(410);
  });

  it("rejects a past deadline at testimony time and an empty manual agenda", async () => {
    const created = await post("/api/hearings", { agenda: { name: "恆春鎮核三延役公聽會", proposer: "恆春鎮公所", status: "2026-10-01 舉行" }, deadline: "2000-01-01", confirmed: true });
    expect(created.status).toBe(201);
    const late = await post(`${created.body.urls.api}/testimonies`, { participantId: uuid("a"), stance: "support", name: "阿德", summary: "s", text: "這份證詞因為過了截止日應該被擋下來，字數夠長。" });
    expect(late.status).toBe(409);
    expect(late.body.error).toContain("截止");
    expect((await post("/api/hearings", { agenda: {}, confirmed: true })).status).toBe(400);
  });
});
