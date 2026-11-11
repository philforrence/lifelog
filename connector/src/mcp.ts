// Claude's side of LifeLog: the MCP tools the Claude app (voice mode included) calls.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  UserError, addDays, createEntry, daySummary, deleteEntry, entryLine, fmtDay, listEntries, listFoods, listKinds,
  nowLine, parseDay, saveFood, today, updateEntry, upsertKind, type Entry, type Food, type Kind,
} from "./db";

type Env = { DB: D1Database };

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const fail = (t: string) => ({ content: [{ type: "text" as const, text: t }], isError: true });

async function guard<T>(fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof UserError) return fail(e.message);
    console.error(e);
    return fail(`LifeLog hit an error: ${(e as Error).message}`);
  }
}

function kindsBlock(kinds: Kind[]): string {
  return kinds
    .map((k) => {
      const fields = k.fields
        .map((f) =>
          f.type === "items"
            ? `items: [{name, servings, calories, protein_g, carbs_g?, fat_g?}]`
            : `${f.key}${f.type === "rating10" ? " (1-10)" : f.type === "time" ? " (HH:MM)" : ""}${f.unit ? ` (${f.unit})` : ""}`,
        )
        .join(", ");
      return `- ${k.name} ${k.emoji} ${k.label}: ${k.description}${fields ? ` Data: ${fields}.` : ""}`;
    })
    .join("\n");
}

function foodsBlock(foods: Food[]): string {
  if (!foods.length) return "Phil's food library is empty so far.";
  const shown = foods.slice(0, 120);
  return (
    "Phil's food library (use these exact names in items, with servings in the stated serving size; " +
    "the library's numbers replace yours automatically):\n" +
    shown
      .map((f) => {
        const n = f.nutrition;
        const facts = [n.calories !== undefined ? `${n.calories} cal` : "", n.protein_g !== undefined ? `${n.protein_g} g protein` : ""]
          .filter(Boolean).join(", ");
        return `- ${f.name}${f.aliases.length ? ` (aka ${f.aliases.join(", ")})` : ""}: per ${f.serving}${facts ? `, ${facts}` : ""}${f.verified ? " ✓ verified" : " (estimate)"}`;
      })
      .join("\n") +
    (foods.length > shown.length ? `\n…and ${foods.length - shown.length} more.` : "")
  );
}

function instructions(kinds: Kind[]): string {
  return [
    "LifeLog is Phil's voice-first diary: food, sleep, how rested he feels, exercise, and free-form notes about his life.",
    `Right now it is ${nowLine()}`,
    "",
    "Your role is a scribe:",
    "- Whenever Phil mentions something he ate, drank, did, how he slept or feels, or asks you to note something, log it right away with `log`. Don't ask permission; don't log hypotheticals or plans.",
    "- Confirm with one short sentence, like \"Logged: two eggs, toast, coffee.\" No numbers unless he asks, and no follow-up questions just to fill in fields.",
    "- No opinions, advice, judgments, or commentary on patterns. When he asks about his log, answer with facts only.",
    "- `said` = Phil's own words, verbatim as you heard them. `summary` = a short display line in his terms (\"2 eggs, toast, coffee\").",
    "- Food: split into items with servings, and estimate calories and protein (carbs and fat too when easy). Pick a fitting emoji (🍳, 🥪, 🍝, ☕).",
    "- Sleep: one `sleep` entry with bedtime, wake and rested (1-10) when he says them. Its time is when he woke up.",
    "- Times: pass `time` as local 24-hour HH:MM when he says when something happened; leave it out for \"just now\". Pass `date` only if it wasn't today.",
    "- Corrections (\"actually it was three eggs\"): find the entry with `get_log`, fix it with `update_entry`, then read back the change in one sentence.",
    "- Something new he'd plausibly track again (coffee count, trumpet practice, mood): call `create_kind` on the spot without asking, then log it. One-offs go in `note`.",
    "- When Phil gives real nutrition facts for a food, call `save_food` with verified=true; it updates past entries too.",
    "",
    "Kinds right now:",
    kindsBlock(kinds),
  ].join("\n");
}

