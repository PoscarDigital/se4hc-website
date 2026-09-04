import { requireUser } from '../auth.js';
import { recordAudit } from '../db.js';
import { COLLECTIONS, collectionByName, LOCALES } from '../schema.js';
import { listEntries, readEntry, saveEntry, deleteEntry, normalizeSlug } from '../content.js';
import { expandForm, coerce, normalizeAttachments } from '../formdata.js';
import { page, escapeHtml, field, attachmentsField, flashFrom } from '../views/layout.js';

const LOCALE_NAMES = { km: 'ខ្មែរ (Khmer)', en: 'English' };

function collectionTabs(active) {
  return `<nav class="tabs">${COLLECTIONS.map(
    (c) => `<a href="/collections/${c.name}" class="${c.name === active ? 'active' : ''}">${escapeHtml(c.label)}</a>`
  ).join('')}</nav>`;
}

/** Render one schema field, doubled into two columns when it is translatable. */
function renderField(definition, values, collection) {
  const text =
    definition.name === 'title' && collection.titleLabel
      ? collection.titleLabel
      : definition.name === 'body' && collection.bodyLabel
        ? collection.bodyLabel
        : definition.label;

  if (definition.name === 'attachments') {
    return attachmentsField(values.attachments ?? []);
  }

  if (!definition.translatable) {
    return field({ ...definition, label: text, value: values[definition.name] });
  }

  return `<div class="bilingual">
${LOCALES.map((locale) =>
  field({
    ...definition,
    name: `${definition.name}.${locale}`,
    label: `${text} — ${LOCALE_NAMES[locale]}`,
    value: values[definition.name]?.[locale],
    khmer: locale === 'km',
  })
).join('')}
</div>`;
}

/**
 * Fold the two language files back into one set of form values.
 *
 * Translatable fields become `{ km, en }`; shared fields take the Khmer file's
 * value, falling back to English, since the two are written identically and
 * either may be missing while a translation is still being added.
 */
function valuesFromEntry(collection, entry) {
  const values = {};
  for (const definition of collection.fields) {
    const read = (locale) =>
      definition.name === 'body' ? entry?.[locale]?.body : entry?.[locale]?.data?.[definition.name];

    if (definition.translatable) {
      values[definition.name] = Object.fromEntries(LOCALES.map((locale) => [locale, read(locale) ?? '']));
    } else {
      values[definition.name] = read('km') ?? read('en') ?? '';
    }
  }
  values.attachments = entry?.km?.data?.attachments ?? entry?.en?.data?.attachments ?? [];
  return values;
}

/** Turn a submitted form into the values `saveEntry` writes out. */
function valuesFromForm(collection, body) {
  const form = expandForm(body);
  const values = {};

  for (const definition of collection.fields) {
    if (definition.name === 'attachments') continue;

    if (definition.translatable) {
      values[definition.name] = Object.fromEntries(
        LOCALES.map((locale) => [locale, coerce(form[definition.name]?.[locale], definition.type)])
      );
    } else {
      values[definition.name] = coerce(form[definition.name], definition.type);
    }
  }

  values.attachments = normalizeAttachments(form.attachments);
  return values;
}

function editorView({ collection, slug, values, user, isNew, flash }) {
  const heading = isNew ? `New ${collection.label.replace(/s$/, '').toLowerCase()}` : escapeHtml(slug);

  return page({
    title: heading,
    user,
    active: '/collections',
    flash,
    wide: true,
    body: `
<div class="page-head">
  <div>
    <a class="back" href="/collections/${collection.name}">← ${escapeHtml(collection.label)}</a>
    <h1>${heading}</h1>
    ${collection.help ? `<p class="help">${escapeHtml(collection.help)}</p>` : ''}
  </div>
  ${
    isNew
      ? ''
      : `<form method="post" action="/collections/${collection.name}/entry/${encodeURIComponent(slug)}/delete"
           onsubmit="return confirm('Delete this entry in both languages? This cannot be undone from the portal.')">
      <button class="btn danger" type="submit">Delete</button>
    </form>`
  }
</div>

<form method="post" action="/collections/${collection.name}/${isNew ? 'new' : `entry/${encodeURIComponent(slug)}`}">
  ${
    isNew
      ? `<div class="card">
${field({
  type: 'text',
  name: 'slug',
  label: 'Slug',
  required: true,
  help: 'Used in the page URL and to pair the two languages. Lowercase letters, numbers and hyphens. It cannot be changed later without breaking the published link.',
})}
</div>`
      : `<input type="hidden" name="slug" value="${escapeHtml(slug)}">`
  }

  <div class="card">
    ${collection.fields.map((definition) => renderField(definition, values, collection)).join('\n')}
  </div>

  <div class="actions">
    <button class="btn primary" type="submit">${isNew ? 'Create' : 'Save'} and publish</button>
    <a class="btn secondary" href="/collections/${collection.name}">Cancel</a>
    <p class="help">Saving commits to GitHub and starts a rebuild. The change appears on the site in a minute or two.</p>
  </div>
</form>`,
  });
}

