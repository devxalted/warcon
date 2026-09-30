// Public player search: by the name a player uses now, or by SteamID; with no query, whoever was
// on most recently. Over the organization's servers with public leaderboards, like the careers it
// links to. 404 unless leaderboards are on; rate limited per address (or as the trusted website).
import { getEnv } from '$lib/server/env';
import { apiJson, int, param, route } from '$lib/server/http';
import {
	limitPublicReads,
	PUBLIC_SEARCH_LIMIT,
	publicHeaders,
	publicOrgServers,
	requirePublicServer,
	searchPublicPlayers
} from '$lib/server/public';

export const GET = route(async (event) => {
	const env = getEnv();
	limitPublicReads(event.request, env);
	const ps = await requirePublicServer(env, param(event, 'id'), 'leaderboards');
	const ids = (await publicOrgServers(env, ps.org, 'leaderboards')).map((s) => s.id);
	const q = event.url.searchParams.get('q') ?? '';
	const limit = int(event.url.searchParams.get('limit'), 20, 1, PUBLIC_SEARCH_LIMIT);
	const players = await searchPublicPlayers(env, ids, q, limit);
	return apiJson({ ok: true, players }, 200, publicHeaders(q ? 15 : 30));
});
