import { requireUser } from '../auth.js';
import { recordAudit } from '../db.js';
import { DATA_FILES, dataFileByName, getPath, setPath } from '../schema.js';
import { readDataFile, saveDataFile } from '../content.js';
import { expandForm, coerce } from '../formdata.js';
import { page, escapeHtml, field, flashFrom } from '../views/layout.js';

/**
 * The structured JSON files.
 *
 * site.json gets a proper form because its quarterly figures are the numbers
 * that actually change. The rest are edited as validated JSON: their shapes are
 * nested and bespoke, and they change a few times a year, so a hand-built form
 * for each would be a lot of surface area to maintain for very little use.
 */
export default async function dataRoutes(app) {
  app.get('/data', async (request, reply) => {
    if (!requireUser(request, reply)) return reply;

    return reply.type('text/html').send(
      page({
        title: 'Site data',
        user: request.user,
        active: '/data',
        flash: flashFrom(request.query),
        body: `
<h1>Site data</h1>
<p class="help">Figures, contacts and page sections that are not part of a content collection.</p>
<div class="cards">
${DATA_FILES.map(
  (file) => `<a class="card link" href="/data/${file.name}">
  <h2>${escapeHtml(file.label)}</h2>
  ${file.help ? `<p class="help">${escapeHtml(file.help)}</p>` : ''}
  <code>${escapeHtml(file.path)}</code>
</a>`
).join('')}
</div>`,
      })
    );
  });

  app.get('/data/:name', async (request, reply) => {
    if (!requireUser(request, reply)) return reply;
    const definition = dataFileByName(request.params.name);
    if (!definition) return reply.code(404).send('Unknown data file');

    const file = await readDataFile(definition.path);
    if (!file) return reply.code(404).send(`${definition.path} not found in the repository.`);

    const formFields = definition.form
      ? definition.form
          .map((f) =>
            field({
              ...f,
              name: f.path,
              value: getPath(file.value, f.path),
            })
          )
          .join('')
      : '';

    return reply.type('text/html').send(
      page({
        title: definition.label,
        user: request.user,
        active: '/data',
        flash: flashFrom(request.query),
        wide: true,
        body: `
<div class="page-head">
  <div>
    <a class="back" href="/data">← Site data</a>
    <h1>${escapeHtml(definition.label)}</h1>
    ${definition.help ? `<p class="help">${escapeHtml(definition.help)}</p>` : ''}
  </div>
</div>

${
  formFields
    ? `<form method="post" action="/data/${definition.name}" class="card">
  <h2>Quarterly figures</h2>
  ${formFields}
  <button class="btn primary" type="submit">Save and publish</button>
</form>`
    : ''
}

<form method="post" action="/data/${definition.name}/raw" class="card">
  <h2>${formFields ? 'Full file' : 'Edit'}</h2>
  <p class="help">Edited as JSON. It is checked for validity before saving, and the site build validates it again.</p>
  <textarea name="json" rows="26" class="code" spellcheck="false">${escapeHtml(JSON.stringify(file.value, null, 2))}</textarea>
  <button class="btn primary" type="submit">Save and publish</button>
</form>`,
      })
    );
  });

  app.post('/data/:name', async (request, reply) => {
    if (!requireUser(request, reply)) return reply;
    const definition = dataFileByName(request.params.name);
    if (!definition?.form) return reply.code(404).send('Unknown data file');

    const file = await readDataFile(definition.path);
    if (!file) return reply.code(404).send('File not found');

    const form = expandForm(request.body);
    const value = file.value;

    for (const f of definition.form) {
      // Form keys are dotted paths, which expandForm has already nested — read
      // the value back out the same way rather than off a flat key.
      const submitted = getPath(form, f.path);
      const coerced = coerce(submitted, f.type);
      if (coerced !== undefined) setPath(value, f.path, coerced);
    }

    const result = await saveDataFile({ path: definition.path, value, user: request.user, label: definition.label });
    await recordAudit({
      user: request.user,
      action: 'update_data',
      target: definition.path,
      commitSha: result?.commitSha,
    });

    return reply.redirect(`/data/${definition.name}?ok=Saved. A rebuild is running.`);
  });

  app.post('/data/:name/raw', async (request, reply) => {
    if (!requireUser(request, reply)) return reply;
    const definition = dataFileByName(request.params.name);
    if (!definition) return reply.code(404).send('Unknown data file');

    let value;
    try {
      value = JSON.parse(request.body?.json ?? '');
    } catch (error) {
      return reply.redirect(`/data/${definition.name}?error=${encodeURIComponent(`Invalid JSON: ${error.message}`)}`);
    }

    const result = await saveDataFile({ path: definition.path, value, user: request.user, label: definition.label });
    await recordAudit({
      user: request.user,
      action: 'update_data',
      target: definition.path,
      commitSha: result?.commitSha,
    });

    return reply.redirect(`/data/${definition.name}?ok=Saved. A rebuild is running.`);
  });
}
