# SE4HC Project Website

Public website for **SE4HC** — *Secondary Education for Human Capital Competitiveness*, a
Ministry of Education, Youth and Sport (MoEYS) project financed by the Asian Development Bank
(ADB Loan 4517-CAM(COL)).

The site publishes project information, progress reports, procurement notices, news, resources
and FAQs in **Khmer and English**, and ships with an admin portal so staff can maintain the
content themselves.

- **Stack:** [Astro 4](https://astro.build) (static output) + [Tailwind CSS 3](https://tailwindcss.com) + TypeScript
- **Admin:** Node + Fastify + Postgres, in `services/admin/`
- **Hosting:** Docker Compose on Ubuntu; images built by GitHub Actions and published to GHCR

## How the pieces fit together

```
                    ┌──────────────────────────────────────────┐
   editor  ────────▶│  Admin portal        (Stack B)           │
   signs in         │  username/password in Postgres           │
                    └────────────────┬─────────────────────────┘
                                     │ commits content
                                     ▼
                    ┌──────────────────────────────────────────┐
                    │  GitHub — the source of truth            │
                    └────────────────┬─────────────────────────┘
                                     │ push triggers CI
                                     ▼
                    ┌──────────────────────────────────────────┐
                    │  Actions: astro check → build → GHCR     │
                    └────────────────┬─────────────────────────┘
                                     │ server pulls image
                                     ▼
   visitor  ───────▶│  Public website      (Stack A)           │
```

Two properties follow from this shape, and both are deliberate:

- **GitHub holds the content, not the database.** The admin database stores accounts, sessions
  and an audit trail. Losing it costs you logins, not the website.
- **Bad content cannot reach production.** CI runs `astro check`, which validates every entry
  against the content schema. A malformed edit fails the build, no image is published, and the
  server keeps serving the last good one.

---

## Quick start (development)

Requires **Node.js 20+** and npm.

```bash
npm install       # install dependencies
npm run dev       # dev server at http://localhost:4321
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the dev server with hot reload |
| `npm run build` | Type-check (`astro check`) then build the static site into `dist/` |
| `npm run preview` | Serve the built `dist/` as production will |
| `node scripts/check-translation-pairs.mjs` | Fail if any entry is missing a translation |

Run the build before pushing — it type-checks and validates all frontmatter against the
schemas, catching most content mistakes before CI does.

---

## Deployment

Deployment lives in a separate repository, **`se4hc-deployment`**, so operational
configuration and secrets stay out of the application's history. It holds two independent
Compose stacks, their `.env` files, and the persistent data, logs and backup directories.

This repository's only deployment artifacts are the two Dockerfiles and `docker/nginx.conf`,
which are baked into the images.

| Stack | What runs | Publishes |
| --- | --- | --- |
| **A — website** | `web` (nginx + built site), `caddy` | The public site |
| **B — admin** | `admin`, `db` (Postgres), `caddy`, optional `minio` + `console` | The editor portal |

```bash
cd ../se4hc-deployment
./scripts/update.sh website          # pull the latest image and restart
./scripts/update.sh admin --minio
```

See that repository's README for first-time setup, backups and rollback.

### CI

`.github/workflows/build-images.yml` runs on every push to `main`:

1. Check every entry exists in both languages
2. `npm run build` — `astro check` plus the static build
3. Build and push `ghcr.io/<owner>/se4hc-web`
4. Test and push `ghcr.io/<owner>/se4hc-admin`

Images are tagged `latest` and with the full commit SHA, so a rollback is a tag change.
Pull requests run steps 1–2 without publishing.

**Bad content cannot reach production**: a schema violation fails step 2, no image is
published, and the server keeps serving the last good one.

---

## File storage — MinIO or GitHub

Uploads go to one of two places, and content renders identically either way:

| Driver | Where bytes go | What is committed |
| --- | --- | --- |
| `minio` | The bucket | An absolute URL |
| `github` | `public/documents/…` in the repo | The file itself |

`STORAGE_DRIVER` picks between them, and an administrator can change it at runtime under
**Settings → File storage**:

- **`auto`** (default) — use MinIO when it is configured *and* answering; otherwise commit into
  the repository. A deployment without object storage works unchanged, and a MinIO outage
  degrades to a slower upload rather than a failed one.
- **`minio`** — always MinIO; fail rather than fall back.
- **`github`** — always the repository, as before MinIO existed.

Changing the setting only affects new uploads. Existing files keep working.

### Why remote files need a manifest

A file in the repo can be measured at build time with `statSync`. A file in MinIO cannot —
the object store sits on your private server and GitHub Actions cannot reach it.

So the portal records each upload's size and MIME type in `src/data/media-manifest.json` and
commits it alongside the content. The build reads that manifest for remote files, stats the
disk for local ones, and shows no size if neither is available. **The build therefore needs no
network access to your server.**

> `MINIO_PUBLIC_URL` is written into committed frontmatter, so it must be publicly reachable
> and stable. Changing it later orphans every URL already stored in content.

---

## Project structure

```
public/                     Static assets, copied to the site root as-is
  images/                     Logos and gallery images
  documents/                  Files committed to the repo (the `github` driver)

src/
  pages/                    Routes. Khmer at the root, English under /en
  layouts/                  BaseLayout → PageLayout / ContentLayout
  components/
    pages/                    One Body component per page, shared by both languages
    sections/                 Hero, stats, gallery, video, FAQ accordion, quick links
    cards/ media/ common/ ui/ Cards, attachment viewer, chrome, primitives
  content/                  Markdown content collections
    config.ts                 Zod frontmatter schemas — the source of truth
  data/                     Structured JSON content
    i18n/                     UI string translations (km.json / en.json)
    media-manifest.json       Machine-written; metadata for files held in MinIO
  utils/
    content.ts                langOf() / inLang() — language comes from the folder
    attachments.ts            Resolves a reference, local or remote, to render-ready metadata
    i18n.ts helpers.ts        Translation lookup, formatting, asset paths

services/admin/             The admin portal (see below)
docker/nginx.conf           nginx config baked into the website image
scripts/                    Build-time validation
```

---

## How content is structured

Content lives in three places, chosen by shape rather than by page:

| Kind | Location | Use for |
| --- | --- | --- |
| **Markdown collections** | `src/content/<collection>/<lang>/` | Repeating, dated, listable items with a body |
| **Structured JSON** | `src/data/*.json` | Fixed page data: figures, contacts, navigation, partners |
| **UI strings** | `src/data/i18n/km.json`, `en.json` | Labels, headings and microcopy |

### 1. Markdown collections

```
src/content/{news,reports,resources,events,procurement,faqs}/{km,en}/*.md
```

**The filename is the slug and the translation key.** `news/en/fast-track-pilot.md` and
`news/km/fast-track-pilot.md` are the same entry in two languages, becoming
`/en/news/fast-track-pilot/` and `/news/fast-track-pilot/`. `check-translation-pairs.mjs`
enforces that both exist, and CI fails if one is missing.

**Language comes from the folder, not the frontmatter.** `langOf()` in `src/utils/content.ts`
reads it from the path. A `lang:` field is still accepted for backward compatibility, but
nothing reads it — the portal writes one form into both files and has no way to vary a single
field per locale, so a frontmatter tag that disagreed with its folder would be a silent bug.

Shared base frontmatter, defined in `src/content/config.ts`:

| Field | Type | Notes |
| --- | --- | --- |
| `title`* | string | Entry heading — for FAQs, the question |
| `excerpt` | string | Teaser shown on listing pages |
| `date` | date | ISO `YYYY-MM-DD` |
| `category` | string | Free-form tag / grouping |
| `status` | enum | `new`, `updated`, `archived`, `active`, `closing`, `awarded`, `upcoming`, `ongoing`, `completed` |
| `featured` | boolean | Highlight on listings |
| `order` | number | Manual sort weight, lower first |
| `featureImage` | string | Path under `/public`, or an absolute URL |
| `featureImageAlt` | string | Alt text |
| `attachments` | array | Downloadable files (below) |

Collection-specific extras:

- **reports** — `type` (`progress`/`financial`/`technical`/`review`/`baseline`/`engagement`), `pages`
- **resources** — `type` (free-form label)
- **events** — `dateLabel` (e.g. "Q1 2026"), `location`
- **procurement** — `type` (`works`/`goods`/`consulting`/`non-consulting`/`individual`), `value`, `method`, `contracts`
- **faqs** — base only: `title` is the question, the body is the answer, `category` groups them

#### Attachments

```yaml
attachments:
  - file: /documents/reports/SE4HC_PAM.pdf        # repo path...
    label: "Project Administration Manual"
    featured: true                                # primary file, previewed first
  - file: https://files.example.org/media/x.pdf   # ...or an absolute URL
    label: "Q4 Report"
    size: 8048390                                 # bytes, recorded at upload
```

Type and icon are always derived from the extension. Size comes from the `size` field, then
the media manifest, then the file on disk — so repo files need no `size`, and remote ones
carry it. A missing file simply shows no size rather than breaking the build.

### 2. Structured JSON (`src/data/`)

| File | Contents |
| --- | --- |
| `site.json` | Loan figures, key dates, targets, and `currentProgress` — **the quarterly numbers** |
| `project-stats.json` | `overview`, `progress`, `outputs`, `infrastructure` stat groups |
| `page-content.json` | Longer sections for the Procurement, Resources and About pages |
| `navigation.json` | `main` nav, `quickLinks`, `footer` links |
| `contacts.json` `partners.json` `stakeholders.json` | Contact blocks, partner lists, stakeholder groups |
| `gallery.json` | Homepage slideshow and video |
| `media-manifest.json` | Machine-written — do not edit by hand |

Bilingual values are objects keyed by language:

```json
{ "caption": { "km": "សកម្មភាពគម្រោង", "en": "Project activity" } }
```

**The homepage video** (`gallery.json` → `video`) takes *either* `youtube` (a full URL or
11-character ID, which wins if both are set) *or* `src` (a local file). Leave both empty for
the placeholder.

### 3. UI strings (`src/data/i18n/`)

Looked up with dotted key paths:

```astro
const t = useTranslations('en');
<h1>{t('news.title')}</h1>
```

A missing key renders as the key itself rather than throwing, so an untranslated string shows
up as `news.title` on the page. **Add every new key to both files.**

---

## Bilingual routing

Khmer is the default locale, served **without a prefix**; English lives under **`/en`**.

| Khmer | English |
| --- | --- |
| `/` | `/en` |
| `/news/` | `/en/news/` |
| `/reports/q4-2025-progress/` | `/en/reports/q4-2025-progress/` |

Each route is a pair of thin page files sharing one Body component:

```astro
<!-- src/pages/news/index.astro -->      <NewsBody lang="km" />
<!-- src/pages/en/news/index.astro -->   <NewsBody lang="en" />
```

**Adding a page means adding both files**, plus the shared
`src/components/pages/<Name>Body.astro` and labels in both i18n files.

Helpers in `src/utils/i18n.ts`: `getLangFromUrl`, `useTranslations`, `getLocalizedPath`,
`getRoutePath`, `getAlternatePath`.

---

## The admin portal

`services/admin/` — Fastify, server-rendered HTML, no client framework or build step.

```
src/config.js        Environment parsing; fails fast on missing required values
src/db.js            Postgres schema: users, sessions, settings, audit_log
src/auth.js          scrypt passwords, server-side revocable sessions, role guards
src/github.js        Contents + Git Data API client
src/content.js       Frontmatter (de)serialization, entry CRUD
src/schema.js        Field definitions — MIRRORS src/content/config.ts
src/storage/         Upload drivers: minio, github, and the auto switch
src/routes/          auth, entries, data, media, users, settings
src/views/layout.js  HTML shell and form widgets
test/                Logic and boot tests — `npm test`
```

Notable behaviours:

- **One save is one commit.** An entry touches two files (km and en); they are written through
  the Git Data API as a single commit, so a save produces one CI build, not two.
- **Passwords** use scrypt from Node's standard library. Sessions are server-side and
  revocable — the cookie holds a random token, the database only its HMAC.
- **Every change is attributed.** Commits carry the editor's name, and `audit_log` records who
  did what and which commit carried it.
- **Slugs are immutable** once created. They are the published URL and the translation key.

> `services/admin/src/schema.js` and `src/content/config.ts` are two views of the same model —
> one renders the form, the other validates the build. **When you change one, change the
> other.** A field the portal writes that the schema rejects will fail CI.

### Tests

```bash
cd services/admin
DATABASE_URL=postgres://x@localhost/x AUTH_SECRET=x GITHUB_TOKEN=x npm test
```

Covers frontmatter round-tripping (including Khmer), form expansion, type coercion, the route
tree, and the auth guards. Neither suite touches Postgres or the GitHub API.

---

## Common tasks

**Publish a news item / report / resource** — Admin → Content → the collection → New entry.
Fill in both languages, attach files, save. Or add the Markdown to both `km/` and `en/` under
the same filename.

**Update the quarterly progress figures** — Admin → Site data → Project figures. Directly:
`currentProgress` in `src/data/site.json` (and bump `asOf`).

**Add an editor** — Admin → Users → Add a user. The temporary password is shown once.

**Switch file storage** — Admin → Settings → File storage.

**Change a label or heading** — edit `src/data/i18n/km.json` *and* `en.json`. Not exposed in
the portal: these are sitewide plumbing where a mistake breaks every page.

**Replace the gallery placeholders** — upload images, then point `slides` in `gallery.json` at
them. The three `placeholder-*.svg` files are stand-ins.

---

## Notes

- `.gitattributes` normalizes line endings to LF and marks binary types, so PDFs, Office
  documents and images survive Windows checkouts intact.
- `dist/`, `node_modules/` and `.astro/` are generated and git-ignored.
- `public/CNAME` is left over from GitHub Pages hosting and is unused by the Docker deployment.
