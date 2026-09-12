# Running and testing locally

How to get the SE4HC website and admin portal running on your own machine, and
what to check before you push. Every command here was run on a Windows machine
with Git Bash and Docker Desktop; they work unchanged on Linux and macOS.

- [Before you start](#before-you-start)
- [1. The website](#1-the-website)
- [2. The automated tests](#2-the-automated-tests)
- [3. The admin portal](#3-the-admin-portal)
- [4. The whole thing in Docker](#4-the-whole-thing-in-docker)
- [Before you push](#before-you-push)
- [Troubleshooting](#troubleshooting)

---

## ⚠️ Read this first

**The admin portal writes to the real GitHub repository.** It has no local
database of content — pressing *Save* commits to `GITHUB_BRANCH` immediately,
and a commit to `main` triggers CI and deploys to production.

Before running the portal locally, point it at a sandbox branch:

```bash
# once, from the repo
git push origin main:cms-sandbox
```

Then always run with `GITHUB_BRANCH=cms-sandbox`. CI only builds on pushes to
`main`, so saves land harmlessly on the sandbox branch and nothing deploys.
Reset it whenever you like:

```bash
git push --force origin main:cms-sandbox
```

Everything else in this guide is read-only and safe.

---

## Before you start

| Tool | Why | Check |
| --- | --- | --- |
| Node.js 20+ | Building the site and running the admin | `node -v` |
| Docker | Postgres, MinIO, and the container builds | `docker info` |
| Git Bash (Windows only) | The scripts are bash | — |
| GitHub CLI *(optional)* | Easy token for the admin | `gh auth status` |

```bash
git clone https://github.com/PoscarDigital/se4hc-website.git
cd se4hc-website
npm install
```

---

## 1. The website

The fastest loop — no Docker, no database. This is all you need for content,
styling and layout work.

```bash
npm run dev
```

Open **http://localhost:4321**. Edits to `src/` reload instantly.

| What | Where |
| --- | --- |
| Khmer home | http://localhost:4321/ |
| English home | http://localhost:4321/en/ |
| A listing page | http://localhost:4321/news/ |
| A detail page | http://localhost:4321/reports/q4-2025-progress/ |

To check what production will actually serve:

```bash
npm run build      # runs astro check, then builds to dist/
npm run preview    # serves dist/ at http://localhost:4321
```

`npm run build` is the same command CI runs. If it passes here, it passes there.

---

## 2. The automated tests

Run these before every push. They take well under a minute together.

### Content validation

```bash
node scripts/check-translation-pairs.mjs
```

```
Translation pairs OK — 39 entries across 6 collections.
```

Fails if any entry exists in one language but not the other. The language
switcher builds the twin URL by swapping the prefix, so a missing counterpart
is a link to a 404 that nothing else catches.

### Type and schema check

```bash
npm run build
```

Validates every Markdown file's frontmatter against `src/content/config.ts` and
type-checks the components. **This is the gate that protects production**: bad
content fails here, no image is published, and the server keeps serving the last
good build.

### Admin portal tests

```bash
cd services/admin
npm install

DATABASE_URL=postgres://x@localhost/x AUTH_SECRET=x GITHUB_TOKEN=x npm test
```

```
48 passed, 0 failed

--- mounted at / ---
OK: module graph links, routes register, guards work, mount point holds (/).

--- mounted at /admin ---
OK: module graph links, routes register, guards work, mount point holds (/admin).
```

The dummy values are deliberate — this suite covers frontmatter round-tripping
(including Khmer), form parsing, type coercion, the route tree and the auth
guards, none of which touch Postgres or GitHub.

The boot suite runs twice because production serves the portal at
`https://se4hc.moeys.gov.kh/admin` rather than on its own hostname. The second
run sets `BASE_PATH=/admin` and asserts that no link, redirect, cookie or asset
escapes the prefix — the failure that would otherwise reach an editor as a 404 on
the public site.

---

## 3. The admin portal

Needs Postgres and a GitHub token. Roughly two minutes to set up.

### Step 1 — start Postgres

```bash
docker run -d --rm --name se4hc-devpg \
  -e POSTGRES_USER=se4hc \
  -e POSTGRES_PASSWORD=devpw \
  -e POSTGRES_DB=se4hc_admin \
  -p 55432:5432 \
  postgres:16-alpine
```

> **Port 55432, not 5432.** A Postgres installed on your machine will already
> own 5432, and you would silently connect to it instead — the symptom is
> `password authentication failed for user "se4hc"` even though the container is
> healthy. Use a port nothing else wants.

Confirm it is up:

```bash
docker exec se4hc-devpg pg_isready -U se4hc -d se4hc_admin
```

### Step 2 — create the sandbox branch

Once per clone, so saves cannot reach production:

```bash
git push origin main:cms-sandbox
```

### Step 3 — run the portal

```bash
cd services/admin

export DATABASE_URL="postgres://se4hc:devpw@localhost:55432/se4hc_admin"
export AUTH_SECRET="dev-secret-not-for-production"
export GITHUB_REPO="PoscarDigital/se4hc-website"
export GITHUB_BRANCH="cms-sandbox"          # never main
export GITHUB_TOKEN="$(gh auth token)"      # or paste a PAT
export BOOTSTRAP_ADMIN_PASSWORD="dev-password-123"
export STORAGE_DRIVER="github"              # no MinIO needed
export PORT=3000

npm run dev        # node --watch, restarts on save
```

Leave `BASE_PATH` unset and the portal owns the origin, which is the comfortable
way to work on it. Set it to reproduce what the server does:

```bash
export BASE_PATH="/admin"      # then browse to http://localhost:3000/admin
```

A healthy start looks like this:

```
"msg":"Created initial admin \"admin\". Password taken from BOOTSTRAP_ADMIN_PASSWORD..."
"msg":"GitHub OK — PoscarDigital/se4hc-website (cms-sandbox)"
"msg":"Server listening at http://127.0.0.1:3000"
```

The portal verifies repository access at boot and refuses to start otherwise —
better than appearing healthy and failing on someone's first save.

Sign in at **http://localhost:3000** with `admin` / `dev-password-123`. You will
be asked to change it immediately; that is the forced first-login rotation.

### What to try

| Page | What you should see |
| --- | --- |
| Dashboard | Live counts read from GitHub — 4 news, 6 reports, 5 resources, 4 events, 4 procurement, 16 FAQs |
| Content → Reports → `q4-2025-progress` | Khmer and English side by side, both attachments listed |
| Site data → Project figures | The quarterly numbers from `site.json` |
| Media | The 10 documents committed under `public/documents/` |
| Settings | Storage driver, live MinIO state, audit log |
| Users | Add an editor — the temporary password is shown once |

Saving an entry commits to `cms-sandbox`. Confirm with `git fetch && git log
origin/cms-sandbox --oneline -3`.

### Optional — MinIO

Only needed if you are working on uploads. Without it, `STORAGE_DRIVER=github`
commits files into the repo, which is a fully supported mode.

```bash
docker run -d --rm --name se4hc-devminio \
  -e MINIO_ROOT_USER=devroot \
  -e MINIO_ROOT_PASSWORD=devrootpw123 \
  -p 59000:9000 \
  minio/minio:latest server /data

# management UI (the maintained community fork)
docker run -d --rm --name se4hc-devconsole \
  -e CONSOLE_MINIO_SERVER=http://host.docker.internal:59000 \
  -p 59090:9090 \
  ghcr.io/georgmangold/console:latest
```

Then restart the portal with:

```bash
export STORAGE_DRIVER="auto"
export MINIO_ENDPOINT="http://localhost:59000"
export MINIO_BUCKET="se4hc-media"
export MINIO_ACCESS_KEY="devroot"
export MINIO_SECRET_KEY="devrootpw123"
export MINIO_PUBLIC_URL="http://localhost:59000/se4hc-media"
```

**Settings** should now report *"MinIO — configured and reachable"*. Stop the
MinIO container and reload: it falls back to the repository and recovers on its
own when you start it again. That is `auto` doing its job.

### Stopping

```bash
docker rm -f se4hc-devpg se4hc-devminio se4hc-devconsole
```

Data disappears with the containers (`--rm`), which is what you want for a
scratch environment.

---

## 4. The whole thing in Docker

Use this to test what actually ships — the real images, the real nginx routing, the
portal on the path production serves it from. It lives in the sibling deployment
repo.

```bash
cd ../se4hc-deployment
./scripts/local.sh up --build
```

That builds both images from this checkout, starts one nginx in front of them, and
runs the checks. Everything is on **one port**, as on the server:

| | URL |
| --- | --- |
| The public site | http://localhost:8080/ |
| The portal | http://localhost:8080/admin |

```bash
./scripts/local.sh smoke      # re-run the checks
./scripts/local.sh logs edge  # follow one service
./scripts/local.sh down       # stop and delete the local data
```

The checks cover what the dev server cannot, because neither nginx nor the mount
point exists there:

```
  ok   a missing page is a real 404                   404
  ok   /admin redirects when anonymous                302
  ok   the redirect keeps the prefix                  /admin/login?next=%2Fadmin
  ok   the portal's assets are mounted                200
  ok   no link escapes /admin
  ok   nosniff survives inside /admin                 nosniff
```

**Run this before pushing anything that touches the portal's links, routes or
views.** `npm test` proves the prefix holds for the views it can render without a
database; this proves it for the real thing, signed in, through nginx.

---

## Before you push

```bash
node scripts/check-translation-pairs.mjs                                    # both languages present
npm run build                                                               # types + content schema
cd services/admin && DATABASE_URL=x AUTH_SECRET=x GITHUB_TOKEN=x npm test   # admin logic
```

All three run in CI on every push. Passing locally means passing there.

**If you changed a content field**, update both sides of the model:

- `src/content/config.ts` — the Zod schema that validates the build
- `services/admin/src/schema.js` — the field definitions that render the form

They are two views of the same thing. A field the portal writes that the schema
rejects will fail CI, and the site will keep serving the previous version until
it is fixed.

---

## Troubleshooting

**`password authentication failed for user "se4hc"` — but the container is healthy**

Another Postgres owns the port. Check with `netstat -ano | grep 5432` (Windows)
or `sudo lsof -i :5432` (Linux/macOS); if two processes are listed, you are
talking to the wrong one. Use `-p 55432:5432` as above.

**The admin exits at boot with a GitHub error**

The token cannot see the repository, or lacks write access. `gh auth status`, or
check that a fine-grained PAT has **Contents: read and write**. The check is
deliberate — it fails at boot rather than on someone's first save.

**`npm run build` fails on a content file**

The frontmatter does not match `src/content/config.ts`. The error names the file
and field. Note that `lang:` is no longer read — an entry's language comes from
the folder it sits in.

**A page 404s in dev but the file exists**

Detail pages come from the collection filtered by language, so the entry must
exist in the folder matching the URL. `/news/foo/` needs
`src/content/news/km/foo.md`; `/en/news/foo/` needs the `en/` one.
`check-translation-pairs.mjs` catches this.

**The portal loads but every link goes to the website's 404 page**

`BASE_PATH` and the prefix nginx proxies disagree. The portal writes `BASE_PATH`
into every link it emits, and nginx passes `/admin` through to it rather than
stripping it, so the two have to be the same string. Check `BASE_PATH` in
`admin/.env` against the `location /admin` block in `nginx/routes.conf`.

The quick confirmation — every link on the login page should start with `/admin`:

```bash
curl -s http://localhost:8080/admin/login | grep -oE '(href|action)="/[^"]*"' | sort -u
```

**"curl: (23) client returned ERROR on write" from a deployment script**

Git Bash on Windows. The scripts disable MSYS path translation so container paths
survive, which also stops native `curl.exe` from understanding `/dev/null`.
`local.sh` turns translation back on for exactly this reason; a new script that
calls curl needs the same line.

**Port 4321 or 3000 already in use**

`npm run dev -- --port 4322` for the site; `PORT=3001` for the admin.

**Docker healthchecks report `unhealthy` on a container that works**

Probe `127.0.0.1`, not `localhost` — `localhost` resolves to `::1` first in
Alpine and neither nginx nor Node listens on IPv6. The shipped Dockerfiles
already do this.
