// RSVP form: parsing/validation, spam checks, storage and e-mails.
// Used by src/pages/rsvp.astro (which handles both the form and its submission).
import {
	CONTACT_EMAIL,
	PARTNER_ONE,
	PARTNER_TWO,
	RSVP_DEADLINE,
	RSVP_DEADLINE_LABEL,
	RSVP_MAX_PERSONS,
	WEDDING_DATE,
	WEDDING_DATE_LABEL,
	WEDDING_END,
	WEDDING_VENUE,
	WEDDING_VENUE_ADDRESS,
} from '../consts';

export const LIMITS = {
	naam: 100,
	email: 254,
	dieet: 200,
	dansnummer: 200,
	bericht: 1000,
} as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type Aanwezig = '' | 'ja' | 'nee';
export type Person = { naam: string; dieet: string };

export type RsvpValues = {
	naam: string;
	email: string;
	aanwezig: Aanwezig;
	/** Always RSVP_MAX_PERSONS entries; entry 0 is the person filling in the form (name = `naam`). */
	personen: Person[];
	dansnummer: string;
	bericht: string;
};

/** Field name → error message (field names match the form's input names). */
export type FieldErrors = Record<string, string>;

/** What the success screen shows after the redirect (kept in a short-lived cookie). */
export type RsvpSummary = {
	naam: string;
	aanwezig: 'ja' | 'nee';
	personen: Person[];
	updated: boolean;
	/** Link back to the pre-filled form (path + query). */
	editPath?: string;
};

export const personField = (index: number, field: 'naam' | 'dieet') => `persoon_${index + 1}_${field}`;

export function emptyValues(): RsvpValues {
	return {
		naam: '',
		email: '',
		aanwezig: '',
		personen: Array.from({ length: RSVP_MAX_PERSONS }, () => ({ naam: '', dieet: '' })),
		dansnummer: '',
		bericht: '',
	};
}

export const isClosed = (now = new Date()) => now.getTime() > RSVP_DEADLINE.getTime();

const text = (form: FormData, key: string, max: number) =>
	String(form.get(key) ?? '')
		.trim()
		.slice(0, max);

export function parseForm(form: FormData): { values: RsvpValues; errors: FieldErrors } {
	const aanwezigRaw = text(form, 'aanwezig', 3);
	const values: RsvpValues = {
		naam: text(form, 'naam', LIMITS.naam),
		email: text(form, 'email', LIMITS.email).toLowerCase(),
		aanwezig: aanwezigRaw === 'ja' || aanwezigRaw === 'nee' ? aanwezigRaw : '',
		personen: Array.from({ length: RSVP_MAX_PERSONS }, (_, i) => ({
			naam: i === 0 ? '' : text(form, personField(i, 'naam'), LIMITS.naam),
			dieet: text(form, personField(i, 'dieet'), LIMITS.dieet),
		})),
		dansnummer: text(form, 'dansnummer', LIMITS.dansnummer),
		bericht: text(form, 'bericht', LIMITS.bericht),
	};
	values.personen[0].naam = values.naam;

	const errors: FieldErrors = {};
	if (!values.naam) errors.naam = 'Vul je naam in.';
	if (!values.email) errors.email = 'Vul je e-mailadres in.';
	else if (!EMAIL_RE.test(values.email)) errors.email = 'Vul een geldig e-mailadres in.';
	if (!values.aanwezig) errors.aanwezig = 'Laat ons weten of je erbij bent.';
	if (values.aanwezig === 'ja') {
		values.personen.forEach((person, i) => {
			if (i > 0 && !person.naam && person.dieet) {
				errors[personField(i, 'naam')] = 'Vul ook de naam van deze persoon in.';
			}
		});
	}
	return { values, errors };
}

/** The people who are actually coming (empty when the answer is "nee"). */
export function attendees(values: RsvpValues): Person[] {
	if (values.aanwezig !== 'ja') return [];
	return values.personen.filter((person, i) => i === 0 || person.naam);
}

