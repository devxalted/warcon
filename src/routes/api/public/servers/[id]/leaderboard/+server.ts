// Public leaderboard JSON: the same board as /s/<id>/leaderboard, same query parameters as the
// panel's route. 404 unless leaderboards are on; rate limited per address. Cash is dropped: it is
// staff-only on the website's privacy line, even though the panel's own board shows it -- and so
// is sorting by it, which would publish the ranking without the number.
import { getEnv } from '$lib/server/env';
import { apiJson, param, route } from '$lib/server/http';
import {
	limitPublicReads,
	publicHeaders,
	publicName,
	publicOrgServers,
	requirePublicServer
} from '$lib/server/public';
import { loadBoard } from '$lib/server/leaderboards';
import { parseBoardQuery, PUBLIC_MAX_PAGE, RANK_METRIC } from '$lib/leaderboard';

export const GET = route(async (event) => {
	const env = getEnv();
	limitPublicReads(event.request, env);
	const ps = await requirePublicServer(env, param(event, 'id'), 'leaderboards');
	const parsed = parseBoardQuery(event.url.searchParams, PUBLIC_MAX_PAGE);
	const q = parsed.sort === 'cash' ? { ...parsed, sort: RANK_METRIC } : parsed;
	const ids =
		q.scope === 'org'
			? (await publicOrgServers(env, ps.org, 'leaderboards')).map((s) => s.id)
			: [ps.server.id];
	const board = await loadBoard(env, ids, q);
	const rows = board.rows.map(({ cash: _cash, ...r }) => ({ ...r, name: publicName(r.name) }));
	return apiJson({ ok: true, ...board, rows, maxPage: PUBLIC_MAX_PAGE }, 200, publicHeaders(30));
});
