import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { CONTACT_EMAIL, PARTNER_ONE, PARTNER_TWO, WEDDING_DATE_LABEL, WEDDING_VENUE } from '../../consts';

export const prerender = false;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const HTML_ESCAPES: Record<string, string> = {
	'&': '&amp;',
	'<': '&lt;',
	'>': '&gt;',
	'"': '&quot;',
	"'": '&#39;',
};

function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

function isSameOrigin(request: Request): boolean {
	const siteOrigin = new URL(request.url).origin;
	const origin = request.headers.get('origin');
	const referer = request.headers.get('referer');

	let ok: boolean;
	if (origin) {
		ok = origin === siteOrigin;
	} else if (referer) {
		try {
			ok = new URL(referer).origin === siteOrigin;
		} catch {
			ok = false;
		}
	} else {
		// Neither header present (some privacy tools strip both) — allow rather than
		// block legitimate submissions; the honeypot/validation checks still apply.
		ok = true;
	}

	if (!ok) {
		console.error(
			`isSameOrigin rejected request: siteOrigin=${siteOrigin}, origin header=${origin}, referer header=${referer}`,
		);
	}

	return ok;
}

async function verifyTurnstile(secretKey: string, token: string, remoteIp: string | null): Promise<boolean> {
	if (!secretKey) {
		console.error('TURNSTILE_SECRET_KEY is not set (or the binding name does not match) — rejecting submission');
		return false;
	}

	if (!token) {
		console.error('No cf-turnstile-response token submitted — rejecting submission');
		return false;
	}

	const body = new URLSearchParams({ secret: secretKey, response: token });
	if (remoteIp) body.set('remoteip', remoteIp);

	const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body,
	});

	if (!response.ok) {
		console.error(`Turnstile siteverify HTTP error: ${response.status} ${await response.text()}`);
		return false;
	}

	const result = await response.json<{ success: boolean; 'error-codes'?: string[] }>();

	if (!result.success) {
		console.error(
			`Turnstile verification failed: ${JSON.stringify(result['error-codes'])} (secret key starting with "${secretKey.slice(0, 6)}…", length ${secretKey.length})`,
		);
	}

	return result.success;
}

async function sendConfirmationEmail(
	apiKey: string,
	to: string,
	details: { naam: string; aanwezig: string; aantalGasten: number },
) {
	const naam = escapeHtml(details.naam);
	const { aanwezig, aantalGasten } = details;

	const body =
		aanwezig === 'ja'
			? `<p>Beste ${naam},</p>
			   <p>Bedankt voor je RSVP! We hebben genoteerd dat je met ${aantalGasten} perso(o)n(en) aanwezig zal zijn op ${WEDDING_DATE_LABEL} in ${WEDDING_VENUE}.</p>
			   <p>Tot dan!</p>
			   <p>${PARTNER_ONE} & ${PARTNER_TWO}</p>`
			: `<p>Beste ${naam},</p>
			   <p>Bedankt om ons te laten weten dat je er helaas niet bij kan zijn op ${WEDDING_DATE_LABEL}. Jammer, maar we begrijpen het!</p>
			   <p>${PARTNER_ONE} & ${PARTNER_TWO}</p>`;

	const response = await fetch('https://api.resend.com/emails', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${apiKey}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			from: `${PARTNER_ONE} & ${PARTNER_TWO} <${CONTACT_EMAIL}>`,
			to,
			subject: 'Bevestiging van je RSVP',
			html: body,
		}),
	});

	if (!response.ok) {
		throw new Error(`Resend API error: ${response.status} ${await response.text()}`);
	}
}

export const POST: APIRoute = async ({ request, redirect, locals }) => {
	if (!isSameOrigin(request)) {
		return redirect('/rsvp?status=error');
	}

	const formData = await request.formData();

	// Honeypot: real visitors never see or fill this field (hidden off-screen).
	// A bot that fills in every field trips it — pretend success so it doesn't retry.
	if (String(formData.get('website') ?? '').trim()) {
		return redirect('/rsvp?status=success');
	}

	const turnstileToken = String(formData.get('cf-turnstile-response') ?? '');
	const turnstileOk = await verifyTurnstile(
		env.TURNSTILE_SECRET_KEY,
		turnstileToken,
		request.headers.get('CF-Connecting-IP'),
	);
	if (!turnstileOk) {
		return redirect('/rsvp?status=error');
	}

	const naam = String(formData.get('naam') ?? '').trim().slice(0, 100);
	const email = String(formData.get('email') ?? '').trim().toLowerCase().slice(0, 254);
	const aanwezig = String(formData.get('aanwezig') ?? '').trim();
	const aantalGasten = Math.min(Math.max(Number(formData.get('aantal_gasten') ?? 1) || 1, 1), 20);
	const dieetwensen = String(formData.get('dieetwensen') ?? '').trim().slice(0, 500);
	const dansnummer = String(formData.get('dansnummer') ?? '').trim().slice(0, 200);
	const bericht = String(formData.get('bericht') ?? '').trim().slice(0, 1000);

	if (!naam || !email || !EMAIL_RE.test(email) || (aanwezig !== 'ja' && aanwezig !== 'nee')) {
		console.error(`RSVP validation failed: naam=${JSON.stringify(naam)}, email=${JSON.stringify(email)}, aanwezig=${JSON.stringify(aanwezig)}`);
		return redirect('/rsvp?status=error');
	}

	try {
		await env.DB.prepare(
			`INSERT INTO rsvps (naam, email, aanwezig, aantal_gasten, dieetwensen, dansnummer, bericht)
			 VALUES (?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT(email) DO UPDATE SET
				naam = excluded.naam,
				aanwezig = excluded.aanwezig,
				aantal_gasten = excluded.aantal_gasten,
				dieetwensen = excluded.dieetwensen,
				dansnummer = excluded.dansnummer,
				bericht = excluded.bericht`,
		)
			.bind(naam, email, aanwezig, aantalGasten, dieetwensen || null, dansnummer || null, bericht || null)
			.run();
	} catch (error) {
		console.error('RSVP database insert failed', error);
		return redirect('/rsvp?status=error');
	}

	if (!env.RESEND_API_KEY) {
		console.error(
			'RESEND_API_KEY is not set (or the binding name does not match) — skipping confirmation email',
		);
	} else {
		console.log(
			`Sending RSVP confirmation email using key starting with "${env.RESEND_API_KEY.slice(0, 6)}…" (length ${env.RESEND_API_KEY.length})`,
		);
		locals.cfContext.waitUntil(
			sendConfirmationEmail(env.RESEND_API_KEY, email, { naam, aanwezig, aantalGasten }).catch((error) =>
				console.error('Failed to send RSVP confirmation email', error),
			),
		);
	}

	return redirect('/rsvp?status=success');
};
