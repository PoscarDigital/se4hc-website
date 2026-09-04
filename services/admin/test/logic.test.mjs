import { parseEntry, serializeEntry, normalizeSlug } from '../src/content.js';
import { expandForm, coerce, normalizeAttachments } from '../src/formdata.js';
import { getPath, setPath } from '../src/schema.js';

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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
