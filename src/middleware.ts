import { defineMiddleware } from 'astro:middleware';

// Keep in sync with the security headers in public/_headers (which only
// covers static asset responses, not SSR routes like this one).
const SECURITY_HEADERS: Record<string, string> = {
	'X-Frame-Options': 'DENY',
	'Referrer-Policy': 'strict-origin-when-cross-origin',
	'Content-Security-Policy':
		"default-src 'self'; script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; frame-src https://challenges.cloudflare.com; connect-src 'self' https://challenges.cloudflare.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none';",
};

function applyHeaders(response: Response) {
	for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
		response.headers.set(name, value);
	}
}

export const onRequest = defineMiddleware(async (_context, next) => {
	const response = await next();
	try {
		applyHeaders(response);
		return response;
	} catch {
		// Some responses (e.g. ones passed through from fetch(), like the dev
		// image endpoint) have immutable headers. Copy into a mutable Response.
		const copy = new Response(response.body, response);
		applyHeaders(copy);
		return copy;
	}
});
