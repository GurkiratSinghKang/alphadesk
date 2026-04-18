# Secrets setup

This doc covers generating and installing the required secrets for
AlphaDesk. Follow it once per new deployment (and once per secret rotation).

## 1. Generate `JWT_SECRET`

The backend refuses to start without `JWT_SECRET`, in every environment
including dev. Generate a random 256-bit hex string:

```sh
openssl rand -hex 32
```

Paste the output into `.env.prod` (or `.env.local` for dev):

```
JWT_SECRET=<paste the 64-character hex string here>
```

Rotate this value by generating a new one and restarting the backend —
all existing JWTs become invalid (forces re-login across all users).
Plan rotations for low-traffic windows.

## 2. Generate `REDIS_PASSWORD`

```sh
openssl rand -base64 32
```

Add to `.env.prod`:

```
REDIS_PASSWORD=<paste output>
```

Must match the `requirepass` arg on the redis container (already wired
via `${REDIS_PASSWORD}` substitution in `docker-compose.yml`).

## 3. Generate `POSTGRES_PASSWORD`

```sh
openssl rand -base64 24
```

Add to `.env.prod`:

```
POSTGRES_PASSWORD=<paste output>
```

The backend's `DATABASE_URL` in `infrastructure/docker-compose.prod.yml`
already substitutes `${POSTGRES_PASSWORD}`.

## 4. Generate `ADMIN_PASSWORD_HASH`

Interactive — pick a strong passphrase, then hash it with bcrypt:

```sh
python3 -c 'import bcrypt, getpass; pw = getpass.getpass("admin password: "); print(bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode())'
```

Paste the resulting `$2b$...` string into `.env.prod`:

```
ADMIN_PASSWORD_HASH=$2b$12$...
```

## 5. Generate `STATUS_PASS_HASH` (Caddy basic auth for /status)

```sh
docker run --rm caddy:2-alpine caddy hash-password --plaintext 'YOUR-STATUS-PASSWORD'
```

Add to `.env.prod`:

```
STATUS_USER=admin
STATUS_PASS_HASH=$2a$14$...
```

## 6. Lock down `.env.prod`

`.env.prod` contains every production secret — treat it like an SSH key.

```sh
# On the VPS, run once after creating /opt/alphadesk/.env.prod:
chmod 600 /opt/alphadesk/.env.prod
chown deploy:deploy /opt/alphadesk/.env.prod
```

After this, only `deploy` and `root` can read the file; other host users
and any container bind-mount that inherits the host UID cannot.

## 7. Never commit

`.env.prod` is in `.gitignore`. If you ever accidentally commit a
secret, rotate it (re-run this whole doc) and force-push the
history-scrubbed branch.
