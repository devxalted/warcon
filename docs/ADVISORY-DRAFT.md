# Draft security advisory for warcon-app/warcon

Submit via **Security → Report a vulnerability** on <https://github.com/warcon-app/warcon>
(SECURITY.md asks for private disclosure rather than a public issue). Everything below is
copy-paste ready; delete this heading block first.

---

**Title:** Any role with `server.view` can read the game server's RCON password from the config document

**Severity:** High — privilege escalation from the lowest role to full, unaudited control of the
game server.

## Summary

`server.view` is the only read capability, and the `config` action is gated on it:

```ts
// src/lib/server/actions.ts
config: {
    cap: 'server.view',
    mutating: false,
```

On a WARDOGS server, `ServerSettings.ini` contains the RCON credential in plain text:

```ini
[/Script/WDRCON.WDRCONSettings]
bEnabled=True
BindAddress=0.0.0.0
Port=7776
Password=<the RCON password>
```

The Configuration tab renders the whole document in its raw editor. `readOnly` (`!admin || !doc ||
!doc.writable`) disables *editing* only — the `<textarea readonly>` still displays the full text,
and `GET /api/servers/<id>/rcon/config` returns it regardless.

So the built-in `viewer` role — documented as "Look, but not touch" — can read the RCON password.

## Impact

This defeats the property the project leads with: *"Nobody on your team needs the RCON password;
they get their own login instead."*

A viewer who reads it can talk to the RCON listener directly and do everything the panel exists to
mediate — kick, ban, change config, end matches — while bypassing per-server roles, the
organisation ban and reserved lists, rate limits, and **the audit trail entirely**. Nothing in
Warcon records it, because Warcon is no longer in the path.

Realistic exposure: invite links default joiners to `viewer`, and that is the role a community
hands to people it explicitly does not trust with the password.

The join password (`ServerPassword`) leaks the same way, and any operator who can reach the
Configuration tab on a private server can hand it out.

## Reproduce

1. Add a real server (a build serving `GET /v1/config`; confirmed on `++Wardogs+Live-CL-501228`).
2. Grant a second account the built-in `viewer` role on it.
3. As that account, open **Configuration → Raw**, or `GET /api/servers/<id>/rcon/config`.
4. The response body contains `Password=` under `[/Script/WDRCON.WDRCONSettings]`.

Tested at commit `bb2672f`.

## Suggested fix

Gating the action on a manage capability alone breaks the rotation tab: builds without the live
rotation routes (CL-499480, CL-501228) edit the map rotation *through this document*, so roles that
must never see the rest of it still need that slice.

Shaping the response by capability, server-side, handles both:

| Capability     | Sees                                           |
| -------------- | ---------------------------------------------- |
| `config.apply` | the whole document — they can already write it |
| a new `config.read` | the whole document, secret values stripped |
| neither        | the map rotation section alone, also stripped  |

Applied in `runAction` after the game server answers, so it cannot be bypassed from the browser.
Redacting by *key name* (`Password`, `PasswordHash`, `ServerPassword`, `Token`) rather than by
section also survives a build that moves or adds one.

Worth pairing with:

- Existing roles holding `config.apply` should gain `config.read` in the same migration, so no role
  that could edit the document loses the ability to see it.
- `src/routes/(app)/server/[id]/automation/+page.server.ts` calls `listTriggers` with no capability
  check, relying on the layout, so automation rules reach any viewer in the SSR payload.
- The Configuration page has no `+page.server.ts` at all, so the action's capability is the only
  thing guarding it.

I have a working implementation of the above (two new modules, a migration, and per-tab load
guards) and am happy to open a PR if that is useful — say the word and I will send it.

## Credit

Found while deploying Warcon for a community server. Happy to be credited or not, as you prefer,
and happy to hold public disclosure until you have a release out.
