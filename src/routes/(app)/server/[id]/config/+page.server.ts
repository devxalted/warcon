import type { PageServerLoad } from './$types';
import { getEnv } from '$lib/server/env';
import { requireTabCap } from '$lib/server/tab-guard';

/**
 * The Configuration tab had no load at all, so the only thing standing between a viewer and the
 * config document was the `config` action's capability. This refuses the page itself; what the
 * action returns is shaped separately in config-visibility.ts.
 */
export const load: PageServerLoad = async ({ locals, params }) => {
	await requireTabCap(getEnv(), locals, params.id, 'config.read');
	return {};
};
