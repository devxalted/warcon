// Per-tab read guards for the server pages.
//
// The server layout only checks that you may see the server at all, and each tab's `load` then
// trusts it -- which is why the Automation tab's load fetched every trigger for anyone with
// 'server.view'. Hiding a tab in the layout is presentation; this is the part that actually
// refuses, so a typed URL or a view-source of the SSR payload gets nothing either.
//
// 404 rather than 403 on purpose: whether this server has automation rules is itself something a
// plain viewer has no business learning, and `requireServerCap` already answers 404 for a server
// you cannot see at all, so the two are indistinguishable from outside.
import { error } from '@sveltejs/kit';
import type { Capability } from '$lib/capabilities';
import { serverAccessFor, requireUser } from './access';
import type { Env } from './env';

export async function requireTabCap(
	env: Env,
	locals: App.Locals,
	serverId: string,
	cap: Capability
): Promise<void> {
	const user = requireUser(locals);
	const access = await serverAccessFor(env, user, serverId);
	// The same words `requireServerCap` uses for a server you cannot see at all, so a tab you
	// may not read and a server you may not open are the same answer.
	if (!access || !access.caps.has(cap))
		error(404, 'Server not found, or you have no access to it.');
}
