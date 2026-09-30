import { describe, expect, test } from 'bun:test';
import { publicPageOf, publicPageUrl } from './public-site';

const ID = '07439b63-d9a9-46a6-8260-e6116ddd3cbc';
const STEAM = '76561198085566593';

describe('publicPageUrl', () => {
	test('points at the panel when there is no website', () => {
		const o = 'https://rcon.example.com';
		expect(publicPageUrl(o, null, ID, { kind: 'status' })).toBe(`${o}/s/${ID}`);
		expect(publicPageUrl(o, null, ID, { kind: 'leaderboard' })).toBe(`${o}/s/${ID}/leaderboard`);
		expect(publicPageUrl(o, null, ID, { kind: 'player', steamId: STEAM })).toBe(
			`${o}/s/${ID}/players/${STEAM}`
		);
	});
	test('points at the website when one is the public face', () => {
		const site = 'https://manticorps.gg';
		expect(publicPageUrl('x', site, ID, { kind: 'status' })).toBe(`${site}/live`);
		expect(publicPageUrl('x', site, ID, { kind: 'leaderboard' })).toBe(`${site}/leaderboard`);
		expect(publicPageUrl('x', site, ID, { kind: 'player', steamId: STEAM })).toBe(
			`${site}/players/${STEAM}`
		);
	});
});

describe('publicPageOf', () => {
	test('reads each public page, so the redirect lands on its counterpart', () => {
		expect(publicPageOf(`/s/${ID}`)).toEqual({ serverId: ID, page: { kind: 'status' } });
		expect(publicPageOf(`/s/${ID}/leaderboard`)).toEqual({
			serverId: ID,
			page: { kind: 'leaderboard' }
		});
		expect(publicPageOf(`/s/${ID}/players/${STEAM}`)).toEqual({
			serverId: ID,
			page: { kind: 'player', steamId: STEAM }
		});
	});
	test('is null for anything else', () => {
		expect(publicPageOf('/server/abc')).toBeNull();
		expect(publicPageOf(`/s/${ID}/players/123`)).toBeNull();
	});
});
