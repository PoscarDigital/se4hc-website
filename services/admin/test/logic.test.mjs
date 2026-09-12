import { parseEntry, serializeEntry, normalizeSlug } from '../src/content.js';
import { expandForm, coerce, normalizeAttachments } from '../src/formdata.js';
import { getPath, setPath } from '../src/schema.js';
import { applyBase, withBase } from '../src/paths.js';
import { page } from '../src/views/layout.js';

let pass = 0, fail = 0;
const check = (name, cond, extra='') => {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '  -> ' + extra : '')); }
};

console.log('\n-- frontmatter round-trip --');
const original = `---
title: "Quarterly Progress Report Q4 2025"
date: "2026-01-15"
type: "progress"
pages: 69
featured: true
attachments:
  - file: "/documents/reports/x.pdf"
    label: "Q4 (PDF)"
    featured: true
    size: 8048390
---

Body **text** here.

## Heading
`;
const parsed = parseEntry(original);
check('title parsed', parsed.data.title === 'Quarterly Progress Report Q4 2025', parsed.data.title);
check('number parsed', parsed.data.pages === 69);
check('bool parsed', parsed.data.featured === true);
check('attachment size parsed', parsed.data.attachments[0].size === 8048390);
check('body parsed', parsed.body.startsWith('Body **text** here.'));

const round = parseEntry(serializeEntry(parsed));
check('round-trip title', round.data.title === parsed.data.title);
check('round-trip pages', round.data.pages === 69);
check('round-trip attachment', round.data.attachments[0].file === '/documents/reports/x.pdf');
check('round-trip body', round.body.trim() === parsed.body.trim());

console.log('\n-- Khmer survives serialization --');
const km = serializeEntry({ data: { title: 'របាយការណ៍វឌ្ឍនភាព' }, body: 'សកម្មភាពគម្រោង' });
const kmBack = parseEntry(km);
check('khmer title', kmBack.data.title === 'របាយការណ៍វឌ្ឍនភាព', kmBack.data.title);
check('khmer body', kmBack.body === 'សកម្មភាពគម្រោង');

console.log('\n-- empty values dropped --');
const sparse = parseEntry(serializeEntry({ data: { title: 'T', excerpt: '', order: 0, attachments: [] }, body: 'b' }));
check('empty string dropped', !('excerpt' in sparse.data));
check('empty array dropped', !('attachments' in sparse.data));
check('zero kept', sparse.data.order === 0, JSON.stringify(sparse.data));

console.log('\n-- no lang field is written --');
check('lang absent', !('lang' in sparse.data));

console.log('\n-- form expansion --');
const form = expandForm({
  'title.km': 'ចំណងជើង', 'title.en': 'Title',
  'body.km': 'ខ្លឹមសារ', 'body.en': 'Body',
  'featured': 'true', 'order': '3',
  'attachments[0][file]': '/documents/a.pdf',
  'attachments[0][label]': 'A',
  'attachments[0][featured]': 'true',
  'attachments[0][size]': '1234',
  'attachments[2][file]': 'https://files.example.org/b.pdf',
  'attachments[2][size]': '',
});
check('locale nesting', form.title.km === 'ចំណងជើង' && form.title.en === 'Title');
check('array built', Array.isArray(form.attachments) && form.attachments.length === 2);
check('sparse indices compacted', form.attachments[1].file === 'https://files.example.org/b.pdf');

const atts = normalizeAttachments(form.attachments);
check('attachment size coerced', atts[0].size === 1234);
check('featured coerced', atts[0].featured === true);
check('missing size omitted', !('size' in atts[1]), JSON.stringify(atts[1]));
check('remote url kept', atts[1].file === 'https://files.example.org/b.pdf');

const blank = normalizeAttachments([{ file: '  ' }, { file: '/ok.pdf' }]);
check('blank rows dropped', blank.length === 1);

console.log('\n-- coercion --');
check('number', coerce('6.0', 'number') === 6);
check('empty number -> undefined', coerce('', 'number') === undefined);
check('bad number -> undefined', coerce('abc', 'number') === undefined);
check('bool true', coerce('true', 'boolean') === true);
check('bool false', coerce(undefined, 'boolean') === false);
check('date trimmed', coerce('2026-01-15T00:00', 'date') === '2026-01-15');

console.log('\n-- dotted paths --');
const obj = { currentProgress: { statusLabel: { en: 'Satisfactory' } } };
check('getPath', getPath(obj, 'currentProgress.statusLabel.en') === 'Satisfactory');
setPath(obj, 'currentProgress.physicalProgress', 6.5);
check('setPath', obj.currentProgress.physicalProgress === 6.5);
setPath(obj, 'a.b.c', 1);
check('setPath creates', obj.a.b.c === 1);

console.log('\n-- slugs --');
check('slug normalizes', normalizeSlug('  Q4 2025 Progress Report! ') === 'q4-2025-progress-report');
check('slug strips unicode', normalizeSlug('របាយការណ៍ report') === 'report');

console.log('\n-- mount point --');
// applyBase is what rewrites every Location header in production.
check('prefixes a root-relative path', applyBase('/media', '/admin') === '/admin/media');
check('prefixes the root itself', applyBase('/', '/admin') === '/admin/');
check('is idempotent', applyBase('/admin/media', '/admin') === '/admin/media');
check('leaves the mount point alone', applyBase('/admin', '/admin') === '/admin');
// The trap this guards: a path that merely starts with the same letters must be
// prefixed, not mistaken for one already mounted.
check('prefixes a lookalike path', applyBase('/administrators', '/admin') === '/admin/administrators');
check('ignores an absolute URL', applyBase('https://x.test/a', '/admin') === 'https://x.test/a');
check('ignores a protocol-relative URL', applyBase('//x.test/a', '/admin') === '//x.test/a');
check('unmounted is a no-op', applyBase('/media', '') === '/media');

// withBase rewrites a rendered document. Every signed-in view is built by page(),
// so covering it here covers the nav, the topbar and the sign-out form at once —
// the views a test cannot reach without Postgres and a GitHub token.
const dashboard = withBase(
  page({ title: 'Dashboard', user: { username: 'sok', role: 'admin' }, body: '<a href="/media">Media</a>' }),
  '/admin'
);
const links = [...dashboard.matchAll(/\b(?:href|src|action)="(\/[^"]*)"/g)].map((m) => m[1]);
const escapees = links.filter((href) => href !== '/admin' && !href.startsWith('/admin/'));
check('page() links all sit under the mount point', escapees.length === 0, escapees.join(' '));
check('the nav is rewritten', dashboard.includes('href="/admin/collections/news"'));
check('the sign-out form is rewritten', dashboard.includes('action="/admin/logout"'));
check('the stylesheet is rewritten', dashboard.includes('href="/admin/static/admin.css"'));
check('an external stylesheet is untouched', dashboard.includes('href="https://fonts.googleapis.com'));

// Escaped content cannot forge an attribute: a quote in an entry title arrives as
// &quot;, so a title can never steer the rewrite or smuggle in a link.
const hostile = page({
  title: 'Report" href="/evil',
  user: { username: 'sok', role: 'editor' },
  body: '<p>ok</p>',
});
check('user content cannot inject a link', !withBase(hostile, '/admin').includes('href="/evil'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
