CREATE TABLE IF NOT EXISTS rsvps (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	naam TEXT NOT NULL,
	email TEXT,
	aanwezig TEXT NOT NULL,
	aantal_gasten INTEGER NOT NULL DEFAULT 1,
	dieetwensen TEXT,
	dansnummer TEXT,
	bericht TEXT,
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rsvps_email ON rsvps(email);
