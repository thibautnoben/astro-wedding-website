-- Adds a private edit token per RSVP, used for the "pas je antwoord aan" link in the confirmation e-mail.
-- Run once against the production database BEFORE deploying the code that uses it:
--   npx wrangler d1 execute kirsten-en-thibaut-rsvp --remote --file=migrations/0002_rsvp_edit_token.sql
ALTER TABLE rsvps ADD COLUMN edit_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_rsvps_edit_token ON rsvps(edit_token);
