# Docker Deployment Guide

Production Docker setup for the documentation platform (Next.js 16 + external PostgreSQL).

## Prerequisites

- Docker Desktop (Windows) or Docker Engine + Compose plugin (Linux)
- Node.js is **not** required on the host for the Docker workflow
- A reachable PostgreSQL database (external — no DB container is included)

## 1. Create your environment file

Copy the committed template once:

```powershell
# Windows PowerShell
Copy-Item .env.docker.example .env.docker
```

```bash
# Linux / macOS
cp .env.docker.example .env.docker
```

Then edit `.env.docker` and fill in real values. `.env.docker` is git-ignored — never commit it.

## 2. Configure `DATABASE_URL`

`DATABASE_URL` is required at runtime (Drizzle + `postgres` driver). Which host to use:

| Where your database runs | Use |
|---|---|
| Another Docker container in the same compose file | Its service name, e.g. `db` (not used in this repo's setup) |
| Directly on a Windows/macOS host | `host.docker.internal` as the host |
| Cloud (Neon, RDS, Cloud SQL,…) | The provider's real hostname |

> ⚠️ `localhost` inside a container means **the container itself**, not your machine.
> Remote/cloud databases must otherise authorize your Docker network / public IP
> (firewall / allow-list rules additional to the connection string).

Format:

```
DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/DBNAME
```

Example for a Windows-host DB — illustrative only, do **not** copy credentials from anywhere:

```
DATABASE_URL=postgres://myuser:mypassword@host.docker.internal:5432/documentation
```

Never leak secrets through `NEXT_PUBLIC_*` variables — those are inlined into client
JavaScript and served to every visitor.

## 3. Build and start

```bash
docker compose up --build -d
docker compose ps
docker compose logs -f web
```

Open <http://localhost:3000>.

## 4. Rebuild after code changes

Rebuilding an image only bakes in the source code; the container must be recreated:

```bash
docker compose up --build -d
```

(For dependency changes, this also re-runs `npm ci` inside the build cache layers.)

## 5. Stop / cleanup

```bash
docker compose down          # stop and remove the container
docker compose down --rmi local   # also remove the built image
```

## 6. Port conflicts

If port `3000` is already in use, either stop the other process, or map a different host
port in `compose.yaml` (`ports: - "3001:3000"` → app on <http://localhost:3001>).

## 7. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `DATABASE_URL is not set` in `web` logs | `.env.docker` missing or not next to `compose.yaml`. Create it from `.env.docker.example`. |
| `ECONNREFUSED` / connection timeout in logs | DB unreachable from the container. Check host/port, firewall/allow-list, and never use `localhost` to reach a host DB. |
| `password authentication failed` | Wrong credentials in `.env.docker`. |
| `port is already allocated` | Port 3000 busy — see section 6. |
| Build fails in `npm ci` | Delete nothing in package files; ensure `package-lock.json` is committed. The Dockerfile uses `npm ci --ignore-scripts` (no postinstall). |

## 8. Run migrations / seed against the Docker DB

Migrations are **not** run automatically at container startup. Run them explicitly from
the host (Node.js required) against the same database, after the container is up:

```bash
npm run db:migrate
```

Note this loads `.env` (not `.env.docker`) via `dotenv` — copy the intended DB URL to
`.env` or run with the env you want. Seeding works the same way (`npm run db:seed`).

## 9. Continuous Integration (GitHub Actions)
`.github/workflows/ci.yml` runs on every push/PR to `main` and `dev`, with jobs in **parallel**:

| Job | What it does | Notes |
|---|---|---|
| `lint` | `npm run lint` | zero-error policy — warnings allowed, errors fail |
| `typecheck` | `npx tsc --noEmit` | strict TypeScript passes |
| `unit` | `test:tree`, `test:fractional`, `test:fallback` | DB-free scripts only |
| `build` | `npx next build` | no `DATABASE_URL` needed (all routes dynamic) |
| `integration` | postgres:18 service on :5433, `db:migrate` + `db:seed` + `test:navigation` + migrate idempotency re-run | mirrors `scripts/db.sh` setup; CI-only credentials, never production |
| `docker` | build image (no push), boot it with placeholder creds, assert `/login` → 200, assert no `.env*` in image | uses the Dockerfile from this guide |
| `audit` | `npm audit --omit=dev --audit-level=critical` | gate; full report uploaded as artifact non-blocking |

Everything runs against CI-only throwaway credentials (`postgres:postgres` in an ephemeral
service container). **No repository or CI job holds production secrets.**

Dependabot (`.github/dependabot.yml`) opens weekly grouped PRs for npm + GitHub Actions updates,
so the audit job's findings get fix PRs automatically.

## 10. Continuous Deployment (GitHub Actions)

`.github/workflows/cd.yml` ships the app to a **self-hosted VPS over SSH**, triggered only by:
- pushing a version tag (`v*`) — the intentional release path, or
- a manual `workflow_dispatch` run (also used for rollback by entering an older ref).

### Required GitHub secrets

Add these under **repo → Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Value |
|---|---|
| `DEPLOY_HOST` | VPS hostname or IP (e.g. `203.0.113.10`) |
| `DEPLOY_USER` | SSH user on the VPS |
| `DEPLOY_SSH_KEY` | Private SSH key (Ed25519/RSA PEM, no passphrase) whose public half is in the VPS user's `~/.ssh/authorized_keys` |
| `DEPLOY_PATH` | Absolute path on the VPS holding `compose.yaml` (e.g. `/srv/documentation`) |

Nothing here carries `DATABASE_URL` or `AUTH_SECRET` — those stay in `.env.docker` on the
VPS itself (git-ignored, provisioned once per §1–2 above).

### What the deploy does

1. **CI gate** — looks up the `ci.yml` run for the exact commit being deployed; if it hasn't
   passed, the deploy aborts. A red build can never deploy.
2. **SSH to VPS** → `git fetch --all --tags && git checkout --force $SHA`.
3. `docker compose build && docker compose up -d` — the image is rebuilt on the VPS,
   so no container registry (and no registry secret) is needed.
4. **Health check** — waits up to 30s for `/login` to return `200` inside the container.
5. **Auto-rollback** — if the check fails, compose is torn down and the previous image
   is started on the same port.

### One-time VPS prep

```bash
# on the VPS, once
git clone https://github.com/Ashraful-IR/documentation.git /srv/documentation
cd /srv/documentation
cp .env.docker.example .env.docker   # fill in real DB + AUTH_SECRET values
docker compose up -d                 # first bring-up so a recording of it exists
```

Also make sure the repo remote is authenticated for `git fetch` on the VPS (a read-only
deploy key, or `git remote set-url origin https://<user>:<token>@github.com/...`).

### How to release

```bash
git tag v1.0.0 && git push origin v1.0.0
```

## 11. Files involved

- `Dockerfile` — multi-stage build (deps → build → runtime, non-root user, standalone)
- `compose.yaml` — single `web` service, port 3000, `.env.docker`, `unless-stopped`
- `.dockerignore` — keeps secrets, git history, `node_modules`, `.next` out of the build
- `.env.docker.example` — committed template (no real values)
- `next.config.ts` — no change was made to the config content during dockerization
- `.github/workflows/ci.yml` — the CI pipeline described in section 9
- `.github/workflows/cd.yml` — the CD pipeline described in section 10
- `.github/dependabot.yml` — weekly dependency PRs
