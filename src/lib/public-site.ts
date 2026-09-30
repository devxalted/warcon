// Where a server's public pages live. Normally here, under /s/<id>. When PUBLIC_SITE_URL names a
// separate website as the public face, they live there instead: this panel's /s/ pages redirect
// to it and every link to them (the settings page, the leaderboard note, Discord status cards)
// points at it. Client-safe and pure, so both the redirect and the links come from one mapping.

export type PublicPage =
	{ kind: 'status' } | { kind: 'leaderboard' } | { kind: 'player'; steamId: string };

/** The website's paths. Hers is one server, so the server id does not appear in them. */
const SITE_PATH = {
	status: '/live',
	leaderboard: '/leaderboard',
	player: (steamId: string) => `/players/${encodeURIComponent(steamId)}`
};

/** The address of a public page, on the website when there is one, else on this panel. */
export function publicPageUrl(
	origin: string,
	siteUrl: string | null | undefined,
	serverId: string,
	page: PublicPage
): string {
	if (siteUrl) {
		const path = page.kind === 'player' ? SITE_PATH.player(page.steamId) : SITE_PATH[page.kind];
		return `${siteUrl}${path}`;
	}
	const base = `${origin}/s/${encodeURIComponent(serverId)}`;
	if (page.kind === 'status') return base;
	if (page.kind === 'leaderboard') return `${base}/leaderboard`;
	return `${base}/players/${encodeURIComponent(page.steamId)}`;
}

/** Which public page a /s/ path is, or null for anything else. */
export function publicPageOf(pathname: string): { serverId: string; page: PublicPage } | null {
	const m = /^\/s\/([^/]+)(?:\/(leaderboard|players\/(\d{17})))?\/?$/.exec(pathname);
	if (!m) return null;
	const serverId = decodeURIComponent(m[1]);
	if (m[3]) return { serverId, page: { kind: 'player', steamId: m[3] } };
	if (m[2] === 'leaderboard') return { serverId, page: { kind: 'leaderboard' } };
	return { serverId, page: { kind: 'status' } };
}
