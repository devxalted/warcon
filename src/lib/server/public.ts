// The public surface: which servers anyone may see, and the reads the public pages and JSON
// share. Every gate lives here so a route cannot drift: a page that is off answers 404, never
// 403, so a closed page looks like no page. Reads never reach the worker or Steam: the live
// snapshot row, the history tables and the Steam cache only, each behind a per-address limit.
import { timingSafeEqual } from 'node:crypto';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { error, type RequestEvent } from '@sveltejs/kit';
import { getEnv, type Env } from './env';
import { ApiError, clientIp, normalizeError } from './http';
import { organizations, servers, type OrgRow, type ServerRow } from './db/schema';
import { readLiveRows } from './live';
import { recentKills } from './feed';
import { assertRate } from './ratelimit';
import { nameVerdict, type NameFilterConfig } from './name-filter';
import type { CombatSummary } from '$lib/types';
import { causeLabel } from '$lib/causes';
import { effectiveFeatures, type FeatureSet, type PublicFeature } from '$lib/features';
import { EMPTY_FILTER } from '$lib/kills';
import type { KillView, LiveView } from '$lib/types';

export interface PublicServer {
	server: ServerRow;
	org: OrgRow;
	features: FeatureSet;
}

const notFound = () => new ApiError(404, 'Not found.', 'not_found');
const PLAIN = /^[A-Za-z0-9_-]{1,64}$/;

/** The server with `feature` on (allowed by the site owner, switched on by the org, org not suspended); 404 otherwise. */
export async function requirePublicServer(
	env: Env,
	id: string,
	feature: PublicFeature
): Promise<PublicServer> {
	if (!PLAIN.test(id)) throw notFound();
	const [row] = await env.db
		.select({ server: servers, org: organizations })
		.from(servers)
		.innerJoin(organizations, eq(organizations.id, servers.orgId))
		.where(and(eq(servers.id, id), isNull(organizations.suspendedAt)))
		.limit(1);
	if (!row) throw notFound();
	const features = effectiveFeatures(row.org, row.server);
	if (!features[feature]) throw notFound();
	return { ...row, features };
}

/** The org's servers with `feature` on, dashboard order: what a public board's org scope covers. */
export async function publicOrgServers(
	env: Env,
	org: OrgRow,
	feature: PublicFeature
): Promise<ServerRow[]> {
	const rows = await env.db
		.select()
		.from(servers)
		.where(eq(servers.orgId, org.id))
		.orderBy(asc(servers.sortOrder), asc(servers.name));
	return rows.filter((s) => effectiveFeatures(org, s)[feature]);
}

/** What the public status page shows: never a Steam ID, ping, cash, the build or an error text. */
export interface PublicStatus {
	serverId: string;
	name: string;
	orgName: string;
	/** reachable at the last look */
	ok: boolean;
	observedAt: string | null;
	joinCode: string | null;
	map: string | null;
	lighting: string | null;
	experiences: string[];
	players: number;
	maxPlayers: number | null;
	reservedSlots: number | null;
	scores: { name: string; colorHex: string; score: number }[];
	scoreCap: number | null;
	matchSeconds: number | null;
	/** steamId is set only while the server's career pages are open: it is the link, never shown */
	roster: {
		name: string;
		faction: string | null;
		kills: number;
		deaths: number;
		steamId: string | null;
	}[];
	/** the last kills, newest first; null when the server does not show its feed publicly */
	kills: PublicKill[] | null;
}

/** One kill as the public page shows it: names and factions, never a SteamID. */
export interface PublicKill {
	eventId: string;
	ts: string;
	/** seconds on the match clock */
	eventTime: number;
	/** null: the environment */
	killer: { name: string; faction: string | null } | null;
	victim: { name: string; faction: string | null };
	/** the raw weapon or vehicle tag; $lib/causes labels it */
	cause: string | null;
	distanceM: number | null;
	headshot: boolean;
	suicide: boolean;
	teamKill: boolean;
	tags: string[];
}

/** How many kills the public page carries: enough to read the last few minutes, one small read. */
export const PUBLIC_KILLS = 20;

