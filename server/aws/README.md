# Running on AWS (no Supabase)

The same code runs on Supabase (`PLATFORM=supabase`, the default) or on AWS (`PLATFORM=aws`).
On AWS the three Supabase services are replaced:

| Supabase | AWS deployment |
| --- | --- |
| Postgres | **RDS PostgreSQL 17** (`studioflow-db`, Sydney). `aws/bootstrap.sql` creates the `auth` schema, `auth.uid()` and the `authenticated`/`anon` roles the migrations and Row Level Security rely on. |
| Auth | **The API's own sign-in** (`src/config/localAuth.js`): bcrypt password hashes in `auth.users`, 1-hour HS256 access tokens, 30-day rotating refresh tokens (only their SHA-256 is stored; reusing an old one signs every device out). `POST /auth/login`, `/auth/refresh`, `/auth/logout`, `PUT /auth/password`. Supabase password hashes were copied, so existing passwords keep working. |
| Storage | **Private S3 bucket** (`src/config/s3Storage.js`), all public access blocked, short-lived presigned links. |

```
browser ──https──▶ CloudFront ──▶ S3 (frontend, private, Origin Access Control)
                        └── /api/* ──▶ EC2 :8080 (Node 22, systemd)  ──▶ RDS (SSL)
                                     (only CloudFront's IP ranges,      └─▶ S3 files
                                      plus a secret x-origin-verify header)
```

| Resource | Name |
| --- | --- |
| Frontend + API URL | CloudFront distribution `E2KUJQXSZYRO89` |
| API server | EC2 `studioflow-api` (t4g.small, Amazon Linux 2023), no SSH — managed with SSM |
| Database | RDS `studioflow-db` (db.t4g.micro, encrypted, deletion protection on) |
| Buckets | `studioflow-web-…` (frontend), `studioflow-files-…` (workspace files), `studioflow-deploy-…` (release packages) |
| Server config | SSM Parameter Store SecureString `/studioflow/env` (OpenAI key, DB URL, JWT secret, origin secret) |
| Permissions | IAM role `studioflow-api`: these buckets + that parameter only |

## Deploy

```bash
# API: package → S3 → SSM; keeps the previous release in /opt/studioflow/prev
INSTANCE=i-… DEPLOY_BUCKET=studioflow-deploy-… bash aws/deploy-api.sh
# Frontend: build with VITE_AUTH_MODE=local → S3 → CloudFront invalidation
WEB_BUCKET=studioflow-web-… DIST=E2KUJQXSZYRO89 CF_DOMAIN=….cloudfront.net bash aws/deploy-web.sh
```

Migrations: `DATABASE_MIGRATION_URL=postgres://…rds…/studioflow npm run db:migrate -- --apply`
(the RDS security group admits the operator's IP; update it when that changes).

Change a server setting: edit the `/studioflow/env` parameter, then run `deploy-api.sh` (it rewrites `/etc/studioflow.env` and restarts).

## Known limits

- No email service: "forgot password" goes through an administrator (Team page → Change password).
- CloudFront reaches EC2 over HTTP inside AWS's network (restricted to CloudFront and a secret header). With a custom domain, add an HTTPS origin (ACM certificate + load balancer) for encryption on that hop too.
- The account is on the AWS free plan: RDS keeps 1 day of automatic backups.