function logged(e: Entry, kinds: Kind[]): string {
  const when = e.day === today() ? "" : ` (${fmtDay(e.day)})`;
  return `${entryLine(e, kinds)}${when}`;
}

export async function buildMcpServer(env: Env): Promise<McpServer> {
  const [kinds, foods] = await Promise.all([listKinds(env.DB), listFoods(env.DB)]);
  const server = new McpServer(
    { name: "lifelog", title: "LifeLog", version: "1.0.0" },
    { instructions: instructions(kinds) },
  );

  const dataSchema = z.record(z.string(), z.any());

  server.registerTool(
    "log",
    {
      title: "Log to LifeLog",
      description:
        "Save one or more things to Phil's LifeLog (several at once is fine: \"eggs for breakfast, then a 3-mile run\"). " +
        "Use whenever Phil mentions food, drink, sleep, how he feels, exercise, or anything about his day.\n\n" +
        `Kinds:\n${kindsBlock(kinds)}\n\n${foodsBlock(foods)}`,
      inputSchema: {
        entries: z
          .array(
            z.object({
              kind: z.string().describe("One of the kinds listed above"),
              summary: z.string().describe("Short display line, e.g. '2 eggs, toast, coffee'"),
              said: z.string().optional().describe("Phil's own words, verbatim"),
              emoji: z.string().optional().describe("One fitting emoji, e.g. 🍳"),
              time: z.string().optional().describe("Local 24-hour HH:MM when it happened; omit for just now"),
              date: z.string().optional().describe("YYYY-MM-DD or 'yesterday'; omit for today"),
              data: dataSchema.optional().describe("Kind-specific fields listed above"),
            }),
          )
          .min(1)
          .max(20),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ entries }) =>
      guard(async () => {
        const out: string[] = [];
        for (const e of entries) out.push(logged(await createEntry(env.DB, { ...e, source: "voice" }), kinds));
        return text(`Logged ${out.length}:\n${out.join("\n")}\n\nConfirm to Phil in one short sentence.`);
      }),
  );

  server.registerTool(
    "get_log",
    {
      title: "Read LifeLog",
      description:
        "Read Phil's log: entries with their ids, plus daily totals (sleep, rested, food, exercise). Defaults to today. " +
        "Use for questions (\"what did I eat yesterday?\", \"how did I sleep this week?\") and to find an entry to fix.",
      inputSchema: {
        date: z.string().optional().describe("One day: YYYY-MM-DD, 'today' or 'yesterday'"),
        days: z.number().int().min(1).max(90).optional().describe("The last N days ending today (e.g. 7 for this week)"),
        from: z.string().optional().describe("Range start YYYY-MM-DD"),
        to: z.string().optional().describe("Range end YYYY-MM-DD"),
        kind: z.string().optional().describe("Only this kind"),
        query: z.string().optional().describe("Only entries mentioning this text"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) =>
      guard(async () => {
        const t = today();
        let from = t, to = t;
        if (args.date) from = to = parseDay(args.date);
        else if (args.days) { to = t; from = addDays(t, -(args.days - 1)); }
        if (args.from) from = parseDay(args.from);
        if (args.to) to = parseDay(args.to);
        if (args.query && !args.date && !args.days && !args.from) from = "2000-01-01";
        const entries = await listEntries(env.DB, { from, to, kind: args.kind, query: args.query, limit: 800 });
        if (!entries.length) return text(`Nothing logged ${from === to ? `on ${fmtDay(from)}` : `from ${fmtDay(from)} to ${fmtDay(to)}`}.`);
        const byDay = new Map<string, Entry[]>();
        for (const e of entries) byDay.set(e.day, [...(byDay.get(e.day) ?? []), e]);
        const blocks = [...byDay.entries()].map(([day, list]) => {
          const totals = daySummary(list, kinds);
          return `${fmtDay(day)}${day === t ? " (today)" : ""}${totals ? ` — ${totals}` : ""}\n${list.map((e) => "  " + entryLine(e, kinds)).join("\n")}`;
        });
        return text(blocks.join("\n\n"));
      }),
  );

  server.registerTool(
    "update_entry",
    {
      title: "Fix a LifeLog entry",
      description:
        "Change an entry by id (find ids with get_log). Only pass what changes. `data` merges into the existing data " +
        "unless replace_data is true; to change food items, pass the full new items list.",
      inputSchema: {
        id: z.number().int(),
        summary: z.string().optional(),
        said: z.string().optional(),
        emoji: z.string().optional(),
        kind: z.string().optional(),
        time: z.string().optional().describe("Local 24-hour HH:MM"),
        date: z.string().optional().describe("YYYY-MM-DD or 'yesterday'"),
        data: dataSchema.optional(),
        replace_data: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ id, ...patch }) =>
      guard(async () => text(`Updated: ${entryLine(await updateEntry(env.DB, id, patch), kinds)}\n\nRead back the change in one short sentence.`)),
  );

  server.registerTool(
    "delete_entry",
    {
      title: "Delete a LifeLog entry",
      description: "Remove an entry by id (when Phil says to delete or undo something, or it was logged by mistake).",
      inputSchema: { id: z.number().int() },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ id }) => guard(async () => text(`Deleted: ${entryLine(await deleteEntry(env.DB, id), kinds)}`)),
  );

  server.registerTool(
    "create_kind",
    {
      title: "Start tracking something new",
      description:
        "Create (or update) a kind of entry, e.g. coffee, music_practice, mood, weight. Do this on the spot, without asking, " +
        "when Phil starts talking about something he'd track again. The dashboard shows it automatically. " +
        "Tiles are optional daily totals shown at the top of each day.",
      inputSchema: {
        name: z.string().describe("snake_case id, e.g. music_practice"),
        label: z.string().describe("Display name, e.g. Music practice"),
        emoji: z.string().describe("One emoji, e.g. 🎺"),
        description: z.string().describe("When to use this kind"),
        fields: z
          .array(
            z.object({
              key: z.string().describe("snake_case, e.g. minutes"),
              label: z.string(),
              type: z.enum(["number", "text", "time", "rating10"]),
              unit: z.string().optional(),
            }),
          )
          .optional(),
        tiles: z
          .array(
            z.object({
              label: z.string().describe("Short, e.g. Practice"),
              field: z.string().describe("Which data field to total"),
              agg: z.enum(["sum", "last", "avg", "max", "count"]),
              format: z.enum(["number", "minutes", "hours", "rating10", "approx"]).optional(),
              unit: z.string().optional(),
            }),
          )
          .optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (args) =>
      guard(async () => {
        const { kind, created } = await upsertKind(env.DB, args);
        return text(`${created ? "Created" : "Updated"} kind "${kind.name}" ${kind.emoji} ${kind.label}. You can log to it now.`);
      }),
  );

  server.registerTool(
    "save_food",
    {
      title: "Save a food's nutrition",
      description:
        "Add or correct a food in Phil's food library, per serving. Use verified=true when Phil gives real nutrition facts " +
        "(from a label or a lookup he trusts). Every past entry with this food is recalculated.",
      inputSchema: {
        name: z.string().describe("The name Phil uses, e.g. 'oatmeal'"),
        aliases: z.array(z.string()).optional().describe("Other names, e.g. 'my usual oatmeal'"),
        serving: z.string().describe("What one serving is, e.g. '1 bowl (1/2 cup dry oats + milk)'"),
        nutrition: z.object({
          calories: z.number().optional(), protein_g: z.number().optional(), carbs_g: z.number().optional(),
          fat_g: z.number().optional(), fiber_g: z.number().optional(), sugar_g: z.number().optional(), sodium_mg: z.number().optional(),
        }),
        verified: z.boolean(),
        notes: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (args) =>
      guard(async () => {
        const { food, updatedEntries } = await saveFood(env.DB, args as Parameters<typeof saveFood>[1]);
        return text(
          `Saved ${food.name} (per ${food.serving}): ${JSON.stringify(food.nutrition)}${food.verified ? ", verified" : ", estimate"}. ` +
            `Updated ${updatedEntries} past ${updatedEntries === 1 ? "entry" : "entries"}.`,
        );
      }),
  );

  return server;
}