export const publicKill = (k: KillView): PublicKill => ({
	eventId: k.eventId,
	ts: k.ts,
	eventTime: k.eventTime,
	killer: k.killer ? { name: publicName(k.killer.name), faction: k.killer.faction } : null,
	victim: { name: publicName(k.victim.name), faction: k.victim.faction },
	cause: k.cause,
	distanceM: k.distanceM,
	headshot: k.headshot,
	suicide: k.suicide,
	teamKill: k.teamKill,
	tags: k.tags
});

/**
 * The public shape of the live snapshot. An unreachable server keeps its map (the art stays
 * up) and says only that it could not be reached: the stored error names the RCON host and
 * port and never leaves the panel.
 */
export function publicStatus(
	ps: PublicServer,
	live: LiveView | null,
	kills: KillView[] | null
): PublicStatus {
	const ok = !!live && live.ok && !!live.status;
	const s = live?.status ?? null;
	const linkable = ps.features.leaderboards;
	return {
		serverId: ps.server.id,
		name: ps.server.name,
		orgName: ps.org.name,
		ok,
		observedAt: live?.observedAt ?? null,
		joinCode: live?.gameServerId || null,
		map: s?.map || null,
		lighting: s?.lighting || null,
		experiences: s ? [...s.experiences] : [],
		players: ok ? s!.playerCount : 0,
		maxPlayers: ok ? s!.maxPlayers : null,
		reservedSlots: live?.reservedSlots ?? null,
		scores: ok
			? s!.scores.map((f) => ({ name: f.name, colorHex: f.colorHex, score: f.score }))
			: [],
		scoreCap: ok ? s!.scoreCap : null,
		matchSeconds: ok ? s!.matchSeconds : null,
		roster: ok
			? live!.players
					.map((p) => ({
						name: publicName(String(p.name ?? '')),
						faction: p.faction ?? null,
						kills: Number(p.kills) || 0,
						deaths: Number(p.deaths) || 0,
						steamId: linkable && /^\d{17}$/.test(String(p.steamId ?? '')) ? String(p.steamId) : null
					}))
					.sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || a.name.localeCompare(b.name))
			: [],
		kills: kills ? kills.map(publicKill) : null
	};
}

/**
 * The live snapshot row (never a worker call) and, when the server shows its feed, the last
 * kills by the same index the Kills tab pages on: two small reads however many viewers ask.
 */
export async function readPublicStatus(env: Env, ps: PublicServer): Promise<PublicStatus> {
	const [rows, kills] = await Promise.all([
		readLiveRows(env, [ps.server.id]),
		ps.server.publicKills ? recentKills(env, ps.server.id, null, PUBLIC_KILLS, EMPTY_FILTER) : null
	]);
	return publicStatus(ps, rows.get(ps.server.id) ?? null, kills);
}

/** What the public shell shows above every page of a server. */
export const publicHeading = (ps: PublicServer) => ({
	id: ps.server.id,
	name: ps.server.name,
	orgName: ps.org.name,
	discordInviteUrl: ps.org.discordInviteUrl,
	features: ps.features
});

// --- limits, per client address and per process ---

/** Forty viewers behind one address polling every twenty seconds fit; a scraper does not. */
export const PUBLIC_READS_PER_MINUTE = 120;

/**
 * The website that is the public face (PUBLIC_SITE_URL) reads this JSON from its own servers,
 * so every visitor it serves arrives from a handful of addresses. Carrying PUBLIC_API_TOKEN in
 * this header makes it one trusted caller with its own, larger allowance -- still a ceiling, so a
 * leaked token is a nuisance rather than an outage.
 */
export const PUBLIC_TOKEN_HEADER = 'x-warcon-public-token';
export const TRUSTED_READS_PER_MINUTE = 3000;

/** Whether the request carries the shared token. Constant-time, and false when none is set. */
export function trustedCaller(req: Request, token: string | undefined): boolean {
	const given = req.headers.get(PUBLIC_TOKEN_HEADER);
	if (!token || !given) return false;
	const a = Buffer.from(given);
	const b = Buffer.from(token);
	return a.length === b.length && timingSafeEqual(a, b);
}

