/**
 * Server-rendered HTML.
 *
 * No client framework and no build step: the portal is a small number of forms,
 * and keeping it plain means the image stays tiny and there is nothing to keep
 * upgrading. Khmer and English content sit side by side in every editor, so the
 * stylesheet loads a Khmer face and the editor grid is two columns.
 */

import { withBase } from '../paths.js';

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const NAV = [
  { href: '/', label: 'Dashboard' },
  { href: '/collections/news', label: 'Content', match: '/collections' },
  { href: '/data', label: 'Site data' },
  { href: '/media', label: 'Media' },
  { href: '/settings', label: 'Settings', adminOnly: true },
  { href: '/users', label: 'Users', adminOnly: true },
];

export function page({ title, user, active = '', body, flash = null, wide = false }) {
  const nav = NAV.filter((item) => !item.adminOnly || user?.role === 'admin')
    .map((item) => {
      const isActive = active === (item.match ?? item.href);
      return `<a href="${item.href}" class="${isActive ? 'active' : ''}">${escapeHtml(item.label)}</a>`;
    })
    .join('');

  // Links throughout the portal are written root-relative; withBase() is where
  // the mount point is applied, once, to the finished document.
  return withBase(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — SE4HC Admin</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Battambang:wght@400;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/static/admin.css">
</head>
<body>
${
  user
    ? `<header class="topbar">
  <div class="brand"><a href="/">SE4HC <span>Admin</span></a></div>
  <nav>${nav}</nav>
  <div class="who">
    <a href="/account">${escapeHtml(user.display_name || user.username)}</a>
    <form method="post" action="/logout"><button class="link">Sign out</button></form>
  </div>
</header>`
    : ''
}
<main class="${wide ? 'wide' : ''}">
${flash ? `<div class="flash ${flash.type}">${escapeHtml(flash.message)}</div>` : ''}
${body}
</main>
<script src="/static/admin.js" defer></script>
</body>
</html>`);
}

/* ---------------------------------------------------------------- widgets -- */

const label = (id, text, help) =>
  `<label for="${id}">${escapeHtml(text)}</label>${help ? `<p class="help">${escapeHtml(help)}</p>` : ''}`;

/**
 * Render one form field.
 *
 * `name` is the submitted key. Translatable fields are rendered once per
 * locale by the caller with names like `title.km`, which the body parser
 * reassembles into a nested object.
 */
export function field({ type, name, value, label: text, help, options = [], required = false, rows = 4, khmer = false }) {
  const id = `f_${name.replace(/[^a-z0-9]/gi, '_')}`;
  const safeValue = escapeHtml(value ?? '');
  const cls = khmer ? ' class="khmer"' : '';
  const req = required ? ' required' : '';

  switch (type) {
    case 'textarea':
    case 'markdown':
      return `<div class="field">${label(id, text, help)}
<textarea id="${id}" name="${name}" rows="${type === 'markdown' ? 18 : rows}"${cls}${req}>${safeValue}</textarea></div>`;

    case 'boolean':
      return `<div class="field checkbox">
<input type="checkbox" id="${id}" name="${name}" value="true"${value ? ' checked' : ''}>
<label for="${id}">${escapeHtml(text)}</label>
${help ? `<p class="help">${escapeHtml(help)}</p>` : ''}</div>`;

    case 'select':
      return `<div class="field">${label(id, text, help)}
<select id="${id}" name="${name}">${options
        .map(
          (option) =>
            `<option value="${escapeHtml(option)}"${String(value ?? '') === String(option) ? ' selected' : ''}>${
              option === '' ? '— none —' : escapeHtml(option)
            }</option>`
        )
        .join('')}</select></div>`;

    case 'number':
      return `<div class="field">${label(id, text, help)}
<input type="number" step="any" id="${id}" name="${name}" value="${safeValue}"${req}></div>`;

    case 'date':
      return `<div class="field">${label(id, text, help)}
<input type="date" id="${id}" name="${name}" value="${escapeHtml(String(value ?? '').slice(0, 10))}"${req}></div>`;

    case 'image':
      return `<div class="field">${label(id, text, help)}
<div class="media-field">
  <input type="text" id="${id}" name="${name}" value="${safeValue}" placeholder="/images/... or https://...">
  <button type="button" class="btn secondary pick-media" data-target="${id}">Choose…</button>
</div>
${value ? `<img class="preview" src="${safeValue}" alt="">` : ''}</div>`;

    default:
      return `<div class="field">${label(id, text, help)}
<input type="text" id="${id}" name="${name}" value="${safeValue}"${cls}${req}></div>`;
  }
}

/**
 * The attachments editor.
 *
 * Rows are a repeating group serialised as `attachments[i][field]`. Size is
 * carried through as a hidden value: it is captured at upload time because a
 * file held in object storage cannot be measured during the site build.
 */
export function attachmentsField(attachments = []) {
  const row = (item = {}, index) => `
<div class="attachment-row" data-index="${index}">
  <div class="attachment-main">
    <input type="text" name="attachments[${index}][file]" value="${escapeHtml(item.file ?? '')}" placeholder="/documents/... or https://..." class="att-file">
    <button type="button" class="btn secondary pick-media" data-target-row="${index}">Choose…</button>
  </div>
  <input type="text" name="attachments[${index}][label]" value="${escapeHtml(item.label ?? '')}" placeholder="Label shown to visitors">
  <label class="inline"><input type="checkbox" name="attachments[${index}][featured]" value="true"${
    item.featured ? ' checked' : ''
  }> Primary</label>
  <input type="hidden" name="attachments[${index}][size]" value="${escapeHtml(item.size ?? '')}" class="att-size">
  <button type="button" class="btn danger remove-attachment">Remove</button>
</div>`;

  return `<div class="field">
<label>Attachments</label>
<p class="help">Files offered for download. The primary one is previewed first.</p>
<div id="attachments">${attachments.map(row).join('')}</div>
<template id="attachment-template">${row({}, '__INDEX__')}</template>
<button type="button" class="btn secondary" id="add-attachment">Add attachment</button>
</div>`;
}

export const flashFrom = (query) =>
  query.ok ? { type: 'ok', message: query.ok } : query.error ? { type: 'error', message: query.error } : null;

export const redirectWith = (reply, path, params) => {
  const search = new URLSearchParams(params).toString();
  reply.redirect(search ? `${path}?${search}` : path);
};
