-- Voice-mode spike: a single table of test notes.
CREATE TABLE IF NOT EXISTS test_notes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  text       TEXT    NOT NULL,
  source     TEXT    NOT NULL DEFAULT 'claude'
);
