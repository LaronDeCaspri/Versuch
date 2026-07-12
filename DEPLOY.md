# Deployment (Docker)

The whole platform runs from one `docker compose` stack: Postgres, the API
(with the Chromium needed for the PDF dossier), and nginx serving the web UI and
proxying `/api`. For PDPL, run this on a server **inside Saudi Arabia**.

## Prerequisites
- A Linux server you control (a VPS or cloud VM), ideally in an in-Kingdom region.
- Docker Engine + the Docker Compose plugin installed.
- A domain name pointed at the server (recommended, for HTTPS).

## First deployment
```bash
# 1. Get the code
git clone https://github.com/LaronDeCaspri/Versuch.git
cd Versuch            # the default branch (main) has the full platform

# 2. Configure secrets
cp .env.docker.example .env
#   edit .env: set POSTGRES_PASSWORD and a SESSION_SECRET of >= 32 characters

# 3. Build and start (migrations run automatically on the API container)
docker compose up -d --build

# 4. Seed a first owner + demo data (only needed once, to get in)
docker compose run --rm api sh -c "cd /app/packages/db && pnpm exec prisma db seed"
```
Then open `http://YOUR_SERVER_IP/` and sign in with `owner@demo.sa` /
`owner-password`.

## Make it production-safe (important)
1. **Create your real users**: signed in as the owner, go to *Users* and create
   your actual accounts (assign roles + sites). Then deactivate the demo owner.
2. **HTTPS**: put the stack behind a TLS reverse proxy (e.g. Caddy or nginx with
   a certificate), then set `COOKIE_SECURE=true` in `.env` and
   `docker compose up -d` again. Cookies must only travel over HTTPS.
3. **Object storage (optional)**: for durable, in-Kingdom certificate storage set
   `STORAGE_DRIVER=s3` and the `S3_*` variables (see `.env.docker.example`) on the
   `api` service. The default `local` driver keeps files in a Docker volume.
4. **Backups**: back up the `pgdata` and `storage` Docker volumes regularly —
   they hold the compliance evidence.

## Everyday operations
```bash
docker compose up -d --build     # deploy a new version
docker compose logs -f api       # follow API logs
docker compose down              # stop (data survives in named volumes)
```

## Notes
- The seeded inspection-duty intervals/authorities are **drafts** — review them
  against the applicable regulations before relying on them.
- Record immutability is enforced by database triggers that reject UPDATE, DELETE
  and TRUNCATE on `inspection_records` for everyone. For defense-in-depth, run the
  API under a dedicated **non-superuser** Postgres role (a superuser could disable
  triggers via `session_replication_role`); this compose uses the default admin
  role for simplicity — hardening the role is recommended before go-live.