export default async function entryRoutes(app) {
  app.get('/collections/:name', async (request, reply) => {
    if (!requireUser(request, reply)) return reply;
    const collection = collectionByName(request.params.name);
    if (!collection) return reply.code(404).send('Unknown collection');

    const entries = await listEntries(collection.name);
    const incomplete = entries.filter((e) => !e.complete).length;

    const rows = entries.length
      ? entries
          .map(
            (entry) => `<tr>
  <td><a href="/collections/${collection.name}/entry/${encodeURIComponent(entry.slug)}">${escapeHtml(entry.slug)}</a></td>
  ${LOCALES.map(
    (locale) =>
      `<td class="center">${entry.locales[locale] ? '<span class="ok">✓</span>' : '<span class="missing">missing</span>'}</td>`
  ).join('')}
</tr>`
          )
          .join('')
      : `<tr><td colspan="3" class="empty">No entries yet.</td></tr>`;

    return reply.type('text/html').send(
      page({
        title: collection.label,
        user: request.user,
        active: '/collections',
        flash: flashFrom(request.query),
        body: `
<div class="page-head">
  <h1>${escapeHtml(collection.label)} <span class="km">${escapeHtml(collection.labelKm)}</span></h1>
  <a class="btn primary" href="/collections/${collection.name}/new">New entry</a>
</div>
${collectionTabs(collection.name)}
${
  incomplete
    ? `<div class="flash warn">${incomplete} entr${incomplete === 1 ? 'y is' : 'ies are'} missing a translation. The site build rejects these, so they will block publishing until both languages exist.</div>`
    : ''
}
<table class="list">
  <thead><tr><th>Slug</th>${LOCALES.map((l) => `<th class="center">${escapeHtml(LOCALE_NAMES[l])}</th>`).join('')}</tr></thead>
  <tbody>${rows}</tbody>
</table>`,
      })
    );
  });

  app.get('/collections/:name/new', async (request, reply) => {
    if (!requireUser(request, reply)) return reply;
    const collection = collectionByName(request.params.name);
    if (!collection) return reply.code(404).send('Unknown collection');

    return reply.type('text/html').send(
      editorView({
        collection,
        slug: '',
        values: valuesFromEntry(collection, null),
        user: request.user,
        isNew: true,
        flash: flashFrom(request.query),
      })
    );
  });

  app.post('/collections/:name/new', async (request, reply) => {
    if (!requireUser(request, reply)) return reply;
    const collection = collectionByName(request.params.name);
    if (!collection) return reply.code(404).send('Unknown collection');

    const slug = normalizeSlug(request.body?.slug ?? '');
    if (!slug) return reply.redirect(`/collections/${collection.name}/new?error=A valid slug is required.`);

    const existing = await readEntry(collection.name, slug);
    if (existing && LOCALES.some((locale) => existing[locale])) {
      return reply.redirect(
        `/collections/${collection.name}/new?error=${encodeURIComponent(`An entry with the slug "${slug}" already exists.`)}`
      );
    }

    const values = valuesFromForm(collection, request.body);
    const result = await saveEntry({ collectionName: collection.name, slug, values, user: request.user, isNew: true });
    await recordAudit({
      user: request.user,
      action: 'create_entry',
      target: `${collection.name}/${slug}`,
      commitSha: result?.commitSha,
    });

    return reply.redirect(
      `/collections/${collection.name}/entry/${encodeURIComponent(slug)}?ok=Created. A rebuild is running.`
    );
  });

  app.get('/collections/:name/entry/:slug', async (request, reply) => {
    if (!requireUser(request, reply)) return reply;
    const collection = collectionByName(request.params.name);
    if (!collection) return reply.code(404).send('Unknown collection');

    const entry = await readEntry(collection.name, request.params.slug);
    if (!entry || LOCALES.every((locale) => !entry[locale])) return reply.code(404).send('Entry not found');

    return reply.type('text/html').send(
      editorView({
        collection,
        slug: request.params.slug,
        values: valuesFromEntry(collection, entry),
        user: request.user,
        isNew: false,
        flash: flashFrom(request.query),
      })
    );
  });

  app.post('/collections/:name/entry/:slug', async (request, reply) => {
    if (!requireUser(request, reply)) return reply;
    const collection = collectionByName(request.params.name);
    if (!collection) return reply.code(404).send('Unknown collection');

    const slug = request.params.slug;
    const values = valuesFromForm(collection, request.body);
    const result = await saveEntry({ collectionName: collection.name, slug, values, user: request.user, isNew: false });
    await recordAudit({
      user: request.user,
      action: 'update_entry',
      target: `${collection.name}/${slug}`,
      commitSha: result?.commitSha,
    });

    return reply.redirect(
      `/collections/${collection.name}/entry/${encodeURIComponent(slug)}?ok=Saved. A rebuild is running.`
    );
  });

  app.post('/collections/:name/entry/:slug/delete', async (request, reply) => {
    if (!requireUser(request, reply)) return reply;
    const collection = collectionByName(request.params.name);
    if (!collection) return reply.code(404).send('Unknown collection');

    const result = await deleteEntry({ collectionName: collection.name, slug: request.params.slug, user: request.user });
    await recordAudit({
      user: request.user,
      action: 'delete_entry',
      target: `${collection.name}/${request.params.slug}`,
      commitSha: result?.commitSha,
    });

    return reply.redirect(`/collections/${collection.name}?ok=Entry deleted.`);
  });
}
