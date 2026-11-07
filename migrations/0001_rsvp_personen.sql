-- Adds per-person names/diet wishes and an "updated" timestamp to existing RSVPs.
-- Run once against the production database BEFORE deploying the new RSVP form:
--   npx wrangler d1 execute kirsten-en-thibaut-rsvp --remote --file=migrations/0001_rsvp_personen.sql
ALTER TABLE rsvps ADD COLUMN personen TEXT;
ALTER TABLE rsvps ADD COLUMN updated_at TEXT;
