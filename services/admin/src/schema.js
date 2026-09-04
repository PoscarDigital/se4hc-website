/**
 * Field definitions for the editing forms.
 *
 * This mirrors `src/content/config.ts` in the website repo. The two are
 * deliberately separate — the Zod schema validates at build time, this one
 * renders the form — but they must agree: a field the portal writes that the
 * schema rejects fails CI, and the site keeps serving the previous version
 * until someone fixes it. When you change one, change the other.
 */

export const LOCALES = ['km', 'en'];
export const DEFAULT_LOCALE = 'km';

const STATUS_VALUES = [
  '',
  'new',
  'updated',
  'archived',
  'active',
  'closing',
  'awarded',
  'upcoming',
  'ongoing',
  'completed',
];

/**
 * Fields every collection shares.
 *
 * `translatable: true` means the field gets a separate value per language and
 * appears twice in the editor, side by side. Everything else is shared: written
 * identically into both the km and en file, so an editor sets it once.
 *
 * Note there is no `lang` field. The folder an entry lives in is what defines
 * its language (see utils/content.ts in the website); a frontmatter tag that
 * could disagree with the folder is a bug waiting to happen.
 */
const baseFields = [
  { name: 'title', label: 'Title', type: 'text', required: true, translatable: true },
  { name: 'excerpt', label: 'Excerpt', type: 'textarea', translatable: true, help: 'Short summary shown on listing pages.' },
  { name: 'date', label: 'Date', type: 'date' },
  { name: 'category', label: 'Category', type: 'text', translatable: true },
  { name: 'status', label: 'Status', type: 'select', options: STATUS_VALUES },
  { name: 'featured', label: 'Featured', type: 'boolean', help: 'Highlight this entry on listing pages.' },
  { name: 'order', label: 'Order', type: 'number', help: 'Manual sort weight — lower appears first.' },
  { name: 'featureImage', label: 'Feature image', type: 'image' },
  { name: 'featureImageAlt', label: 'Feature image alt text', type: 'text', translatable: true },
  { name: 'attachments', label: 'Attachments', type: 'attachments' },
];

const body = {
  name: 'body',
  label: 'Body',
  type: 'markdown',
  translatable: true,
};

const collection = (name, label, labelKm, extras = [], opts = {}) => ({
  name,
  label,
  labelKm,
  folder: `src/content/${name}`,
  fields: [...baseFields, ...extras, body],
  ...opts,
});

export const COLLECTIONS = [
  collection('news', 'News', 'ព័ត៌មាន'),

  collection('reports', 'Reports', 'របាយការណ៍', [
    {
      name: 'type',
      label: 'Report type',
      type: 'select',
      options: ['', 'progress', 'financial', 'technical', 'review', 'baseline', 'engagement'],
    },
    { name: 'pages', label: 'Page count', type: 'number' },
  ]),

  collection('resources', 'Resources', 'ធនធាន', [
    { name: 'type', label: 'Resource type', type: 'text', translatable: true, help: 'e.g. Training Material' },
  ]),

  collection('events', 'Events', 'ព្រឹត្តិការណ៍', [
    { name: 'dateLabel', label: 'Date label', type: 'text', translatable: true, help: 'e.g. Q1 2026' },
    { name: 'location', label: 'Location', type: 'text', translatable: true },
  ]),

  collection('procurement', 'Procurement', 'លទ្ធកម្ម', [
    {
      name: 'type',
      label: 'Procurement type',
      type: 'select',
      options: ['', 'works', 'goods', 'consulting', 'non-consulting', 'individual'],
    },
    { name: 'value', label: 'Value (USD)', type: 'number' },
    { name: 'method', label: 'Method', type: 'text', translatable: true },
    { name: 'contracts', label: 'Contracts', type: 'number' },
  ]),

  collection('faqs', 'FAQs', 'សំណួរញឹកញាប់', [], {
    titleLabel: 'Question',
    bodyLabel: 'Answer',
    help: 'The title is the question; the body is the answer. Category groups them: general, education, procurement, participation, technical.',
  }),
];

export const collectionByName = (name) => COLLECTIONS.find((c) => c.name === name) ?? null;

/**
 * Structured JSON exposed to editors.
 *
 * Deliberately a subset. `navigation.json` and `i18n/*.json` are not here:
 * they are sitewide plumbing where a mistake breaks every page, with no upside
 * for content staff. `media-manifest.json` is machine-written.
 *
 * These are edited as JSON with validation rather than through generated forms
 * — the shapes are nested and bespoke enough that a hand-built form per file
 * would be a lot of surface area for a file that changes a few times a year.
 * The exception is site.json, which carries the quarterly figures and gets a
 * proper form.
 */
export const DATA_FILES = [
  {
    name: 'site',
    label: 'Project figures',
    path: 'src/data/site.json',
    help: 'Loan figures, targets, and the quarterly progress numbers.',
    form: [
      { path: 'currentProgress.asOf', label: 'Figures as of', type: 'date' },
      { path: 'currentProgress.physicalProgress', label: 'Physical progress (%)', type: 'number' },
      { path: 'currentProgress.elapsedTime', label: 'Elapsed time (%)', type: 'number' },
      { path: 'currentProgress.contractsAwarded', label: 'Contracts awarded', type: 'number' },
      { path: 'currentProgress.contractValue', label: 'Contract value (USD)', type: 'number' },
      { path: 'currentProgress.disbursement', label: 'Disbursement (USD)', type: 'number' },
      { path: 'currentProgress.disbursementPercent', label: 'Disbursement (%)', type: 'number' },
      { path: 'currentProgress.schoolsAssessed', label: 'Schools assessed', type: 'number' },
      { path: 'currentProgress.fastTrackSchools', label: 'Fast-track schools', type: 'number' },
      { path: 'currentProgress.status', label: 'Status', type: 'select', options: ['green', 'yellow', 'red'] },
      { path: 'currentProgress.statusLabel.km', label: 'Status label (Khmer)', type: 'text' },
      { path: 'currentProgress.statusLabel.en', label: 'Status label (English)', type: 'text' },
    ],
  },
  { name: 'gallery', label: 'Homepage gallery & video', path: 'src/data/gallery.json', help: 'Slideshow images and the project video. Set either a YouTube URL/ID or a file; leave both empty for the placeholder.' },
  { name: 'contacts', label: 'Contacts', path: 'src/data/contacts.json' },
  { name: 'partners', label: 'Partners', path: 'src/data/partners.json' },
  { name: 'stakeholders', label: 'Stakeholders', path: 'src/data/stakeholders.json' },
  { name: 'project-stats', label: 'Project statistics', path: 'src/data/project-stats.json' },
  { name: 'page-content', label: 'Page sections', path: 'src/data/page-content.json', help: 'Longer sections for the Procurement, Resources and About pages.' },
];

export const dataFileByName = (name) => DATA_FILES.find((f) => f.name === name) ?? null;

/** Read a dotted path out of a nested object. */
export function getPath(object, path) {
  return path.split('.').reduce((value, key) => (value == null ? undefined : value[key]), object);
}

/** Write a dotted path into a nested object, creating intermediate objects. */
export function setPath(object, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  let target = object;
  for (const key of keys) {
    if (typeof target[key] !== 'object' || target[key] === null) target[key] = {};
    target = target[key];
  }
  target[last] = value;
}
