import YAML from 'yaml';
import { listDir, readFile, commitFiles, authorFor } from './github.js';
import { LOCALES, collectionByName } from './schema.js';

/**
 * Reading and writing content entries.
 *
 * An entry is a pair of files that share a filename: `<collection>/km/<slug>.md`
 * and `<collection>/en/<slug>.md`. The filename is the slug, the route, and the
 * link between the two translations, so it is never derived from the title —
 * renaming an entry would break the published URL and orphan its translation.
 */

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export function parseEntry(text) {
  const match = text.match(FRONTMATTER);
  if (!match) return { data: {}, body: text.trim() };
  // Trim the blank line after the closing fence and the trailing newline, so
  // parse and serialize are exact inverses: a load-then-save with no edits
  // must not produce a diff, or every save would touch every file it opened.
  return { data: YAML.parse(match[1]) ?? {}, body: match[2].replace(/^\r?\n/, '').replace(/\s+$/, '') };
}

export function serializeEntry({ data, body }) {
  // Drop empty values rather than writing `field: null` — an absent optional
  // field and an explicitly null one are the same to the schema, and the file
  // stays readable for whoever opens it in the repo.
  const clean = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value) && value.length === 0) continue;
    clean[key] = value;
  }

  const yaml = YAML.stringify(clean, { lineWidth: 0, defaultStringType: 'QUOTE_DOUBLE', defaultKeyType: 'PLAIN' });
  return `---\n${yaml}---\n\n${(body ?? '').trim()}\n`;
}

const entryPath = (collection, locale, slug) => `src/content/${collection}/${locale}/${slug}.md`;

/**
 * List the entries in a collection, merging both languages into one row per
 * slug so a missing translation is visible at a glance rather than only when
 * CI rejects it.
 */
export async function listEntries(collectionName) {
  const collection = collectionByName(collectionName);
  if (!collection) return [];

  const perLocale = await Promise.all(
    LOCALES.map(async (locale) => {
      const files = await listDir(`${collection.folder}/${locale}`);
      return [locale, new Set(files.filter((f) => f.name.endsWith('.md')).map((f) => f.name.replace(/\.md$/, '')))];
    })
  );
  const byLocale = Object.fromEntries(perLocale);

  const slugs = new Set(LOCALES.flatMap((locale) => [...byLocale[locale]]));
  return [...slugs]
    .sort()
    .map((slug) => ({
      slug,
      locales: Object.fromEntries(LOCALES.map((l) => [l, byLocale[l].has(slug)])),
      complete: LOCALES.every((l) => byLocale[l].has(slug)),
    }));
}

/** Load both language files for one entry. Absent locales come back as null. */
export async function readEntry(collectionName, slug) {
  const collection = collectionByName(collectionName);
  if (!collection) return null;

  const loaded = await Promise.all(
    LOCALES.map(async (locale) => {
      const file = await readFile(entryPath(collectionName, locale, slug));
      return [locale, file ? { ...parseEntry(file.text), sha: file.sha } : null];
    })
  );
  return Object.fromEntries(loaded);
}

/**
 * Build the two files for an entry from submitted form values.
 *
 * Translatable fields take their per-locale value; everything else is written
 * identically to both files, so an editor sets `date` or `featured` once and
 * the two translations cannot drift apart on it.
 */
function filesForEntry(collection, slug, values) {
  return LOCALES.map((locale) => {
    const data = {};

    for (const field of collection.fields) {
      if (field.name === 'body') continue;
      const raw = field.translatable ? values[field.name]?.[locale] : values[field.name];
      if (raw === undefined || raw === null || raw === '') continue;
      data[field.name] = raw;
    }

    const body = collection.fields.find((f) => f.name === 'body')?.translatable
      ? values.body?.[locale]
      : values.body;

    return {
      path: entryPath(collection.name, locale, slug),
      content: serializeEntry({ data, body: body ?? '' }),
    };
  });
}

export async function saveEntry({ collectionName, slug, values, user, isNew }) {
  const collection = collectionByName(collectionName);
  if (!collection) throw new Error(`Unknown collection: ${collectionName}`);

  const files = filesForEntry(collection, slug, values);
  const verb = isNew ? 'Add' : 'Update';
  const title = values.title?.en || values.title?.km || slug;

  return commitFiles({
    files,
    message: `${verb} ${collection.label.toLowerCase()}: ${title}\n\nEdited by ${user.display_name || user.username} via the admin portal.`,
    author: authorFor(user),
  });
}

export async function deleteEntry({ collectionName, slug, user }) {
  const collection = collectionByName(collectionName);
  if (!collection) throw new Error(`Unknown collection: ${collectionName}`);

  const existing = await readEntry(collectionName, slug);
  const files = LOCALES.filter((locale) => existing?.[locale]).map((locale) => ({
    path: entryPath(collectionName, locale, slug),
    delete: true,
  }));
  if (!files.length) return null;

  return commitFiles({
    files,
    message: `Remove ${collection.label.toLowerCase()}: ${slug}\n\nDeleted by ${user.display_name || user.username} via the admin portal.`,
    author: authorFor(user),
  });
}

/** Slugs are the published URL, so keep them conservative and stable. */
export function normalizeSlug(input) {
  return String(input)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/** Read one of the structured JSON files. */
export async function readDataFile(path) {
  const file = await readFile(path);
  if (!file) return null;
  return { value: JSON.parse(file.text), sha: file.sha, text: file.text };
}

export async function saveDataFile({ path, value, user, label }) {
  return commitFiles({
    files: [{ path, content: `${JSON.stringify(value, null, 2)}\n` }],
    message: `Update ${label}\n\nEdited by ${user.display_name || user.username} via the admin portal.`,
    author: authorFor(user),
  });
}
