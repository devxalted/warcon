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
database. If the panel is ever rebuilt from scratch, set `SETUP_TOKEN` *before*
pointing DNS at it -- there is otherwise a window where the panel is reachable and
unclaimed.

## Still to do

- Add `https://rcon.manticorps.gg/api/auth/callback/discord` as an OAuth2 redirect on
  the Discord application, or Discord sign-in returns an invalid-redirect error.
- Set `ALLOW_DEMO_SERVER=false` once the demo server is no longer wanted.
- Cloudflare SSL/TLS mode for this zone is **Full**, not **Full (strict)**. Strict
  validates the origin certificate; Railway serves a valid one, so it would work. The
  setting is zone-wide and affects every site on manticorps.gg, so it was left alone.