export function isSameOrigin(request: Request): boolean {
	const siteOrigin = new URL(request.url).origin;
	const origin = request.headers.get('origin');
	const referer = request.headers.get('referer');
	if (origin) return origin === siteOrigin;
	if (referer) {
		try {
			return new URL(referer).origin === siteOrigin;
		} catch {
			return false;
		}
	}
	// Neither header present (some privacy tools strip both): allow; Turnstile still applies.
	return true;
}

export async function verifyTurnstile(secretKey: string | undefined, token: string, remoteIp: string | null) {
	if (!secretKey) {
		console.error('RSVP: TURNSTILE_SECRET_KEY is not configured');
		return false;
	}
	if (!token) return false;

	const body = new URLSearchParams({ secret: secretKey, response: token });
	if (remoteIp) body.set('remoteip', remoteIp);
	const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body,
	});
	if (!response.ok) {
		console.error(`RSVP: Turnstile siteverify returned HTTP ${response.status}`);
		return false;
	}
	const result = await response.json<{ success: boolean; 'error-codes'?: string[] }>();
	if (!result.success) {
		console.warn(`RSVP: Turnstile verification failed: ${JSON.stringify(result['error-codes'] ?? [])}`);
	}
	return result.success;
}

// --- Edit links ---------------------------------------------------------------
// Each RSVP gets a random, unguessable token. The confirmation e-mail links to
// /rsvp?edit=<token>, which fills the form with that RSVP so the guest can change it.

const EDIT_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

function newEditToken(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const editUrl = (origin: string, token: string) => `${origin}/rsvp?edit=${token}`;

/** The stored RSVP for an edit token, as form values; null when the token is unknown. */
export async function loadRsvp(db: D1Database, token: string): Promise<RsvpValues | null> {
	if (!EDIT_TOKEN_RE.test(token)) return null;
	const row = await db
		.prepare('SELECT naam, email, aanwezig, personen, dansnummer, bericht FROM rsvps WHERE edit_token = ?')
		.bind(token)
		.first<{
			naam: string;
			email: string | null;
			aanwezig: string;
			personen: string | null;
			dansnummer: string | null;
			bericht: string | null;
		}>();
	if (!row) return null;

	const values = emptyValues();
	values.naam = row.naam;
	values.email = row.email ?? '';
	values.aanwezig = row.aanwezig === 'ja' || row.aanwezig === 'nee' ? row.aanwezig : '';
	values.dansnummer = row.dansnummer ?? '';
	values.bericht = row.bericht ?? '';
	let stored: Person[] = [];
	try {
		stored = row.personen ? (JSON.parse(row.personen) as Person[]) : [];
	} catch {
		stored = [];
	}
	stored.slice(0, RSVP_MAX_PERSONS).forEach((person, i) => {
		values.personen[i] = { naam: String(person.naam ?? ''), dieet: String(person.dieet ?? '') };
	});
	values.personen[0].naam = values.naam;
	return values;
}

/** Insert or update the RSVP for this e-mail address. Returns the RSVP's edit token. */
export async function saveRsvp(db: D1Database, values: RsvpValues): Promise<{ updated: boolean; token: string }> {
	const people = attendees(values);
	const dietSummary = people
		.filter((person) => person.dieet)
		.map((person) => `${person.naam}: ${person.dieet}`)
		.join('; ');

	const existing = await db.prepare('SELECT id FROM rsvps WHERE email = ?').bind(values.email).first();
	// An existing RSVP keeps its token (so links in earlier e-mails keep working); rows saved
	// before edit links existed get one now.
	const saved = await db
		.prepare(
			`INSERT INTO rsvps (naam, email, aanwezig, aantal_gasten, personen, dieetwensen, dansnummer, bericht, edit_token)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT(email) DO UPDATE SET
				edit_token = COALESCE(rsvps.edit_token, excluded.edit_token),
				naam = excluded.naam,
				aanwezig = excluded.aanwezig,
				aantal_gasten = excluded.aantal_gasten,
				personen = excluded.personen,
				dieetwensen = excluded.dieetwensen,
				dansnummer = excluded.dansnummer,
				bericht = excluded.bericht,
				updated_at = datetime('now')
			 RETURNING edit_token`,
		)
		.bind(
			values.naam,
			values.email,
			values.aanwezig,
			people.length,
			JSON.stringify(people),
			dietSummary || null,
			values.aanwezig === 'ja' ? values.dansnummer || null : null,
			values.bericht || null,
			newEditToken(),
		)
		.first<{ edit_token: string }>();
	if (!saved) throw new Error('RSVP upsert returned no row');
	return { updated: existing !== null, token: saved.edit_token };
}

// --- E-mail ---------------------------------------------------------------

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);

