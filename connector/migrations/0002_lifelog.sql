-- LifeLog v1: entries of any kind, the kinds themselves (Claude can add more), and a food library.

CREATE TABLE IF NOT EXISTS kinds (
  name        TEXT PRIMARY KEY,                 -- snake_case id, e.g. 'food'
  label       TEXT NOT NULL,                    -- 'Food & drink'
  emoji       TEXT NOT NULL DEFAULT '•',
  description TEXT NOT NULL DEFAULT '',         -- when to use it (shown to Claude)
  fields      TEXT NOT NULL DEFAULT '[]',       -- JSON [{key,label,type,unit?,hint?}]
  tiles       TEXT NOT NULL DEFAULT '[]',       -- JSON [{label,field,agg,format?,unit?}]
  sort        INTEGER NOT NULL DEFAULT 100,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS entries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  day         TEXT NOT NULL,                    -- YYYY-MM-DD, America/New_York, day ends at 4 a.m.
  at          TEXT NOT NULL,                    -- ISO UTC: when it happened
  kind        TEXT NOT NULL,
  emoji       TEXT,                             -- per-entry override (🍳), else the kind's
  summary     TEXT NOT NULL,                    -- short display line
  said        TEXT,                             -- Phil's own words
  data        TEXT NOT NULL DEFAULT '{}',       -- JSON, shape depends on kind
  source      TEXT NOT NULL DEFAULT 'voice',    -- 'voice' (Claude) or 'site'
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at  TEXT
);
CREATE INDEX IF NOT EXISTS entries_day ON entries (day, at);
CREATE INDEX IF NOT EXISTS entries_kind ON entries (kind, day);

CREATE TABLE IF NOT EXISTS foods (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  aliases     TEXT NOT NULL DEFAULT '[]',       -- JSON ["my oatmeal", ...]
  serving     TEXT NOT NULL DEFAULT '1 serving',
  nutrition   TEXT NOT NULL DEFAULT '{}',       -- JSON per serving {calories, protein_g, ...}
  verified    INTEGER NOT NULL DEFAULT 0,       -- 1 = real nutrition facts, 0 = estimate
  notes       TEXT,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT OR IGNORE INTO kinds (name, label, emoji, description, fields, tiles, sort) VALUES
('sleep', 'Sleep', '😴',
 'A night''s sleep (or a nap). Log it when Phil says how he slept. The entry time is when he woke up.',
 '[{"key":"bedtime","label":"Bedtime","type":"time"},{"key":"wake","label":"Woke up","type":"time"},{"key":"hours","label":"Hours","type":"number","unit":"h"},{"key":"rested","label":"Rested","type":"rating10","hint":"1-10, how rested he feels"}]',
 '[{"label":"Sleep","field":"hours","agg":"last","format":"hours"},{"label":"Rested","field":"rested","agg":"last","format":"rating10"}]',
 10),
('food', 'Food & drink', '🍽️',
 'Anything Phil ate or drank, including coffee and alcohol. Break it into items with servings and estimated nutrition.',
 '[{"key":"meal","label":"Meal","type":"text","hint":"breakfast, lunch, dinner, snack or drink"},{"key":"items","label":"Items","type":"items"}]',
 '[{"label":"Food","field":"calories","agg":"sum","format":"approx"}]',
 20),
('exercise', 'Exercise', '🏃',
 'Any workout or movement: runs, walks, lifting, sports, yoga.',
 '[{"key":"activity","label":"Activity","type":"text"},{"key":"minutes","label":"Minutes","type":"number","unit":"min"},{"key":"distance_mi","label":"Distance","type":"number","unit":"mi"}]',
 '[{"label":"Moved","field":"minutes","agg":"sum","format":"minutes"}]',
 30),
('note', 'Note', '📝',
 'Anything else about Phil''s day that does not fit another kind: what he did, who he saw, thoughts.',
 '[]',
 '[]',
 90);
