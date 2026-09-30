// Public career JSON for one player, over the organization's servers with public leaderboards:
// the career (rank, streak, results, maps, factions, last matches), the combat summary (headshots,
// weapons, range, most killed, nemeses), time played, and the Steam avatar from the cache only.
// Nothing staff-only: no Steam standing, risk, notes, bans, lists or old names.
import { getEnv } from '$lib/server/env';
import { ApiError, apiJson, param, route } from '$lib/server/http';
import {
	limitPublicReads,
	publicCombat,
	publicHeaders,
	publicName,
	publicOrgServers,
	publicProfile,
	requirePublicServer
} from '$lib/server/public';
import { lastNameOf, loadCareer } from '$lib/server/leaderboards';
import { combatSummary } from '$lib/server/players';
import { cachedProfiles } from '$lib/server/steam';

export const GET = route(async (event) => {
	const env = getEnv();
	limitPublicReads(event.request, env);
	const ps = await requirePublicServer(env, param(event, 'id'), 'leaderboards');
	const steamId = param(event, 'steamId');
	if (!/^\d{17}$/.test(steamId)) throw new ApiError(404, 'Not found.', 'not_found');
	const orgServers = await publicOrgServers(env, ps.org, 'leaderboards');
	const ids = orgServers.map((s) => s.id);
	const [career, name, combat, profile, steam] = await Promise.all([
		loadCareer(env, {
			serverId: ps.server.id,
			ids,
			nameOf: new Map(orgServers.map((s) => [s.id, s.name])),
			steamId
		}),
		lastNameOf(env, ids, steamId),
		combatSummary(env, ids, steamId),
		publicProfile(env, ids, steamId),
		cachedProfiles(env, [steamId])
	]);
	if (!name) throw new ApiError(404, 'Not found.', 'not_found');
	return apiJson(
		{
			ok: true,
			player: { steamId, name: publicName(name), avatar: steam.get(steamId)?.avatar || null },
			profile,
			career,
			combat: publicCombat(combat)
		},
		200,
		publicHeaders(30)
	);
});
