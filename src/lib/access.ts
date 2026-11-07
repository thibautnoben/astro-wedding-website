// Verifies that a request came through Cloudflare Access (Zero Trust) for the admin pages.
//
// Setup (Cloudflare dashboard → Zero Trust → Access → Applications):
//   1. Add a self-hosted application for the path `/admin/*` on the site's domain and allow only
//      your own e-mail addresses.
//   2. Copy the application's "Audience (AUD) tag" and your team domain
//      (e.g. "kirstenthibaut.cloudflareaccess.com").
//   3. Set them as Worker variables ACCESS_AUD and ACCESS_TEAM_DOMAIN (wrangler.json "vars",
//      or .dev.vars locally).
// Without both variables every admin request is refused, so the page is never public by accident.

type Jwk = JsonWebKey & { kid?: string };

const b64urlDecode = (value: string) => {
	const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
	return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
};
const b64urlJson = <T>(value: string): T => JSON.parse(new TextDecoder().decode(b64urlDecode(value)));

function tokenFrom(request: Request): string | null {
	const header = request.headers.get('Cf-Access-Jwt-Assertion');
	if (header) return header;
	const cookie = request.headers.get('Cookie') ?? '';
	const match = cookie.match(/(?:^|;\s*)CF_Authorization=([^;]+)/);
	return match ? decodeURIComponent(match[1]) : null;
}

/** Returns the signed-in user's e-mail when the Access token is valid, otherwise null. */
export async function verifyAccess(
	request: Request,
	teamDomain: string | undefined,
	audience: string | undefined,
): Promise<{ email: string } | null> {
	if (!teamDomain || !audience) return null;
	const token = tokenFrom(request);
	if (!token) return null;

	const parts = token.split('.');
	if (parts.length !== 3) return null;
	const [headerPart, payloadPart, signaturePart] = parts;

	try {
		const header = b64urlJson<{ alg?: string; kid?: string }>(headerPart);
		if (header.alg !== 'RS256' || !header.kid) return null;

		const issuer = `https://${teamDomain.replace(/^https?:\/\//, '').replace(/\/$/, '')}`;
		const certs = await fetch(`${issuer}/cdn-cgi/access/certs`);
		if (!certs.ok) return null;
		const { keys } = await certs.json<{ keys: Jwk[] }>();
		const jwk = keys.find((key) => key.kid === header.kid);
		if (!jwk) return null;

		const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, [
			'verify',
		]);
		const valid = await crypto.subtle.verify(
			'RSASSA-PKCS1-v1_5',
			key,
			b64urlDecode(signaturePart),
			new TextEncoder().encode(`${headerPart}.${payloadPart}`),
		);
		if (!valid) return null;

		const payload = b64urlJson<{ aud?: string | string[]; exp?: number; iss?: string; email?: string }>(payloadPart);
		const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
		const now = Math.floor(Date.now() / 1000);
		if (!audiences.includes(audience) || !payload.exp || payload.exp < now || payload.iss !== issuer) return null;

		return { email: payload.email ?? '' };
	} catch {
		return null;
	}
}
