// How much of the ServerSettings.ini document a caller is allowed to see.
//
// Why this exists: the document is the game server's whole config, and on a WARDOGS server it
// contains the RCON password in plain text under [/Script/WDRCON.WDRCONSettings]. Upstream gates
// the `config` read on 'server.view', which every role holds, so any viewer could open
// Configuration -> Raw and read the password -- and then talk to the RCON port directly, with no
// role, no ban list and no audit trail. That defeats the panel's entire premise.
//
// It cannot simply be gated on a manage capability either: builds without the live rotation routes
// (CL-499480, CL-501228) edit the map rotation *through this document*, so the rotation tab needs
// it for people who must never see the rest of it.
//
// So visibility is shaped by capability rather than being all-or-nothing, and the shaping happens
// on the server, in one place, after the game server answers.

export type ConfigVisibility = 'full' | 'redacted' | 'rotation-only';

/** The ini section holding the map rotation: the one slice a plain viewer legitimately needs. */
const ROTATION_SECTION = '/Script/WDGame.WDServerMapRotationSettings';

/**
 * Keys whose values are secrets. `Password` and `PasswordHash` are the RCON credential;
 * `ServerPassword` is the join password. Matched per-key rather than per-section so a key that
 * moves section, or a build that adds another password, is still caught.
 */
const SECRET_KEYS = /^(\s*[+.!-]?)(Password|PasswordHash|ServerPassword|Token)(\s*=\s*)(.*)$/i;

export const REDACTED = '[redacted — needs Config & settings]';

/** The section header a line opens, or null when the line is not a header. */
function sectionOf(line: string): string | null {
	const t = line.trim();
	return t.startsWith('[') && t.endsWith(']') ? t.slice(1, -1) : null;
}

/** Replaces the value of every secret-bearing key, keeping the key visible so the shape is honest. */
export function redactSecrets(text: string): string {
	return text
		.split(/\r?\n/)
		.map((line) => {
			const m = SECRET_KEYS.exec(line);
			return m ? `${m[1]}${m[2]}${m[3]}${m[4] ? REDACTED : ''}` : line;
		})
		.join('\n');
}

/** Just the rotation section, so the rotation tab still works without exposing anything else. */
export function rotationSectionOnly(text: string): string {
	const out: string[] = [];
	let inSection = false;
	for (const line of text.split(/\r?\n/)) {
		const header = sectionOf(line);
		if (header !== null) {
			inSection = header.toLowerCase() === ROTATION_SECTION.toLowerCase();
			if (inSection) out.push(line);
			continue;
		}
		if (inSection) out.push(line);
	}
	// An empty result still has to parse as a document, so the section header is always present.
	return out.length ? out.join('\n') : `[${ROTATION_SECTION}]`;
}

/**
 * What a caller may see:
 *   config.apply  -> the whole document; they can already write it, so hiding it buys nothing
 *   config.read   -> the whole document with secret values stripped
 *   otherwise     -> the rotation section alone
 */
export function visibilityFor(caps: ReadonlySet<string>): ConfigVisibility {
	if (caps.has('config.apply')) return 'full';
	if (caps.has('config.read')) return 'redacted';
	return 'rotation-only';
}

export function applyVisibility(text: string, visibility: ConfigVisibility): string {
	if (visibility === 'full') return text;
	if (visibility === 'redacted') return redactSecrets(text);
	// rotation-only is sliced first and redacted anyway, so a password that ever appears in the
	// rotation section cannot leak through the narrowest tier.
	return redactSecrets(rotationSectionOnly(text));
}

/**
 * Shapes a `config` action result in place of the raw one. Returns the value unchanged when it is
 * not a config document, so it is safe to call on any action result.
 */
export function shapeConfigResult(result: unknown, visibility: ConfigVisibility): unknown {
	if (visibility === 'full') return result;
	if (!result || typeof result !== 'object' || !('text' in result)) return result;
	const doc = result as { text: unknown; writable?: boolean };
	if (typeof doc.text !== 'string') return result;
	return {
		...doc,
		text: applyVisibility(doc.text, visibility),
		// Nothing below config.apply can write, and the editor keys off this.
		writable: false,
		visibility
	};
}
