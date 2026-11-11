// Core LifeLog logic shared by Claude's tools (mcp.ts) and the dashboard API (api.ts).

export const TZ = "America/New_York";
const DAY_ENDS_AT_HOUR = 4; // a 1 a.m. snack belongs to the day before
export const NUTRIENTS = ["calories", "protein_g", "carbs_g", "fat_g", "fiber_g", "sugar_g", "sodium_mg"] as const;

export class UserError extends Error {}

// ---------- types ----------

export type FieldDef = { key: string; label: string; type: "number" | "text" | "time" | "rating10" | "items"; unit?: string; hint?: string };
export type TileDef = { label: string; field: string; agg: "sum" | "last" | "avg" | "max" | "count"; format?: string; unit?: string };
export type Kind = { name: string; label: string; emoji: string; description: string; fields: FieldDef[]; tiles: TileDef[]; sort: number };
export type Food = { id: number; name: string; aliases: string[]; serving: string; nutrition: Record<string, number>; verified: boolean; notes: string | null };
export type Data = Record<string, unknown>;
export type Entry = {
  id: number; day: string; at: string; kind: string; emoji: string | null; summary: string; said: string | null;
  data: Data; source: string; created_at: string; updated_at: string;
};
export type EntryInput = {
  kind: string; summary: string; said?: string | null; emoji?: string | null;
  date?: string | null; time?: string | null; data?: Data | null; source: "voice" | "site";
};
export type EntryPatch = Partial<Omit<EntryInput, "source">> & { replace_data?: boolean };

// ---------- time ----------

const partsFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

export function nyParts(d: Date) {
  const p: Record<string, string> = {};
  for (const { type, value } of partsFmt.formatToParts(d)) p[type] = value;
  return { y: +p.year, m: +p.month, d: +p.day, hh: +p.hour % 24, mm: +p.minute, ss: +p.second };
}

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Calendar date in New York (no 4 a.m. rule). */
export function nyDate(d: Date): string {
  const p = nyParts(d);
  return ymd(p.y, p.m, p.d);
}

/** The LifeLog day an entry belongs to. Sleep belongs to the day you wake up. */
export function dayFor(at: Date, kind: string): string {
  const p = nyParts(at);
  const date = ymd(p.y, p.m, p.d);
  return kind !== "sleep" && p.hh < DAY_ENDS_AT_HOUR ? addDays(date, -1) : date;
}

/** Today's LifeLog day (before 4 a.m. it's still yesterday). */
export function today(now = new Date()): string {
  return dayFor(now, "any");
}

/** New York wall-clock date + time → real instant. */
export function nyToInstant(date: string, time: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  let guess = wall;
  for (let i = 0; i < 2; i++) {
    const p = nyParts(new Date(guess));
    const shown = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm);
    guess += wall - shown;
  }
  return new Date(guess);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseTime(t: string): string {
  const s = t.trim().toLowerCase().replace(/\./g, "");
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?$/);
  if (!m) throw new UserError(`Couldn't read the time "${t}". Use 24-hour HH:MM, e.g. 08:15 or 20:30.`);
  let hh = +m[1];
  const mm = m[2] ? +m[2] : 0;
  const ap = m[3];
  if (ap?.startsWith("p") && hh < 12) hh += 12;
  if (ap?.startsWith("a") && hh === 12) hh = 0;
  if (hh > 23 || mm > 59) throw new UserError(`"${t}" isn't a valid time.`);
  return `${pad(hh)}:${pad(mm)}`;
}

export function parseDay(s: string, now = new Date()): string {
  const v = s.trim().toLowerCase();
  if (v === "today") return today(now);
  if (v === "yesterday") return addDays(today(now), -1);
  if (DATE_RE.test(v)) return v;
  throw new UserError(`Couldn't read the date "${s}". Use YYYY-MM-DD, "today" or "yesterday".`);
}

