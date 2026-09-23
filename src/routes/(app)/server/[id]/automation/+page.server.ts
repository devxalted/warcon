import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getEnv } from '$lib/server/env';
import { requireServerCap } from '$lib/server/access';
import { normalizeError } from '$lib/server/http';
import { steamEnabled } from '$lib/server/steam';
import { listTriggers } from '$lib/server/triggers';
import { requireTabCap } from '$lib/server/tab-guard';

/**
 * Checked here as well as in the server layout: a page's data can be asked for without its
 * layouts (SvelteKit's __data.json), so the layout's refusal protects nothing below it.
 *
 * The gate is `automation.read`, not upstream's `automation.manage`: we split reading the rules
 * from changing them, so a role can be given one without the other. In this org only admins hold
 * either, so the effective audience is the same -- but the distinction is ours to keep.
 */
export const load: PageServerLoad = async ({ locals, params }) => {
	const env = getEnv();
	// 404 rather than 403, so a tab someone may not read is indistinguishable from one that is
	// not there. See tab-guard.ts.
	await requireTabCap(env, locals, params.id, 'automation.read');
	try {
		const { server } = await requireServerCap(env, locals, params.id, 'server.view');
		// What the kinds need before they can run here, so the Add menu and the editor can say so.
		return {
			triggers: await listTriggers(env, server.id),
			steam: steamEnabled(env),
			feed: !!server.feedTokenHash
		};
	} catch (err) {
		const known = normalizeError(err);
		if (!known) throw err;
		error(known.status, known.message);
	}
};
