# Manticorps deployment notes

This is a fork of [warcon-app/warcon](https://github.com/warcon-app/warcon), deployed
on Railway at <https://rcon.manticorps.gg>.

Everything here lives in files upstream does not have (`railway.json`, `doppler.yaml`,
this file), so pulling upstream changes never conflicts. Keep it that way: prefer
configuration and Warcon's own integration surfaces (org API keys, Discord webhooks,
the REST API) over patching upstream source.

## Updating from upstream

    git fetch upstream
    git log --oneline HEAD..upstream/main    # read the diff before taking it
    git merge upstream/main
    git push                                 # Railway redeploys main

Upstream cannot push to this fork. Review before merging -- the project is young and
has a single maintainer.

## Architecture

Upstream ships a four-container Compose file. Railway does not run Compose, so we run
a single service with `WARCON_ROLE=all`, which serves the panel, applies migrations on
boot, and runs the observation worker in-process.

**Replicas must stay at 1.** Two `all` processes would each hold their own live view
and worker lease; browsers landing on the one without the lease would see nothing
live. `railway.json` pins `numReplicas: 1` -- do not raise it. If this ever needs to
scale, split into `web` + `worker` services with `RELAY_SECRET`/`RELAY_URL` instead.

## Database

Neon, project `ep-soft-poetry-av8x2a89` (us-east-1) -- the same Neon instance the
website and Discord bot use, but a **separate database** named `warcon`, not `neondb`.

This is not optional. Warcon and the website both define `matches` and
`player_sessions`, and Warcon's Better Auth tables (`user`, `session`, `account`,
`verification`) would collide with next-auth the moment the website adds an adapter.
Sharing `public` would fail on the first migration.

Cross-app data therefore moves over Warcon's API keys and Discord webhooks, not SQL
joins. There is no TimescaleDB on Neon; Warcon detects that and the worker prunes old
samples itself instead of using a hypertable retention policy.

Note that Warcon polls its game servers continuously, so the Neon compute never
autosuspends. That is a real change in Neon billing versus a website that idles.

## Secrets

Doppler project `warcon`, config `prd`, mirrored into Railway variables.

`ENCRYPTION_KEY` decrypts every stored RCON password. If it is lost, every server's
password has to be re-entered by hand. It is in Doppler; leave it there and never
rotate it casually.

## Cloudflare

`rcon.manticorps.gg` is proxied (orange cloud), so `ADDRESS_HEADER=cf-connecting-ip`
-- without it every audit entry and login-throttle bucket records Cloudflare's IP
instead of the real client's.

The live view is Server-Sent Events. Warcon pings every 15s and recycles each stream
every 5 minutes, both well inside Cloudflare's ~100s idle timeout, and the browser
reconnects on its own behind a 20s safety poll. The proxy is safe here.

## Railway specifics

Project `warcon`, service `warcon`, environment `production`, region `iad`.

**Static outbound IPs are enabled** so the game host can firewall the RCON port:

    162.220.234.242
    152.55.180.242
    152.55.180.243

These are Railway's **shared** egress addresses, not dedicated to this account.
Allowlisting them narrows the exposure from the whole internet to Railway's egress
pool -- worth doing, but it is not the same as a private link. The RCON password is
still what actually authenticates, so treat the firewall as defence in depth.

Changing static IP or IPv6 settings needs a redeploy before outbound traffic moves.

**`railway.json` is deprecated** in favour of `.railway/railway.ts`, and stops working
**2026-12-01**. `railway config migrate` currently drops `restartPolicyType` and
`restartPolicyMaxRetries` and comments out the builder settings, so it was not applied.
Redo the migration by hand before the deadline and check the restart policy survives.

## First-run setup

`SETUP_TOKEN` is set (Doppler `warcon/prd`) so the first-run owner form cannot be
claimed by whoever finds the URL first:

    doppler secrets get SETUP_TOKEN --plain --project warcon --config prd

The setup form disappears once a site owner exists, so this matters only on a fresh
database. If the panel is ever rebuilt from scratch, set `SETUP_TOKEN` _before_
pointing DNS at it -- there is otherwise a window where the panel is reachable and
unclaimed.

## Still to do

- Add `https://rcon.manticorps.gg/api/auth/callback/discord` as an OAuth2 redirect on
  the Discord application, or Discord sign-in returns an invalid-redirect error.