/** When something happened, from optional local date/time. Missing time → now (or noon on a past date). */
export function resolveWhen(date: string | null | undefined, time: string | null | undefined, now = new Date()): Date {
  if (!date && !time) return now;
  if (date && !time) {
    const d = parseDay(date, now);
    return d === nyDate(now) ? now : nyToInstant(d, "12:00");
  }
  const t = parseTime(time!);
  if (date) return nyToInstant(parseDay(date, now), t);
  // Time only: the most recent occurrence of that wall-clock time (dinner at 20:00, said at 1 a.m. → last night).
  let at = nyToInstant(nyDate(now), t);
  if (at.getTime() > now.getTime() + 60 * 60 * 1000) at = nyToInstant(addDays(nyDate(now), -1), t);
  return at;
}

export function fmtClock(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
}
export function hhmm(iso: string): string {
  const p = nyParts(new Date(iso));
  return `${pad(p.hh)}:${pad(p.mm)}`;
}
export function fmtDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
}
export function nowLine(now = new Date()): string {
  return `${new Date(now).toLocaleString("en-US", { timeZone: TZ, weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })} (New York time). Today's LifeLog day is ${today(now)}.`;
}

// ---------- rows ----------

const parse = <T>(s: unknown, fallback: T): T => {
  if (typeof s !== "string") return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
};

function rowToKind(r: Record<string, unknown>): Kind {
  return {
    name: String(r.name), label: String(r.label), emoji: String(r.emoji), description: String(r.description ?? ""),
    fields: parse(r.fields, []), tiles: parse(r.tiles, []), sort: Number(r.sort ?? 100),
  };
}
function rowToFood(r: Record<string, unknown>): Food {
  return {
    id: Number(r.id), name: String(r.name), aliases: parse(r.aliases, []), serving: String(r.serving),
    nutrition: parse(r.nutrition, {}), verified: !!r.verified, notes: (r.notes as string) ?? null,
  };
}
function rowToEntry(r: Record<string, unknown>): Entry {
  return {
    id: Number(r.id), day: String(r.day), at: String(r.at), kind: String(r.kind), emoji: (r.emoji as string) ?? null,
    summary: String(r.summary), said: (r.said as string) ?? null, data: parse(r.data, {}), source: String(r.source),
    created_at: String(r.created_at), updated_at: String(r.updated_at),
  };
}

export async function listKinds(db: D1Database): Promise<Kind[]> {
  const { results } = await db.prepare("SELECT * FROM kinds ORDER BY sort, name").all();
  return results.map(rowToKind);
}
export async function getKind(db: D1Database, name: string): Promise<Kind | null> {
  const r = await db.prepare("SELECT * FROM kinds WHERE name = ?").bind(name).first();
  return r ? rowToKind(r) : null;
}
export async function listFoods(db: D1Database): Promise<Food[]> {
  const { results } = await db.prepare("SELECT * FROM foods ORDER BY name").all();
  return results.map(rowToFood);
}
export async function getEntry(db: D1Database, id: number): Promise<Entry | null> {
  const r = await db.prepare("SELECT * FROM entries WHERE id = ? AND deleted_at IS NULL").bind(id).first();
  return r ? rowToEntry(r) : null;
}

export async function listEntries(
  db: D1Database,
  opts: { from: string; to: string; kind?: string | null; query?: string | null; limit?: number },
): Promise<Entry[]> {
  const where = ["deleted_at IS NULL", "day >= ?", "day <= ?"];
  const binds: unknown[] = [opts.from, opts.to];
  if (opts.kind) { where.push("kind = ?"); binds.push(opts.kind); }
  if (opts.query) {
    where.push("(summary LIKE ? OR said LIKE ? OR data LIKE ?)");
    const q = `%${opts.query}%`;
    binds.push(q, q, q);
  }
  const limit = Math.min(Math.max(opts.limit ?? 500, 1), 50000);
  const { results } = await db
    .prepare(`SELECT * FROM entries WHERE ${where.join(" AND ")} ORDER BY day DESC, at ASC LIMIT ${limit}`)
    .bind(...binds)
    .all();
  return results.map(rowToEntry);
}

// ---------- kind-specific shaping ----------

const round = (n: number, places = 0) => { const f = 10 ** places; return Math.round(n * f) / f; };
const num = (v: unknown): number | undefined => {
  if (v === null || v === undefined || v === "") return undefined;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : undefined;
};

