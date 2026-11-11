# LifeLog

A voice-first log of my days. I talk to Claude (voice mode in the Claude app). A custom connector saves what I say: food, sleep, how rested I feel, exercise, notes, and any new kind of thing Claude starts tracking. This dashboard shows it all.

- **Dashboard:** https://philforrence.github.io/lifelog/ (Google sign-in, only my account)
- **Connector + API:** a Cloudflare Worker with D1, in `connector/`

## Layout

| Path | What |
|---|---|
| `docs/` | The dashboard (static, served by GitHub Pages) |
| `connector/src/mcp.ts` | Claude's tools: `log`, `get_log`, `update_entry`, `delete_entry`, `create_kind`, `save_food` |
| `connector/src/api.ts` | Dashboard API: Google sign-in → session, read/edit/export |
| `connector/src/db.ts` | Shared logic: days end at 4 a.m. (New York), the food library, daily tiles |
| `connector/migrations/` | D1 schema |
| `plans/` | Decisions |

## Deploy

```bash
cd connector
npx wrangler d1 migrations apply lifelog --remote
npx wrangler deploy --secrets-file .secrets/secrets.json   # MCP_TOKEN, SESSION_SECRET, ALLOWED_EMAILS
```

The Claude connector URL is `https://lifelog.philforrence.workers.dev/mcp/<MCP_TOKEN>`. Treat it like a password.

## Local

The `lifelog-api` and `lifelog-site` entries in `Projects/.claude/launch.json` run `wrangler dev` on port 8787 (with a local D1 and its own session secret) and the site on port 8080. On localhost the page signs in with a dev session minted for the local Worker only.
