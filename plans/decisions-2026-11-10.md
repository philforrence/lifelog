# LifeLog — decisions (2026-11-10)

Working name: LifeLog (easy to change).

## What it is

A voice-first log of your life. Whenever something happens, you talk to Claude in the Claude app's voice mode. Claude saves it through a custom connector. A private dashboard on GitHub Pages shows everything.

## Your answers (from the grill)

| Topic | Decision |
|---|---|
| When you log | Whenever, all day: quick logs as things happen, with no set check-in |
| Claude's role | **Just a scribe.** It logs and confirms. No opinions, advice, or pattern commentary |
| Food detail | Extensible. Every entry keeps your exact words, and Claude adds rough calorie and protein estimates (fuller macros where it can). **Food library:** when you learn the real nutrition of a food you eat often ("my usual oatmeal"), Claude saves it as verified and recalculates past entries that used it |
| Trackers | None, so voice is the only input. Sleep and exercise come from what you say |
| Privacy | Only you, behind Google sign-in (same setup as Sixers Seats) |
| Main screen | **Today timeline.** Tiles on top (Sleep, Rested, Food, Moved), then entries in time order. Scroll back for earlier days |
| Scope | Health plus free-form notes about anything ("saw Andrew at the game") |
| Extra categories | We add them as we go |
| New categories | **Claude creates them on the spot.** The site gives a new category a basic view automatically, and we can design a proper one later |
| Voice confirmation | Short read-back: "Logged: two eggs, toast, coffee." |
| Website | Full editing: fix, delete, and add entries by typing |
| Never do | You picked "Something else" without the details. **Still open** |

## Calls I made (technical and defaults)

- **The bridge:** a small remote MCP server (custom connector) on Cloudflare Workers' free tier, with Cloudflare D1 (SQLite) for storage.
  - Voice mode → connector tools → D1.
  - Dashboard → the same Worker's API → D1. It only answers to your Google sign-in.
- **Connector sign-in (changed in the build):** the connector is locked by a long secret code in its address ("No sign-in" in Claude), not OAuth. It's what passed the voice test, and it's equally private as long as the address stays secret. OAuth through Google is a possible upgrade.
- **Dashboard sign-in:** Google sign-in reusing the Sixers Seats OAuth client, which already allows philforrence.github.io. The Worker checks the Google token and the email allowlist, then issues a 30-day LifeLog session.
- **Rested scale:** 1–10.
- **Day boundary:** a day runs until 4 a.m., so a 1 a.m. snack counts toward the day before. Sleep belongs to the day you wake up.
- **Timezone:** America/New_York. Times are whatever you say ("I had lunch around 12:30"); otherwise the time you logged it.
- **Asking back:** Claude can read the log aloud ("what did I eat yesterday?", "how much did I sleep this week?"). It answers with facts only, which fits the scribe role.
- **Voice corrections:** "Actually it was three eggs" edits the most recent matching entry and reads back the change.
- **Export:** a JSON/CSV download on the site. It's cheap to add, so your data is never stuck.
- **Data model:**
  - `entries`: id, timestamp, day, kind, your words, a flexible data field, and where it came from (voice or site).
  - `kinds`: name, icon, label, field hints, and how its tile adds up.
  - `foods`: name, aliases, nutrition per serving, and estimated vs. verified.
  - Seeded kinds are sleep (with rested 1–10), food, exercise, and note. Every other kind is created at runtime.
- **Connector tools (built):** `log`, `get_log`, `update_entry`, `delete_entry`, `create_kind`, `save_food`. The current kinds and food library are listed inside the `log` tool's description, so Claude doesn't need a separate lookup.

## Status (2026-11-10)

- The spike passed: a note saved through the connector arrived in D1. It hasn't been confirmed whether that note came from voice or typing.
- v1 is built and deployed: the Worker at lifelog.philforrence.workers.dev and the dashboard at philforrence.github.io/lifelog.

## Build order

1. **Spike: first, prove voice mode can write.**
   - A one-tool connector that saves a test note. You add it in the Claude app and try it in voice mode.
   - Why first: there was a July 2026 bug report of custom connector tools failing only in voice mode, and Anthropic's docs don't confirm voice support yet.
   - **If it fails:** fallback A is the same connector through the Claude app's dictation in text mode (it works, it's just not hands-free). Fallback B is a mic button on the dashboard that talks to Claude through the API, which needs an API key and costs a little per use.
2. Full connector and D1 schema, including the seeded kinds.
3. The Today-timeline dashboard with Google sign-in and editing.
4. Food library and backfill.

## Still needed from you

- **A free Cloudflare account.** You have to make it yourself; I can't create accounts. Then run `npx wrangler login` once.
- What "Something else" was on the "never do" question.
- A name, if you want something other than LifeLog.
