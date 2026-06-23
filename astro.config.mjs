import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';

// Hosted on GitHub Pages with the custom domain se4hc.poscar.cloud, which
// serves from the root — so no base path is needed in production or locally.
export default defineConfig({
  site: 'https://se4hc.poscar.cloud',
  integrations: [tailwind()],
  i18n: {
    defaultLocale: 'km',
    locales: ['km', 'en'],
    routing: {
      prefixDefaultLocale: false
    }
  }
});
