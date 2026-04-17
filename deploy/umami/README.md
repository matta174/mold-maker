# Self-Hosted Umami Deploy

This directory contains everything you need to stand up a private Umami instance for Mold Maker's opt-in telemetry. The intent is a single-host Docker deploy with auto-TLS — maybe an hour of work including DNS propagation, not a week of infra plumbing.

**Who this is for:** the project maintainer, or anyone forking Mold Maker who wants their own telemetry endpoint. End users never need to read this — their experience is just "Allow / Decline" on a modal.

**What gets deployed:** Caddy (reverse proxy, auto-TLS), Umami (analytics app), Postgres 16 (event storage). All containerized, all behind a single subdomain you control.

## Prerequisites

- A Linux VPS with Docker + Docker Compose. Anything with ≥1GB RAM is fine — Umami is small. Hetzner CX11 (€4/mo), DigitalOcean $6 droplet, a Raspberry Pi at home, all work.
- A domain you control with access to its DNS records.
- Ports 80 and 443 open inbound (that's it — Umami itself doesn't need public ports).
- `openssl` available locally for generating secrets.

## One-time setup

### 1. Point a subdomain at the server

Pick a subdomain, e.g. `telemetry.yourproject.org` or `umami.yourproject.org`. Add an A record pointing it at your server's public IPv4 address. Wait for propagation (a few minutes on most registrars; use `dig +short telemetry.yourproject.org` to verify from your laptop).

DNS has to resolve before you bring up the stack — Caddy asks Let's Encrypt for a cert on startup, and the ACME HTTP-01 challenge requires the subdomain to already route to the server.

### 2. Copy configs and fill in secrets

SSH to the server, `git clone` this repo (or just scp the `deploy/umami/` directory), then:

```bash
cd deploy/umami
cp .env.example .env
cp Caddyfile.example Caddyfile

# Generate two independent random secrets
openssl rand -hex 32  # first one → POSTGRES_PASSWORD in .env
openssl rand -hex 32  # second one → APP_SECRET in .env

# Edit files
$EDITOR .env        # paste the two secrets
$EDITOR Caddyfile   # replace umami.example.com and you@example.com
```

### 3. Bring up the stack

```bash
docker compose up -d
docker compose logs -f caddy    # watch for "certificate obtained"
```

First boot takes ~30 seconds while Umami runs its Prisma migrations. If Caddy logs an ACME failure, it's almost always because DNS isn't pointing at this server yet — fix DNS, `docker compose restart caddy`.

### 4. Create admin user + website

Visit `https://umami.yourproject.org`. Log in with the default credentials — `admin` / `umami` — and **immediately** change the password under Settings → Profile. If you skip this step you're publishing an admin panel to the internet with a known password. Don't do that.

Then:
1. Settings → Websites → **+ Add website**
2. Name: `Mold Maker`
3. Domain: the domain your *app* lives at (e.g. `matta174.github.io` or your custom domain). This field is cosmetic — Umami uses it for display, not for origin filtering.
4. Save, then click the site to reveal the **Website ID** (a UUID). Copy this.

### 5. Wire the app build to the endpoint

In your GitHub repo settings → Secrets and variables → Actions, add:

- `VITE_TELEMETRY_HOST` → `https://umami.yourproject.org` (scheme + host, no path, no trailing slash — the build will reject anything else)
- `VITE_TELEMETRY_WEBSITE_ID` → the UUID from step 4

The `deploy-pages.yml` workflow reads these at build time and:
- Injects the host into the CSP `connect-src` so the browser only allows POSTs to your endpoint
- Embeds the website ID so Umami knows which site each event belongs to

Push a commit (or re-run the Pages workflow) and the next build will start sending events from any user who opts in.

## Operational notes

**Backups.** The only state worth backing up is the `postgres_data` volume. A nightly `pg_dump` to off-box storage is sufficient; if you lose the DB you lose historical events, which is annoying but not catastrophic (the product keeps working). Caddy's `caddy_data` volume holds TLS certs — losing it just means Caddy re-issues from Let's Encrypt on next boot.

**Upgrades.** Bump the image tag in `docker-compose.yml` after reading the Umami release notes. Umami 2.x has been stable but major version bumps have migrations worth reading. Postgres minor versions are safe in place; major versions (16 → 17) need a pg_upgrade dance.

**Observability of the observer.** If Umami itself goes down, `sendTelemetry` silently drops events (that's deliberate — see `telemetryTransport.ts`). You won't notice unless you check the Umami dashboard or monitor the Caddy logs. A cheap uptime check (UptimeRobot, healthchecks.io) hitting `https://umami.yourproject.org/api/heartbeat` catches outages you'd otherwise miss.

**What this stack does NOT do.** No log aggregation, no alerting, no rate limiting beyond Caddy defaults, no fail2ban. For a hobby-scale telemetry endpoint that's fine. If you grow into something that needs those, you've outgrown this file.

## Cost reality check

At typical hobby traffic levels (single-digit active users per day), a Hetzner CX11 is €4/mo (~$4.40) and uses <10% of its resources. That's strictly cheaper than Umami Cloud's $9/mo tier, but the tradeoff is you're the one paging yourself if the VPS dies. For a project maintained by one person in their spare time, that's usually the right call — if it goes down for a day, the product keeps working, and you lose events you never had any SLA on.

If you'd rather pay for someone else's uptime, Umami Cloud works identically from the app's perspective — just set `VITE_TELEMETRY_HOST=https://cloud.umami.is` and point the website at your cloud-hosted project. CSP still locks to that one host.
