import { COORDINATOR_INSTANCE, Coordinator } from "./coordinator";
import { HearingRoom } from "./hearing-room";
import { LyError, billsForLaw, extractBillNo, fetchBill, searchLaws } from "./ly";
import { type Agenda, SchemaError, normalizeManualAgenda, normalizeSettings } from "./schema";

export { Coordinator, HearingRoom };

const ADMIN_TOKEN = /^[0-9a-f]{32}$/;
const PARTICIPANT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 64 * 1024;

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/health") return health(request, env);
      if (url.pathname === "/api/laws") return lawsApi(request, env, url);
      if (url.pathname === "/api/bills") return billsApi(request, env, url);
      if (url.pathname === "/api/hearings" && request.method === "POST") return createHearing(request, env, url);
      const match = url.pathname.match(/^\/api\/hearings\/([a-z0-9]{10})(?:\/(testimonies|testimonies\/(\d+)\/remove|me|withdraw|host|status|export\/(?:testimonies\.csv|tttc\.csv|archive\.json)))?$/);
      if (match) return hearingApi(request, env, url, match[1] as string, match[2], match[3]);
      if (url.pathname.startsWith("/api/")) return jsonError("not found", 404);
      const page = url.pathname.match(/^\/(t|r|h)\/[a-z0-9]{10}\/?$/);
      if (page) return servePage(env, url, page[1] === "t" ? "/testify" : page[1] === "r" ? "/archive" : "/host", request);
      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error("unhandled", error instanceof Error ? error.message : error);
      return jsonError("internal error", 500);
    }
  },
} satisfies ExportedHandler<Env>;

async function servePage(env: Env, url: URL, path: string, request: Request): Promise<Response> {
  let page = await env.ASSETS.fetch(new Request(new URL(path, url.origin), { method: "GET", headers: request.headers }));
  for (let hop = 0; hop < 2 && page.status >= 300 && page.status < 400 && page.headers.get("location"); hop += 1) {
    page = await env.ASSETS.fetch(new Request(new URL(page.headers.get("location") as string, url.origin), { method: "GET", headers: request.headers }));
  }
  return new Response(page.body, { status: page.status, headers: withSecurity(new Headers(page.headers)) });
}

async function health(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return jsonError("method not allowed", 405);
  return json({ ok: true, maxTestimonies: Number(env.MAX_TESTIMONIES) || 0, lyApi: lyOrigin(env), sha: typeof env.BUILD_SHA === "string" ? env.BUILD_SHA : "" }, 200);
}

/** GET /api/laws?q=  搜法律名稱與別名（免 token） */
async function lawsApi(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method !== "GET") return jsonError("method not allowed", 405);
  try {
    return json({ laws: await searchLaws(lyOrigin(env), url.searchParams.get("q") ?? "") }, 200);
  } catch (error) {
    return lyFailure(error);
  }
}

/** GET /api/bills?law=<5碼>  某法律在本屆的法案；GET /api/bills?no=<15碼或網址>  單一法案快照 */
async function billsApi(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method !== "GET") return jsonError("method not allowed", 405);
  try {
    const no = url.searchParams.get("no");
    if (no) return json({ agenda: await fetchBill(lyOrigin(env), extractBillNo(no)) }, 200);
    return json({ bills: await billsForLaw(lyOrigin(env), url.searchParams.get("law") ?? "") }, 200);
  } catch (error) {
    return lyFailure(error);
  }
}

async function createHearing(request: Request, env: Env, url: URL): Promise<Response> {
  const body = await readJson(request);
  if (body instanceof Response) return body;
  if (body.confirmed !== true) return jsonError("confirmed must be true: the host has told participants testimonies are public under the name they give, unverified, and how they will be used", 400);
  let agenda: Agenda;
  try {
    if (typeof body.billNo === "string" && body.billNo.trim()) agenda = await fetchBill(lyOrigin(env), extractBillNo(body.billNo));
    else agenda = normalizeManualAgenda(body.agenda);
  } catch (error) {
    if (error instanceof SchemaError) return jsonError(error.message, 400);
    return lyFailure(error);
  }
  let settings;
  try {
    settings = normalizeSettings(body, agenda);
  } catch (error) {
    if (error instanceof SchemaError) return jsonError(error.message, 400);
    throw error;
  }
  const coordinator = env.COORDINATOR.get(env.COORDINATOR.idFromName(COORDINATOR_INSTANCE));
  if (!(await coordinator.reserveCreation())) return jsonError("creation rate limit reached, try again later", 429);
  const hearingId = randomId(10);
  const adminToken = randomHex(16);
  const stub = env.HEARING.get(env.HEARING.idFromName(hearingId));
  const created = await stub.create({ hearingId, adminHash: await sha256Hex(adminToken), settings });
  if (!created.ok) return jsonError(created.error, 500);
  return json(
    {
      hearingId,
      title: settings.title,
      agenda: settings.agenda,
      adminToken,
      urls: { testify: `${url.origin}/t/${hearingId}`, archive: `${url.origin}/r/${hearingId}`, host: `${url.origin}/h/${hearingId}#admin=${adminToken}`, api: `${url.origin}/api/hearings/${hearingId}` },
      privacy: { storedByService: true, storedFields: ["agenda snapshot", "testimonies (hashed device id, name as given, org, stance, text)"], adminTokenStored: "sha-256 hash only", identityVerified: false },
    },
    201,
  );
}

