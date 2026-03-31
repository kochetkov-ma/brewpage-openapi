import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import pagefind from 'astro-pagefind';
import {
  transformerNotationDiff,
  transformerNotationHighlight,
} from '@shikijs/transformers';

export default defineConfig({
  output: 'static',
  site: 'https://kochetkov-ma.github.io',
  base: '/brewpage-openapi',
  integrations: [tailwind(), mdx(), sitemap(), pagefind()],
  markdown: {
    shikiConfig: {
      theme: 'catppuccin-mocha',
      wrap: true,
      transformers: [transformerNotationDiff(), transformerNotationHighlight()],
    },
  },
});