- Set `ALLOW_DEMO_SERVER=false` once the demo server is no longer wanted.
- Cloudflare SSL/TLS mode for this zone is **Full**, not **Full (strict)**. Strict
  validates the origin certificate; Railway serves a valid one, so it would work. The
  setting is zone-wide and affects every site on manticorps.gg, so it was left alone.

## Branding

The panel wears the Manticorps skin. Upstream keeps its colour tokens
deliberately generic (`ink` / `mist` / `accent`) "so components read the same
whatever the skin", so the whole re-skin is one file, `src/brand.css`, which
restates those tokens and is imported after `app.css` in `+layout.svelte`.
**`app.css` is never edited**, so a merge from upstream cannot conflict with the
palette.

Values come from `manticorps-website/src/app/globals.css`, which is sampled from
`crest-v4`. Two rules from the site's brief carry over and are worth not
undoing:

- **The neutrals are warm.** Upstream's ink ramp is a cool blue-grey; the site's
  drab ramp is olive/khaki/bone. That single substitution is most of what makes
  the panel read as kit rather than as a generic dashboard.
- **Green is split by job.** `--green-500` (`#1AAE10`, the chevron) is for fills
  and rules and is bound to `--color-accent`; `--green-400` (`#33E133`, the
  wordmark) is signal and is bound to `--color-accent-2`, so it lights up on
  hover. Binding the vivid wordmark green to `--color-accent` was tried first
  and made half the chrome shout, because upstream spends that one token on
  fills, rules, badges, active tabs and the avatar chip at once.

`--color-ok` / `warn` / `danger` / `info` / `override` are deliberately **not**
overridden. They carry state, not brand. Upstream's muted `#7BC462` "ok" stays
readable next to the accent green precisely because it is duller; making both
the same green would cost the panel the difference between "this is good" and
"this is the control".

`Mark.svelte` is the head mark (`static/brand/mark.png`), not the full crest:
the crest's own lettering is illegible below ~64px, and both places the mark
renders already set the name in type beside it.

Icons in `static/` are generated from the site's `public/brand/crest.png`.
`favicon.ico` is a 16/32/48 multi-size built from the head mark on a
`--drab-950` plate, and is the same file the website serves, so both properties
share a tab icon. A detailed illustration has a floor at 16px; if the favicon
ever needs to be sharper, the answer is a simplified mark (the crest's chevron),
not more resampling.

## Read capabilities (local divergence from upstream)

Upstream has one read capability, `server.view`, and it grants everything: status, players,
rotation, bans, reserved slots, **the config document**, server log, analytics, dossiers and
automation rules. There is no way to express "may see players but not config", which is why every
tier saw everything.

The config document is the serious part. On a WARDOGS server it contains the RCON password in
plain text under `[/Script/WDRCON.WDRCONSettings]`, upstream gates the `config` read on
`server.view`, and the Configuration tab's raw editor renders the whole document (`readOnly` only
disables _editing_). So any viewer could read the RCON password and then drive the game server
directly -- no role, no ban list, no audit trail. That defeats the panel's stated premise that
nobody on the team needs the RCON password.

Three read capabilities now exist: `config.read`, `slots.read`, `automation.read`. All three are
**admin-only by default** -- absent from viewer and operator -- and migration `0016` grants each to
any role that already held the matching manage capability, so raising the floor never took a tab
away from a role that could already edit what was behind it.

**The config document could not simply be gated**, because builds without the live rotation routes
(CL-499480, CL-501228 -- ours) edit the map rotation _through that document_, and operators need
the rotation tab. So visibility is shaped by capability instead, in `config-visibility.ts`:

| Capability     | Sees                                           |
| -------------- | ---------------------------------------------- |
| `config.apply` | the whole document (they can already write it) |
| `config.read`  | the whole document, secret values stripped     |
| neither        | the map rotation section alone, also stripped  |

Shaping happens in `rcon-run.ts` after the game server answers, never in the browser.

`tab-guard.ts` refuses the pages themselves. Hiding a tab is presentation; the guard is the
boundary. It answers **404, not 403** -- whether a server has automation rules is itself not a
viewer's business, and `requireServerCap` already 404s for a server you cannot see, so the two are
indistinguishable from outside. The Automation tab previously had no `load` check at all and
handed every trigger to any viewer in the SSR payload; that is closed too.

**This diverges from upstream and will conflict on merge**, unlike the branding. The changed files
are `capabilities.ts`, `actions.ts`, `rcon-run.ts`, the server layout, three page loads and
migration `0016`; the logic itself lives in two new files that cannot conflict. If upstream takes
the fix, drop this and revert to theirs.