type Email = { subject: string; html: string; text: string };

/** A block of e-mail content: a paragraph, a list of items, or a link. */
type Block = string | string[] | { href: string; label: string };

function renderEmail(subject: string, blocks: Block[]): Email {
	const html = blocks
		.map((block) => {
			if (Array.isArray(block)) return `<ul>${block.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
			if (typeof block === 'object') return `<p><a href="${escapeHtml(block.href)}">${escapeHtml(block.label)}</a></p>`;
			return `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`;
		})
		.join('\n');
	const text = blocks
		.map((block) => {
			if (Array.isArray(block)) return block.map((item) => `- ${item}`).join('\n');
			if (typeof block === 'object') return `${block.label}: ${block.href}`;
			return block;
		})
		.join('\n\n');
	return { subject, html, text };
}

const couple = `${PARTNER_ONE} & ${PARTNER_TWO}`;
const venue = WEDDING_VENUE_ADDRESS ? `${WEDDING_VENUE} (${WEDDING_VENUE_ADDRESS})` : WEDDING_VENUE;
const personLine = (person: Person) => (person.dieet ? `${person.naam} (${person.dieet})` : person.naam);

export function guestEmail(values: RsvpValues, updated: boolean, origin: string, token: string): Email {
	const people = attendees(values);
	const blocks: Block[] = [`Beste ${values.naam},`];

	if (values.aanwezig === 'ja') {
		const who =
			people.length === 1
				? 'dat je erbij bent'
				: `dat jullie er met ${people.length} personen bij zijn`;
		blocks.push(
			`${updated ? 'We hebben je antwoord bijgewerkt.' : 'Bedankt voor je RSVP!'} We hebben genoteerd ${who} op ${WEDDING_DATE_LABEL} in ${venue}.`,
			'Wie komt er:',
			people.map(personLine),
		);
		if (values.dansnummer) blocks.push(`Jouw dansnummer: ${values.dansnummer}`);
		blocks.push(
			`In de bijlage vind je een uitnodiging voor je agenda. Het volledige programma staat op ${origin}/programma.`,
		);
	} else {
		blocks.push(
			`${updated ? 'We hebben je antwoord bijgewerkt: ' : 'Bedankt om het ons te laten weten: '}je kan er helaas niet bij zijn op ${WEDDING_DATE_LABEL}. Jammer, maar we begrijpen het!`,
		);
	}

	blocks.push(
		`Wil je iets wijzigen? Pas je antwoord aan via je persoonlijke link, ten laatste op ${RSVP_DEADLINE_LABEL}.`,
		{ href: editUrl(origin, token), label: 'Mijn antwoord aanpassen' },
		'Deel deze link niet: iedereen die hem heeft, kan je antwoord bekijken en wijzigen.',
	);
	if (updated) {
		blocks.push(`Heb je deze wijziging niet zelf gedaan? Laat het ons dan weten via ${CONTACT_EMAIL}.`);
	}
	blocks.push(values.aanwezig === 'ja' ? `Tot dan!\n${couple}` : couple);

	return renderEmail(updated ? 'Je RSVP is bijgewerkt' : 'Bevestiging van je RSVP', blocks);
}

export function notificationEmail(values: RsvpValues, updated: boolean, origin: string): Email {
	const people = attendees(values);
	const answer =
		values.aanwezig === 'ja' ? `ja, ${people.length} ${people.length === 1 ? 'persoon' : 'personen'}` : 'nee';
	const blocks: Block[] = [
		`${updated ? 'Gewijzigde' : 'Nieuwe'} RSVP van ${values.naam} (${values.email}): ${answer}.`,
	];
	if (people.length) blocks.push('Personen:', people.map(personLine));
	if (values.aanwezig === 'ja' && values.dansnummer) blocks.push(`Dansnummer: ${values.dansnummer}`);
	if (values.bericht) blocks.push(`Bericht:\n${values.bericht}`);
	blocks.push(`Overzicht van alle antwoorden: ${origin}/admin/rsvps`);
	return renderEmail(`RSVP${updated ? ' (gewijzigd)' : ''}: ${values.naam} — ${answer}`, blocks);
}

// --- Calendar invite --------------------------------------------------------

const icsDate = (date: Date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const icsText = (value: string) => value.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
// Lines longer than 75 octets must be folded (RFC 5545); continuation lines start with a space.
const icsFold = (line: string) => line.match(/.{1,73}/g)!.join('\r\n ');

export function calendarInvite(origin: string): string {
	const host = new URL(origin).hostname;
	return [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		`PRODID:-//${icsText(couple)}//Trouw//NL`,
		'CALSCALE:GREGORIAN',
		'METHOD:PUBLISH',
		'BEGIN:VEVENT',
		`UID:trouw-${icsDate(WEDDING_DATE)}@${host}`,
		`DTSTAMP:${icsDate(new Date())}`,
		`DTSTART:${icsDate(WEDDING_DATE)}`,
		`DTEND:${icsDate(WEDDING_END)}`,
		`SUMMARY:${icsText(`Trouw ${couple}`)}`,
		`LOCATION:${icsText(WEDDING_VENUE_ADDRESS ? `${WEDDING_VENUE}, ${WEDDING_VENUE_ADDRESS}` : WEDDING_VENUE)}`,
		`DESCRIPTION:${icsText(`Het volledige programma: ${origin}/programma`)}`,
		`URL:${origin}/programma`,
		'END:VEVENT',
		'END:VCALENDAR',
	]
		.map(icsFold)
		.join('\r\n');
}

const toBase64 = (value: string) => {
	let binary = '';
	for (const byte of new TextEncoder().encode(value)) binary += String.fromCharCode(byte);
	return btoa(binary);
};

type SendOptions = {
	to: string;
	replyTo?: string;
	attachments?: { filename: string; content: string; contentType: string }[];
};

async function sendEmail(apiKey: string, email: Email, options: SendOptions) {
	const response = await fetch('https://api.resend.com/emails', {
		method: 'POST',
		headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({
			from: `${couple} <${CONTACT_EMAIL}>`,
			to: options.to,
			reply_to: options.replyTo ?? CONTACT_EMAIL,
			subject: email.subject,
			html: email.html,
			text: email.text,
			attachments: options.attachments?.map((file) => ({
				filename: file.filename,
				content: toBase64(file.content),
				content_type: file.contentType,
			})),
		}),
	});
	if (!response.ok) throw new Error(`Resend API returned HTTP ${response.status}`);
}

/** Send the confirmation to the guest and a notification to the couple. Never throws. */
export async function sendRsvpEmails(
	apiKey: string | undefined,
	notifyTo: string,
	values: RsvpValues,
	updated: boolean,
	origin: string,
	token: string,
) {
	if (!apiKey) {
		console.error('RSVP: RESEND_API_KEY is not configured, skipping e-mails');
		return;
	}
	const results = await Promise.allSettled([
		sendEmail(apiKey, guestEmail(values, updated, origin, token), {
			to: values.email,
			attachments:
				values.aanwezig === 'ja'
					? [{ filename: 'trouw.ics', content: calendarInvite(origin), contentType: 'text/calendar' }]
					: undefined,
		}),
		sendEmail(apiKey, notificationEmail(values, updated, origin), { to: notifyTo, replyTo: values.email }),
	]);
	results.forEach((result, i) => {
		if (result.status === 'rejected') {
			console.error(`RSVP: failed to send ${i === 0 ? 'guest confirmation' : 'notification'} e-mail:`, String(result.reason));
		}
	});
}