function matchFood(foods: Food[], name: string): Food | undefined {
  const k = name.trim().toLowerCase();
  return foods.find((f) => f.name.toLowerCase() === k || f.aliases.some((a) => a.trim().toLowerCase() === k));
}

/** Food: apply the food library to items, then total the nutrients. */
function shapeFood(data: Data, foods: Food[]): Data {
  const items = Array.isArray(data.items) ? (data.items as Data[]) : [];
  if (!items.length) {
    for (const n of NUTRIENTS) { const v = num(data[n]); if (v === undefined) delete data[n]; else data[n] = v; }
    return data;
  }
  const out = items.map((raw) => {
    const item: Data = { ...raw, name: String(raw.name ?? "").trim() || "item" };
    const servings = num(item.servings) ?? 1;
    item.servings = servings;
    const byId = item.food_id != null ? foods.find((f) => f.id === Number(item.food_id)) : undefined;
    const lib = byId ?? matchFood(foods, String(item.name));
    if (lib) {
      item.food_id = lib.id;
      for (const n of NUTRIENTS) {
        const per = num(lib.nutrition[n]);
        if (per !== undefined) item[n] = round(per * servings, n === "calories" || n === "sodium_mg" ? 0 : 1);
      }
      item.verified = lib.verified;
    } else {
      delete item.food_id;
      item.verified = false;
    }
    for (const n of NUTRIENTS) { const v = num(item[n]); if (v === undefined) delete item[n]; else item[n] = v; }
    return item;
  });
  data.items = out;
  for (const n of NUTRIENTS) {
    const vals = out.map((i) => num(i[n])).filter((v): v is number => v !== undefined);
    if (vals.length) data[n] = round(vals.reduce((a, b) => a + b, 0), n === "calories" || n === "sodium_mg" ? 0 : 1);
    else delete data[n];
  }
  data.estimated = !out.every((i) => i.verified);
  return data;
}

function minutesOf(t: unknown): number | undefined {
  if (typeof t !== "string") return undefined;
  try { const [h, m] = parseTime(t).split(":").map(Number); return h * 60 + m; } catch { return undefined; }
}

function shapeSleep(data: Data): Data {
  if (typeof data.bedtime === "string") { try { data.bedtime = parseTime(data.bedtime); } catch { /* keep as said */ } }
  if (typeof data.wake === "string") { try { data.wake = parseTime(data.wake); } catch { /* keep */ } }
  const bed = minutesOf(data.bedtime), wake = minutesOf(data.wake);
  if (num(data.hours) === undefined && bed !== undefined && wake !== undefined) {
    data.hours = round(((wake - bed + 1440) % 1440) / 60, 2);
  }
  const hours = num(data.hours); if (hours !== undefined) data.hours = round(hours, 2);
  const rested = num(data.rested); if (rested !== undefined) data.rested = Math.min(10, Math.max(1, Math.round(rested)));
  return data;
}

function shapeData(kind: string, data: Data, foods: Food[]): Data {
  if (kind === "food") return shapeFood(data, foods);
  if (kind === "sleep") return shapeSleep(data);
  for (const [k, v] of Object.entries(data)) if (v === null || v === "") delete data[k];
  return data;
}

async function requireKind(db: D1Database, name: string): Promise<Kind> {
  const kind = await getKind(db, name);
  if (kind) return kind;
  const all = await listKinds(db);
  throw new UserError(
    `There's no "${name}" kind yet. Existing kinds: ${all.map((k) => k.name).join(", ")}. ` +
      `If this is something new worth tracking, call create_kind first, then log it.`,
  );
}

// ---------- writes ----------