function currentEnv(): Env | null {
	try {
		return getEnv();
	} catch {
		return null;
	}
}

export const limitPublicReads = (req: Request, env: Env | null = currentEnv()): void =>
	trustedCaller(req, env?.PUBLIC_API_TOKEN)
		? assertRate('public:trusted', TRUSTED_READS_PER_MINUTE, 60_000)
		: assertRate(`public:${clientIp(req)}`, PUBLIC_READS_PER_MINUTE, 60_000);

// --- names ---

/**
 * Names are the players' own and are shown to anyone, so the public surface runs them through the
 * built-in word list the Name filter rule uses. A name that trips it is replaced, not starred out
 * -- a starred slur is still legible.
 */
export const HIDDEN_NAME = 'Hidden name';
const PUBLIC_NAME_FILTER: NameFilterConfig = {
	characters: 'off',
	extraScripts: [],
	allowSymbols: true,
	minLetters: 0,
	builtinWords: true,
	blocked: [],
	allowed: [],
	action: 'alert',
	spareReserved: false,
	reason: ''
};
export const publicName = (name: string | null | undefined): string =>
	!name ? '' : nameVerdict(PUBLIC_NAME_FILTER, name) ? HIDDEN_NAME : name;

// --- players ---

/** One hit from the public player search. Current name only: a player's old names stay private. */
export interface PublicPlayerHit {
	steamId: string;
	name: string;
	lastSeen: string;
	minutes: number;
	online: boolean;
}

export const PUBLIC_SEARCH_LIMIT = 25;
const likeEscape = (s: string): string => s.replace(/[\\%_]/g, '\\$&');

/**
 * Players on these servers by the name they use now, or by SteamID; with no query, whoever was
 * on most recently. Old names are deliberately not matched: finding someone by a name they have
 * since dropped would say, publicly, that the two are the same person. A name the word list
 * hides is findable only by SteamID.
 */
export async function searchPublicPlayers(
	env: Env,
	ids: string[],
	q: string,
	limit: number
): Promise<PublicPlayerHit[]> {
	if (!ids.length) return [];
	const needle = q.trim().slice(0, 64);
	const bySteam = /^\d{17}$/.test(needle);
	const filter = !needle
		? sql`TRUE`
		: bySteam
			? sql`l.steam_id = ${needle}`
			: sql`l.name ILIKE ${'%' + likeEscape(needle) + '%'}`;
	// Prefix matches first, then whoever played most recently.
	const rank = needle && !bySteam ? sql`(l.name ILIKE ${likeEscape(needle) + '%'})` : sql`TRUE`;
	const rows = await env.db.execute<{
		steamId: string;
		name: string;
		lastSeen: string;
		minutes: string;
		online: boolean;
	}>(sql`
		WITH l AS (
			SELECT DISTINCT ON (steam_id) steam_id, name, last_seen
			  FROM player_sessions WHERE server_id IN ${ids}
			 ORDER BY steam_id, last_seen DESC),
		hit AS (SELECT l.steam_id, l.name, l.last_seen, ${rank} AS prefix FROM l WHERE ${filter}
			 ORDER BY prefix DESC, l.last_seen DESC LIMIT ${Math.min(limit * 2, 100)})
		SELECT h.steam_id AS "steamId", h.name, h.last_seen AS "lastSeen",
		       (SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(s.left_at, now()) - s.joined_at))) / 60, 0)
		          FROM player_sessions s WHERE s.steam_id = h.steam_id AND s.server_id IN ${ids}) AS minutes,
		       EXISTS (SELECT 1 FROM player_sessions s
		                WHERE s.steam_id = h.steam_id AND s.server_id IN ${ids} AND s.left_at IS NULL) AS online
		  FROM hit h ORDER BY h.prefix DESC, h.last_seen DESC`);
	return rows
		.map((r) => ({
			steamId: r.steamId,
			name: publicName(r.name),
			lastSeen: new Date(r.lastSeen).toISOString(),
			minutes: Math.round(Number(r.minutes) || 0),
			online: !!r.online
		}))
		.filter((p) => bySteam || p.name !== HIDDEN_NAME)
		.slice(0, limit);
}