async function hearingApi(request: Request, env: Env, url: URL, hearingId: string, sub: string | undefined, targetId: string | undefined): Promise<Response> {
  const stub = env.HEARING.get(env.HEARING.idFromName(hearingId));
  if (!sub) {
    if (request.method === "DELETE") {
      const auth = await requireAdmin(request, url, stub);
      if (auth) return auth;
      return json({ ok: await stub.deleteHearing() }, 200);
    }
    if (request.method !== "GET" && request.method !== "HEAD") return jsonError("method not allowed", 405);
    const hearing = await stub.publicHearing();
    if (!hearing) return jsonError("not found", 404);
    if (hearing.status === "deleted") return jsonError("deleted", 410);
    return json(hearing, 200);
  }
  if (sub === "testimonies" && request.method === "GET") {
    const hearing = await stub.publicHearing();
    if (!hearing) return jsonError("not found", 404);
    if (hearing.status === "deleted") return jsonError("deleted", 410);
    return json({ hearing, testimonies: await stub.list() }, 200);
  }
  if (sub === "testimonies" || sub === "me" || sub === "withdraw") {
    if (request.method !== "POST") return jsonError("method not allowed", 405);
    const body = await readJson(request);
    if (body instanceof Response) return body;
    const participantId = typeof body.participantId === "string" ? body.participantId : "";
    if (!PARTICIPANT_ID.test(participantId)) return jsonError("participantId must be a v4 UUID", 400);
    const hash = await sha256Hex(participantId.toLowerCase());
    if (sub === "me") return json({ testimony: await stub.myTestimony(hash) }, 200);
    if (sub === "withdraw") return json({ ok: await stub.withdraw(hash) }, 200);
    const result = await stub.testify({ hash, testimony: body });
    if (!result.ok) return json({ error: result.error }, result.status);
    return json(result, 200);
  }
  const auth = await requireAdmin(request, url, stub);
  if (auth) return auth;
  if (targetId) {
    if (request.method !== "POST") return jsonError("method not allowed", 405);
    return json({ ok: await stub.removeTestimony(Number(targetId)) }, 200);
  }
  if (sub === "host") {
    const hearing = await stub.publicHearing();
    return hearing ? json({ ...hearing, list: await stub.list() }, 200) : jsonError("not found", 404);
  }
  if (sub === "status") {
    if (request.method !== "POST") return jsonError("method not allowed", 405);
    const body = await readJson(request);
    if (body instanceof Response) return body;
    if (body.status !== "open" && body.status !== "closed") return jsonError("status must be open or closed", 400);
    const status = await stub.setStatus(body.status);
    return status ? json({ status }, 200) : jsonError("not found", 404);
  }
  if (request.method !== "GET") return jsonError("method not allowed", 405);
  if (sub === "export/testimonies.csv") return csv(await stub.exportTestimoniesCsv(), `pocket-maple-${hearingId}-testimonies.csv`);
  if (sub === "export/tttc.csv") return csv(await stub.exportTttcCsv(), `pocket-maple-${hearingId}-tttc.csv`);
  return json({ hearing: await stub.publicHearing(), testimonies: await stub.list() }, 200);
}

function lyOrigin(env: Env): string {
  return typeof env.LY_API_ORIGIN === "string" && env.LY_API_ORIGIN ? env.LY_API_ORIGIN.replace(/\/$/, "") : "https://v2.ly.govapi.tw";
}

function lyFailure(error: unknown): Response {
  if (error instanceof LyError) return jsonError(error.message, error.status);
  throw error;
}

async function requireAdmin(request: Request, url: URL, stub: DurableObjectStub<HearingRoom>): Promise<Response | null> {
  const token = request.headers.get("X-Hearing-Admin") ?? url.searchParams.get("token") ?? "";
  if (!ADMIN_TOKEN.test(token)) return jsonError("missing admin token", 401);
  if (!(await stub.verifyAdmin(await sha256Hex(token)))) return jsonError("admin token does not match", 403);
  return null;
}

async function readJson(request: Request): Promise<Record<string, unknown> | Response> {
  if (!(request.headers.get("content-type") ?? "").startsWith("application/json")) return jsonError("send application/json", 400);
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return jsonError("request too large", 413);
  try {
    const body = JSON.parse(text);
    return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : jsonError("invalid body", 400);
  } catch {
    return jsonError("invalid JSON", 400);
  }
}

function randomId(length: number): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from(crypto.getRandomValues(new Uint8Array(length)), (byte) => alphabet[byte % alphabet.length]).join("");
}

function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function withSecurity(headers: Headers): Headers {
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  return headers;
}

function csv(text: string, filename: string): Response {
  return new Response(text, { headers: withSecurity(new Headers({ "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"` })) });
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: withSecurity(new Headers({ "Content-Type": "application/json; charset=utf-8" })) });
}

function jsonError(message: string, status: number): Response {
  return json({ error: message }, status);
}
