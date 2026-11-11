// The dashboard's API: Google sign-in → a LifeLog session, then read/edit/export.

import { createRemoteJWKSet, jwtVerify } from "jose";
import {
  UserError, addDays, createEntry, deleteEntry, fmtClock, hhmm, listEntries, listFoods, listKinds, nowLine,
  nyDate, parseDay, today, updateEntry, type Entry,
} from "./db";

export type ApiEnv = {
  DB: D1Database;
  SESSION_SECRET: string;
  GOOGLE_CLIENT_ID: string;
  ALLOWED_EMAILS: string;
  SITE_ORIGINS: string;
};

const SESSION_DAYS = 30;
const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

// ---------- helpers ----------

function cors(req: Request, env: ApiEnv): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const allowed = env.SITE_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean);
  if (!allowed.includes(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-expose-headers": "content-disposition",
    "access-control-max-age": "86400",
    vary: "origin",
  };
}

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
  });
}

const enc = new TextEncoder();
const b64url = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function hmacKey(secret: string) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function makeSession(secret: string, email: string): Promise<{ token: string; exp: number }> {
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  const payload = b64url(enc.encode(JSON.stringify({ email, exp })));
  const sig = b64url(await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(payload)));
  return { token: `v1.${payload}.${sig}`, exp };
}

async function readSession(secret: string, token: string): Promise<{ email: string } | null> {
  const [v, payload, sig] = token.split(".");
  if (v !== "v1" || !payload || !sig) return null;
  const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), fromB64url(sig), enc.encode(payload));
  if (!ok) return null;
  try {
    const { email, exp } = JSON.parse(new TextDecoder().decode(fromB64url(payload)));
    return typeof email === "string" && exp > Date.now() / 1000 ? { email } : null;
  } catch {
    return null;
  }
}

const allowedEmails = (env: ApiEnv) => env.ALLOWED_EMAILS.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

function toClient(e: Entry) {
  return { ...e, time: fmtClock(e.at), hhmm: hhmm(e.at), date: nyDate(new Date(e.at)) };
}

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ---------- handler ----------

export async function handleApi(req: Request, env: ApiEnv, path: string): Promise<Response> {
  const c = cors(req, env);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: c });
  const reply = (body: unknown, status = 200, extra: Record<string, string> = {}) => json(body, status, { ...c, ...extra });

  try {
    // Sign in: exchange a Google ID token for a 30-day LifeLog session.
    if (path === "/api/session" && req.method === "POST") {
      const { credential } = (await req.json()) as { credential?: string };
      if (!credential) return reply({ error: "Missing Google credential." }, 400);
      let email = "";
      try {
        const { payload } = await jwtVerify(credential, GOOGLE_JWKS, {
          issuer: ["https://accounts.google.com", "accounts.google.com"],
          audience: env.GOOGLE_CLIENT_ID,
        });
        if (payload.email_verified !== true) throw new Error("unverified email");
        email = String(payload.email ?? "").toLowerCase();
      } catch {
        return reply({ error: "Google sign-in couldn't be verified. Try again." }, 401);
      }
      if (!allowedEmails(env).includes(email)) return reply({ error: `${email} isn't allowed into this LifeLog.` }, 403);
      const s = await makeSession(env.SESSION_SECRET, email);
      return reply({ ...s, email });
    }

    // Everything else needs a session.
    const auth = req.headers.get("authorization") ?? "";
    const session = auth.startsWith("Bearer ") ? await readSession(env.SESSION_SECRET, auth.slice(7)) : null;
    if (!session || !allowedEmails(env).includes(session.email.toLowerCase())) return reply({ error: "Please sign in." }, 401);

    if (path === "/api/log" && req.method === "GET") {
      const url = new URL(req.url);
      const t = today();
      const to = url.searchParams.get("to") ? parseDay(url.searchParams.get("to")!) : t;
      const from = url.searchParams.get("from") ? parseDay(url.searchParams.get("from")!) : addDays(to, -6);
      const [entries, kinds] = await Promise.all([listEntries(env.DB, { from, to, limit: 2000 }), listKinds(env.DB)]);
      return reply({ today: t, now: nowLine(), from, to, kinds, entries: entries.map(toClient) });
    }

    if (path === "/api/entries" && req.method === "POST") {
      const body = (await req.json()) as Record<string, unknown>;
      const e = await createEntry(env.DB, {
        kind: String(body.kind ?? ""), summary: String(body.summary ?? ""), said: (body.said as string) ?? null,
        emoji: (body.emoji as string) ?? null, date: (body.date as string) ?? null, time: (body.time as string) ?? null,
        data: (body.data as Record<string, unknown>) ?? {}, source: "site",
      });
      return reply({ entry: toClient(e) }, 201);
    }

    const m = path.match(/^\/api\/entries\/(\d+)$/);
    if (m && req.method === "PATCH") {
      const body = (await req.json()) as Record<string, unknown>;
      const e = await updateEntry(env.DB, Number(m[1]), {
        kind: body.kind as string | undefined, summary: body.summary as string | undefined,
        said: body.said as string | undefined, emoji: body.emoji as string | undefined,
        date: body.date as string | undefined, time: body.time as string | undefined,
        data: body.data as Record<string, unknown> | undefined, replace_data: body.replace_data === true,
      });
      return reply({ entry: toClient(e) });
    }
    if (m && req.method === "DELETE") {
      await deleteEntry(env.DB, Number(m[1]));
      return reply({ ok: true });
    }

    if (path === "/api/foods" && req.method === "GET") return reply({ foods: await listFoods(env.DB) });

    if (path === "/api/export" && req.method === "GET") {
      const format = new URL(req.url).searchParams.get("format") === "csv" ? "csv" : "json";
      const [entries, kinds, foods] = await Promise.all([
        listEntries(env.DB, { from: "2000-01-01", to: "2999-12-31", limit: 50000 }).then((l) => l.sort((a, b) => a.at.localeCompare(b.at))),
        listKinds(env.DB),
        listFoods(env.DB),
      ]);
      const stamp = today();
      if (format === "json") {
        return new Response(JSON.stringify({ exported_at: new Date().toISOString(), kinds, foods, entries }, null, 2), {
          headers: { ...c, "content-type": "application/json", "content-disposition": `attachment; filename="lifelog-${stamp}.json"` },
        });
      }
      const cols = ["id", "day", "at", "time", "kind", "summary", "said", "source", "data"];
      const rows = entries.map((e) => {
        const r = { ...toClient(e) } as Record<string, unknown>;
        return cols.map((k) => csvCell(r[k])).join(",");
      });
      return new Response([cols.join(","), ...rows].join("\n"), {
        headers: { ...c, "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="lifelog-${stamp}.csv"` },
      });
    }

    return reply({ error: "Not found" }, 404);
  } catch (e) {
    if (e instanceof UserError) return reply({ error: e.message }, 400);
    console.error(e);
    return reply({ error: "Something went wrong on the server." }, 500);
  }
}
