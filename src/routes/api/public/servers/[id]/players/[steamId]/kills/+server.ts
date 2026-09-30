// One player's kills and deaths on this server, newest first, paged like the Kills tab: `before`
// (ISO timestamp) and `beforeTime` (that row's match-clock seconds). `kind` narrows to headshot,
// teamKill, suicide, vehicle or environment. 404 unless leaderboards are on.
import { getEnv } from '$lib/server/env';
import { ApiError, apiJson, int, param, route } from '$lib/server/http';
import {
	limitPublicReads,
	publicHeaders,
	publicPlayerKill,
	requirePublicServer
} from '$lib/server/public';
import { recentKills } from '$lib/server/feed';
import { EMPTY_FILTER, KINDS, type KillKind } from '$lib/kills';

export const GET = route(async (event) => {
	const env = getEnv();
	limitPublicReads(event.request, env);
	const ps = await requirePublicServer(env, param(event, 'id'), 'leaderboards');
	const steamId = param(event, 'steamId');
	if (!/^\d{17}$/.test(steamId)) throw new ApiError(404, 'Not found.', 'not_found');
	const p = event.url.searchParams;
	const raw = p.get('before');
	const ts = raw ? new Date(raw) : null;
	if (ts && Number.isNaN(ts.getTime())) throw new ApiError(400, 'before must be an ISO timestamp.');
	const rawTime = p.get('beforeTime');
	const eventTime = rawTime !== null && rawTime !== '' ? Number(rawTime) : null;
	if (eventTime !== null && !Number.isFinite(eventTime))
		throw new ApiError(400, 'beforeTime must be a number.');
	const kind = (KINDS.map((k) => k.key) as string[]).includes(p.get('kind') ?? '')
		? (p.get('kind') as KillKind)
		: '';
	const limit = int(p.get('limit'), 50, 1, 100);
	const kills = await recentKills(env, ps.server.id, ts ? { ts, eventTime } : null, limit, {
		...EMPTY_FILTER,
		player: steamId,
		kind
	});
	return apiJson(
		{ ok: true, kills: kills.map(publicPlayerKill), more: kills.length === limit },
		200,
		publicHeaders(ts ? 300 : 30)
	);
});
