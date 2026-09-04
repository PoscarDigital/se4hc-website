#!/usr/bin/env node
/**
 * Fail the build when a content entry exists in one language but not the other.
 *
 * The site pairs translations by filename: `news/km/foo.md` and `news/en/foo.md`
 * are the same entry, and the language switcher builds the twin URL by swapping
 * the prefix. A missing counterpart produces a link to a 404 that nothing else
 * catches — the build succeeds and the gap only shows up in the browser.
 *
 * This matters more once editors work through the admin portal, where creating
 * one language and forgetting the other is an easy mistake to make.
 */
import { readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const CONTENT = new URL('../src/content/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const LOCALES = ['km', 'en'];

const entriesIn = (dir) =>
  existsSync(dir)
    ? readdirSync(dir).filter((f) => /\.mdx?$/.test(f) && statSync(join(dir, f)).isFile())
    : [];

let missing = 0;
let checked = 0;

const collections = readdirSync(CONTENT, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

for (const collection of collections) {
  const byLocale = Object.fromEntries(
    LOCALES.map((l) => [l, new Set(entriesIn(join(CONTENT, collection, l)))])
  );

  for (const locale of LOCALES) {
    const other = LOCALES.find((l) => l !== locale);
    for (const file of [...byLocale[locale]].sort()) {
      checked++;
      if (!byLocale[other].has(file)) {
        missing++;
        console.error(
          `  ${collection}/${locale}/${file}  ->  missing ${collection}/${other}/${file}`
        );
      }
    }
  }
}

if (missing > 0) {
  console.error(
    `\n${missing} untranslated entr${missing === 1 ? 'y' : 'ies'}. ` +
      `Every entry needs the same filename in both km/ and en/.`
  );
  process.exit(1);
}

console.log(`Translation pairs OK — ${checked / 2} entries across ${collections.length} collections.`);