export async function createEntry(db: D1Database, input: EntryInput, now = new Date()): Promise<Entry> {
  const kind = await requireKind(db, input.kind.trim());
  const summary = input.summary?.trim();
  if (!summary) throw new UserError("Each entry needs a short summary.");
  const data: Data = { ...(input.data ?? {}) };
  // Sleep without an explicit time: use the wake-up time.
  let time = input.time ?? null;
  if (kind.name === "sleep" && !time && typeof data.wake === "string") time = data.wake;
  const at = resolveWhen(input.date, time, now);
  const shaped = shapeData(kind.name, data, kind.name === "food" ? await listFoods(db) : []);
  const row = await db
    .prepare(
      `INSERT INTO entries (day, at, kind, emoji, summary, said, data, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
    )
    .bind(dayFor(at, kind.name), at.toISOString(), kind.name, input.emoji?.trim() || null, summary,
      input.said?.trim() || null, JSON.stringify(shaped), input.source)
    .first();
  return rowToEntry(row!);
}

export async function updateEntry(db: D1Database, id: number, patch: EntryPatch, now = new Date()): Promise<Entry> {
  const cur = await getEntry(db, id);
  if (!cur) throw new UserError(`No entry #${id}.`);
  const kindName = patch.kind?.trim() || cur.kind;
  if (kindName !== cur.kind) await requireKind(db, kindName);
  let at = new Date(cur.at);
  if (patch.date || patch.time) {
    const date = patch.date ? parseDay(patch.date, now) : nyDate(at);
    const time = patch.time ? parseTime(patch.time) : hhmm(cur.at);
    at = nyToInstant(date, time);
  }
  let data: Data = cur.data;
  if (patch.data) data = patch.replace_data ? { ...patch.data } : { ...cur.data, ...patch.data };
  data = shapeData(kindName, data, kindName === "food" ? await listFoods(db) : []);
  const summary = patch.summary?.trim() || cur.summary;
  const said = patch.said === undefined ? cur.said : patch.said?.trim() || null;
  const emoji = patch.emoji === undefined ? cur.emoji : patch.emoji?.trim() || null;
  const row = await db
    .prepare(
      `UPDATE entries SET day = ?, at = ?, kind = ?, emoji = ?, summary = ?, said = ?, data = ?,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ? RETURNING *`,
    )
    .bind(dayFor(at, kindName), at.toISOString(), kindName, emoji, summary, said, JSON.stringify(data), id)
    .first();
  return rowToEntry(row!);
}

export async function deleteEntry(db: D1Database, id: number): Promise<Entry> {
  const cur = await getEntry(db, id);
  if (!cur) throw new UserError(`No entry #${id}.`);
  await db.prepare("UPDATE entries SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").bind(id).run();
  return cur;
}

const KIND_NAME_RE = /^[a-z][a-z0-9_]{1,30}$/;

export async function upsertKind(
  db: D1Database,
  k: { name: string; label: string; emoji?: string; description?: string; fields?: FieldDef[]; tiles?: TileDef[] },
): Promise<{ kind: Kind; created: boolean }> {
  const name = k.name.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!KIND_NAME_RE.test(name)) throw new UserError(`Kind names are short snake_case words, like "coffee" or "music_practice".`);
  const existing = await getKind(db, name);
  const fields = (k.fields ?? existing?.fields ?? []).filter((f) => f && f.key);
  const tiles = (k.tiles ?? existing?.tiles ?? []).filter((t) => t && t.field);
  await db
    .prepare(
      `INSERT INTO kinds (name, label, emoji, description, fields, tiles, sort) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET label = excluded.label, emoji = excluded.emoji,
         description = excluded.description, fields = excluded.fields, tiles = excluded.tiles`,
    )
    .bind(name, k.label.trim(), k.emoji?.trim() || existing?.emoji || "•", k.description?.trim() ?? existing?.description ?? "",
      JSON.stringify(fields), JSON.stringify(tiles), existing?.sort ?? 50)
    .run();
  return { kind: (await getKind(db, name))!, created: !existing };
}

