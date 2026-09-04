/**
 * Expand flat form keys into the nested shape the content layer expects.
 *
 * Browsers submit a flat map, so per-locale and repeating fields are encoded in
 * the field name and reassembled here:
 *
 *   title.km            -> { title: { km: ... } }
 *   attachments[0][file] -> { attachments: [ { file: ... } ] }
 *
 * Array indices are compacted, so removing the middle row of a repeating group
 * in the browser does not leave a hole.
 */

const BRACKET = /^([^[]+)\[(\d+)\]\[([^\]]+)\]$/;

export function expandForm(flat) {
  const out = {};
  const groups = {};

  for (const [key, rawValue] of Object.entries(flat ?? {})) {
    const value = Array.isArray(rawValue) ? rawValue[rawValue.length - 1] : rawValue;

    const bracket = key.match(BRACKET);
    if (bracket) {
      const [, name, index, prop] = bracket;
      groups[name] ??= {};
      groups[name][index] ??= {};
      groups[name][index][prop] = value;
      continue;
    }

    if (key.includes('.')) {
      const parts = key.split('.');
      const last = parts.pop();
      let target = out;
      for (const part of parts) {
        if (typeof target[part] !== 'object' || target[part] === null) target[part] = {};
        target = target[part];
      }
      target[last] = value;
      continue;
    }

    out[key] = value;
  }

  for (const [name, indexed] of Object.entries(groups)) {
    out[name] = Object.keys(indexed)
      .sort((a, b) => Number(a) - Number(b))
      .map((index) => indexed[index]);
  }

  return out;
}

/** Coerce a submitted value to the type the content schema expects. */
export function coerce(value, type) {
  switch (type) {
    case 'boolean':
      return value === 'true' || value === 'on' || value === true;
    case 'number': {
      if (value === '' || value === undefined || value === null) return undefined;
      const number = Number(value);
      return Number.isFinite(number) ? number : undefined;
    }
    case 'date':
      // Kept as a plain YYYY-MM-DD string: the site's schema coerces it, and a
      // bare date avoids YAML turning it into a timezone-bearing timestamp.
      return value ? String(value).slice(0, 10) : undefined;
    default:
      return value === '' ? undefined : value;
  }
}

/** Clean up the attachments group: drop blank rows, coerce flags and sizes. */
export function normalizeAttachments(rows = []) {
  return rows
    .filter((row) => row && String(row.file ?? '').trim() !== '')
    .map((row) => {
      const attachment = { file: String(row.file).trim() };
      if (row.label) attachment.label = String(row.label).trim();
      if (row.featured === 'true' || row.featured === true) attachment.featured = true;
      const size = Number(row.size);
      if (Number.isFinite(size) && size > 0) attachment.size = size;
      return attachment;
    });
}
