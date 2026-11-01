# BIZNEST ERP — LTS foundation

A cross-platform ERP project for small businesses, with a responsive starter UI and FastAPI backend. Brand direction: clean premium layout, ink `#171A19`, green `#1DBF73`, pale green `#E9F8F0`, warm white `#FAFBFA`. Tagline: **Business, in balance.**

## LTS architecture (selected)
- Production system of record: centrally hosted PostgreSQL.
- Updates: automatic stable-channel rollout, only after signed-manifest, checksum, API/schema compatibility and health checks.
- Backups: encrypted cloud backups plus an independent local/export copy.
- App version and database schema version are independent. Alembic owns schema evolution.

## Run for development
```bash
cd backend
python -m venv .venv
# Windows: .venv\\Scripts\\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload
```
Open `http://127.0.0.1:8000/docs`. The default local database is SQLite for development only.

## Production deployment outline
1. Provision managed PostgreSQL with TLS, private networking, automated backups and PITR.
2. Copy `backend/.env.example` to a protected runtime secret store; set `APP_ENV=production`, PostgreSQL `DATABASE_URL`, a randomly generated 48+ character `JWT_SECRET`, and exact HTTPS `CORS_ORIGINS`.
3. Build/deploy the API using `ops/docker-compose.production.yml` as a small self-hosted reference, or adapt it to a managed container platform. Terminate TLS at a hardened reverse proxy/load balancer.
4. Run Alembic migrations as a controlled release job. Do not let every app replica race to migrate.
5. Configure cloud backup replication and an independently secured local/offline export. Rehearse restores.
6. Complete the remaining production blockers in `docs/LTS_IMPLEMENTATION.md` before real customer data is used.

## Version and migration commands
```bash
cd backend
alembic current
alembic history
alembic upgrade head
# Create future migration after changing models:
alembic revision --autogenerate -m "add feature"
```
Review every generated migration manually. Released migration files are immutable. The baseline downgrade is intentionally disabled to prevent accidental data loss.

## Security foundation included
- Argon2id password hashing; minimum 12 characters for new registrations.
- 15-minute signed access tokens; opaque rotating refresh tokens with reuse-family revocation.
- Production refuses SQLite and the known development secret.
- Explicit CORS allowlist, health/readiness/version endpoints, refresh/logout endpoints.
- Tenant ownership fields and tenant-scoped SKU uniqueness; business-scoped API lookups in the existing routes.
- Ed25519 signed release-manifest verification utility; backup dump script.

## Important limits
This is not yet a production-certified or fully deployed ERP. No cloud account, domain, TLS certificate, managed database, object storage, monitoring, signing certificates, or automated CI/CD has been provisioned. Automatic updater orchestration, staged rollout service, Windows/macOS/mobile signed installers, MFA, full RBAC, RLS, complete audit coverage, rate limits, file scanning, idempotent checkout, and automated PITR/WAL restore workflow remain to be completed and tested. See `docs/LTS_IMPLEMENTATION.md`.
