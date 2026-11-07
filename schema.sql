CREATE TABLE IF NOT EXISTS rsvps (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	naam TEXT NOT NULL,
	email TEXT,
	aanwezig TEXT NOT NULL,
	-- Number of people coming (0 when aanwezig = 'nee').
	aantal_gasten INTEGER NOT NULL DEFAULT 1,
	-- JSON array of { naam, dieet } for everyone who is coming.
	personen TEXT,
	-- Readable summary of diet wishes ("Naam: dieet; ...").
	dieetwensen TEXT,
	dansnummer TEXT,
	bericht TEXT,
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at TEXT,
	-- Random secret for the edit link in the confirmation e-mail (/rsvp?edit=<token>).
	edit_token TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rsvps_email ON rsvps(email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rsvps_edit_token ON rsvps(edit_token);
