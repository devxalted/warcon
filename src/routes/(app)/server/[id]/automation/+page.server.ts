import type { PageServerLoad } from './$types';
import { getEnv } from '$lib/server/env';
import { steamEnabled } from '$lib/server/steam';
import { listTriggers } from '$lib/server/triggers';
import { requireTabCap } from '$lib/server/tab-guard';

/**
 * The layout only checked that this person may see the server. Automation rules are admin-only by
 * default, and this load is what would otherwise hand them to a viewer in the SSR payload.
 */
export const load: PageServerLoad = async ({ locals, params }) => {
	const env = getEnv();
	await requireTabCap(env, locals, params.id, 'automation.read');
	return { triggers: await listTriggers(env, params.id), steam: steamEnabled(env) };
};