/** A player's time on these servers: what the public profile shows above the career. */
export interface PublicProfile {
	sessions: number;
	minutes: number;
	firstSeen: string | null;
	lastSeen: string | null;
	online: boolean;
}

export async function publicProfile(
	env: Env,
	ids: string[],
	steamId: string
): Promise<PublicProfile> {
	const empty = { sessions: 0, minutes: 0, firstSeen: null, lastSeen: null, online: false };
	if (!ids.length) return empty;
	const [r] = await env.db.execute<{
		sessions: string;
		minutes: string | null;
		firstSeen: string | null;
		lastSeen: string | null;
		online: boolean;
	}>(sql`
		SELECT COUNT(*) AS sessions,
		       SUM(EXTRACT(EPOCH FROM (COALESCE(left_at, now()) - joined_at))) / 60 AS minutes,
		       MIN(joined_at) AS "firstSeen", MAX(last_seen) AS "lastSeen",
		       BOOL_OR(left_at IS NULL) AS online
		  FROM player_sessions WHERE steam_id = ${steamId} AND server_id IN ${ids}`);
	if (!r) return empty;
	return {
		sessions: Number(r.sessions) || 0,
		minutes: Math.round(Number(r.minutes) || 0),
		firstSeen: r.firstSeen ? new Date(r.firstSeen).toISOString() : null,
		lastSeen: r.lastSeen ? new Date(r.lastSeen).toISOString() : null,
		online: !!r.online
	};
}

/**
 * The combat summary as the public sees it: names through the filter, each weapon with a label so
 * the website need not carry the game's item table. Team kills and suicides stay -- they are
 * facts of play, on the public page already.
 */
export const publicCombat = (c: CombatSummary | null) =>
	c && {
		...c,
		causes: c.causes.map((x) => ({ ...x, label: causeLabel(x.cause) || x.cause })),
		victims: c.victims.map((v) => ({ ...v, name: publicName(v.name) })),
		nemeses: c.nemeses.map((n) => ({ ...n, name: publicName(n.name) }))
	};

/**
 * One kill in a player's public history. Unlike the status page's feed this keeps both SteamIDs:
 * the history lives behind the leaderboards switch, which already shows every SteamID as a link.
 */
export interface PublicPlayerKill extends Omit<PublicKill, 'killer' | 'victim'> {
	killer: { steamId: string | null; name: string; faction: string | null } | null;
	victim: { steamId: string; name: string; faction: string | null };
	map: string | null;
	causeLabel: string;
}

export const publicPlayerKill = (k: KillView): PublicPlayerKill => ({
	...publicKill(k),
	map: k.map ?? null,
	causeLabel: causeLabel(k.cause) || k.cause || '',
	killer: k.killer
		? {
				steamId: k.killer.steamId ?? null,
				name: publicName(k.killer.name),
				faction: k.killer.faction
			}
		: null,
	victim: { steamId: k.victim.steamId, name: publicName(k.victim.name), faction: k.victim.faction }
});

/** Public JSON may sit in a shared cache for a few seconds; the panel's own JSON never does. */
export const publicHeaders = (maxAge: number): Record<string, string> => ({
	'cache-control': `public, max-age=${maxAge}`
});

/** A thrown ApiError (404, 429) as the page error SvelteKit renders. */
export function pageFail(err: unknown): never {
	const known = normalizeError(err);
	if (!known) throw err;
	error(known.status, known.message);
}

/** Runs a public page's load behind the rate limit, turning refusals into page errors. */
export async function publicLoad<T>(
	event: Pick<RequestEvent, 'request'>,
	fn: () => Promise<T>
): Promise<T> {
	try {
		limitPublicReads(event.request);
		return await fn();
	} catch (err) {
		return pageFail(err);
	}
}