/** Save a food to the library and re-apply it to every past food entry that used it. */
export async function saveFood(
  db: D1Database,
  f: { name: string; aliases?: string[]; serving?: string; nutrition: Record<string, number>; verified: boolean; notes?: string | null },
): Promise<{ food: Food; updatedEntries: number }> {
  const name = f.name.trim();
  if (!name) throw new UserError("A food needs a name.");
  const nutrition: Record<string, number> = {};
  for (const n of NUTRIENTS) { const v = num(f.nutrition?.[n]); if (v !== undefined) nutrition[n] = v; }
  const existing = (await listFoods(db)).find((x) => x.name.toLowerCase() === name.toLowerCase());
  const aliases = [...new Set([...(existing?.aliases ?? []), ...(f.aliases ?? [])].map((a) => a.trim()).filter(Boolean))];
  await db
    .prepare(
      `INSERT INTO foods (name, aliases, serving, nutrition, verified, notes) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET aliases = excluded.aliases, serving = excluded.serving,
         nutrition = excluded.nutrition, verified = excluded.verified, notes = excluded.notes,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    )
    .bind(name, JSON.stringify(aliases), f.serving?.trim() || existing?.serving || "1 serving", JSON.stringify(nutrition),
      f.verified ? 1 : 0, f.notes ?? existing?.notes ?? null)
    .run();
  const foods = await listFoods(db);
  const food = foods.find((x) => x.name.toLowerCase() === name.toLowerCase())!;

  // Backfill: re-shape every food entry with an item that matches this food.
  const { results } = await db.prepare("SELECT * FROM entries WHERE kind = 'food' AND deleted_at IS NULL").all();
  const names = new Set([food.name, ...food.aliases].map((s) => s.toLowerCase()));
  const updates: D1PreparedStatement[] = [];
  for (const r of results.map(rowToEntry)) {
    const items = Array.isArray(r.data.items) ? (r.data.items as Data[]) : [];
    if (!items.some((i) => Number(i.food_id) === food.id || names.has(String(i.name ?? "").trim().toLowerCase()))) continue;
    const shaped = shapeFood({ ...r.data }, foods);
    updates.push(
      db.prepare("UPDATE entries SET data = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?")
        .bind(JSON.stringify(shaped), r.id),
    );
  }
  if (updates.length) await db.batch(updates);
  return { food, updatedEntries: updates.length };
}

// ---------- reading & summaries ----------

export function tileValue(entries: Entry[], tile: TileDef): number | undefined {
  const vals = entries.map((e) => num(e.data[tile.field])).filter((v): v is number => v !== undefined);
  if (tile.agg === "count") return entries.length || undefined;
  if (!vals.length) return undefined;
  switch (tile.agg) {
    case "sum": return vals.reduce((a, b) => a + b, 0);
    case "avg": return vals.reduce((a, b) => a + b, 0) / vals.length;
    case "max": return Math.max(...vals);
    default: return vals[vals.length - 1];
  }
}

export function fmtTile(v: number, tile: TileDef): string {
  switch (tile.format) {
    case "hours": { const h = Math.floor(v), m = Math.round((v - h) * 60); return m ? `${h}h ${m}m` : `${h}h`; }
    case "rating10": return `${round(v, 1)}/10`;
    case "approx": return `~${Math.round(v).toLocaleString("en-US")}${tile.unit ? " " + tile.unit : " cal"}`;
    case "minutes": return `${Math.round(v)} min`;
    default: return `${round(v, 1).toLocaleString("en-US")}${tile.unit ? " " + tile.unit : ""}`;
  }
}

export function daySummary(entries: Entry[], kinds: Kind[]): string {
  const parts: string[] = [];
  for (const k of kinds) {
    const mine = entries.filter((e) => e.kind === k.name);
    if (!mine.length) continue;
    for (const t of k.tiles) {
      const v = tileValue(mine, t);
      if (v !== undefined) parts.push(`${t.label} ${fmtTile(v, t)}`);
    }
  }
  return parts.join(" · ");
}

/** One entry as a line Claude can read. */
export function entryLine(e: Entry, kinds: Kind[]): string {
  const k = kinds.find((x) => x.name === e.kind);
  const d = { ...e.data };
  const extras: string[] = [];
  if (e.kind === "food") {
    const c = num(d.calories), p = num(d.protein_g);
    if (c !== undefined) extras.push(`~${c} cal`);
    if (p !== undefined) extras.push(`${p} g protein`);
  }
  const json = JSON.stringify(d);
  return `#${e.id} ${fmtClock(e.at)} ${e.emoji || k?.emoji || ""} [${e.kind}] ${e.summary}` +
    (extras.length ? ` (${extras.join(", ")})` : "") +
    (e.said ? ` | said: "${e.said}"` : "") +
    (json !== "{}" ? ` | data: ${json}` : "");
}
