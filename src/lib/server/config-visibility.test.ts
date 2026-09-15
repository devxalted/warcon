import { describe, expect, it } from 'bun:test';
import {
	applyVisibility,
	redactSecrets,
	rotationSectionOnly,
	shapeConfigResult,
	visibilityFor,
	REDACTED
} from './config-visibility';

const DOC = `[/Script/WDGame.WDGameSession]
ServerName=MantiCorps Official #1
ServerPassword=joinsecret
MaxReservedSlots=20
+DefaultReservedPlayerIds=76561198155462159

[/Script/WDGame.WDServerMapRotationSettings]
bEnabled=True
RotationMode=Ordered
+RotationEntries=(Map="Kavkazi",Lighting="DayClear")

[/Script/WDRCON.WDRCONSettings]
bEnabled=True
BindAddress=0.0.0.0
Port=9066
Password=the-real-rcon-password
`;

const caps = (...c: string[]) => new Set(c);

describe('visibilityFor', () => {
	it('gives config.apply holders the whole document', () => {
		expect(visibilityFor(caps('server.view', 'config.apply'))).toBe('full');
	});
	it('gives config.read holders a redacted document', () => {
		expect(visibilityFor(caps('server.view', 'config.read'))).toBe('redacted');
	});
	it('gives a plain viewer the rotation section only', () => {
		expect(visibilityFor(caps('server.view'))).toBe('rotation-only');
	});
});

describe('redactSecrets', () => {
	it('strips the RCON password but keeps the key', () => {
		const out = redactSecrets(DOC);
		expect(out).not.toContain('the-real-rcon-password');
		expect(out).toContain(`Password=${REDACTED}`);
	});
	it('strips the join password too', () => {
		expect(redactSecrets(DOC)).not.toContain('joinsecret');
	});
	it('leaves non-secret values alone', () => {
		const out = redactSecrets(DOC);
		expect(out).toContain('MaxReservedSlots=20');
		expect(out).toContain('BindAddress=0.0.0.0');
		expect(out).toContain('RotationMode=Ordered');
	});
	it('handles the array-command prefixes the ini uses', () => {
		expect(redactSecrets('+Password=x')).toBe(`+Password=${REDACTED}`);
		expect(redactSecrets('.Password=x')).toBe(`.Password=${REDACTED}`);
	});
	it('leaves an already-empty value empty rather than inventing one', () => {
		expect(redactSecrets('Password=')).toBe('Password=');
	});
});

describe('rotationSectionOnly', () => {
	it('keeps the rotation entries', () => {
		const out = rotationSectionOnly(DOC);
		expect(out).toContain('RotationEntries=(Map="Kavkazi"');
		expect(out).toContain('RotationMode=Ordered');
	});
	it('drops every other section', () => {
		const out = rotationSectionOnly(DOC);
		expect(out).not.toContain('WDRCONSettings');
		expect(out).not.toContain('ServerName');
		expect(out).not.toContain('MaxReservedSlots');
	});
	it('still returns a parseable document when the section is absent', () => {
		expect(rotationSectionOnly('[/Script/WDGame.WDGameSession]\nServerName=x')).toContain(
			'WDServerMapRotationSettings'
		);
	});
});

describe('applyVisibility', () => {
	it('never leaks the RCON password at any tier below config.apply', () => {
		for (const v of ['redacted', 'rotation-only'] as const) {
			expect(applyVisibility(DOC, v)).not.toContain('the-real-rcon-password');
		}
	});
	it('passes the document through untouched for config.apply', () => {
		expect(applyVisibility(DOC, 'full')).toBe(DOC);
	});
});

describe('shapeConfigResult', () => {
	it('marks anything below config.apply unwritable', () => {
		const out = shapeConfigResult({ text: DOC, writable: true, revision: '7' }, 'redacted') as {
			writable: boolean;
			revision: string;
		};
		expect(out.writable).toBe(false);
		expect(out.revision).toBe('7');
	});
	it('leaves a non-document result alone', () => {
		expect(shapeConfigResult({ reserved: ['1'] }, 'rotation-only')).toEqual({ reserved: ['1'] });
		expect(shapeConfigResult(null, 'rotation-only')).toBe(null);
	});
	it('is a no-op for full visibility', () => {
		const r = { text: DOC, writable: true };
		expect(shapeConfigResult(r, 'full')).toBe(r);
	});
});
