import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import icon from 'astro-icon';

// Deployed to GitHub Pages at https://razee4315.github.io/Paperling/
// `base` must match the repo name so every emitted URL is prefixed correctly.
export default defineConfig({
  site: 'https://razee4315.github.io',
  base: '/Paperling/',
  trailingSlash: 'ignore',
  integrations: [icon()],
  vite: {
    plugins: [tailwindcss()],
  },
});
