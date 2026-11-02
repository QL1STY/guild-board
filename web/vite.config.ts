import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vitest/config'

/**
 * The site's browser demo (`npm run build:site-demo`, mode `site-demo`, which alone sets VITE_SITE_DEMO, here and not in a `.env`
 * file, as the public tree carries none): the same interface, served from /guild-board/demo/ on GitHub Pages, with its answers read from the recording that
 * tools/record-site-demo.py wrote into `site-demo/` (served as the build's public folder). No other build has any of it.
 */
const SITE_DEMO_BASE = '/guild-board/demo/'

/** The demo's page asks the visitor's browser to send no referrer, so that a picture host that checks it has nothing to refuse for. */
function noReferrer(): Plugin {
  return {
    name: 'site-demo-no-referrer',
    transformIndexHtml: () => [{ tag: 'meta', attrs: { name: 'referrer', content: 'no-referrer' }, injectTo: 'head-prepend' }],
  }
}

/**
 * The interface is about 1,040 pixels wide at the least, so on a phone the demo's page is 1,280 wide: the browser shows the whole
 * of it, zoomed out, and the visitor pinches in, where `width=device-width` would break the layout. The installed app keeps its own.
 */
function wideViewport(): Plugin {
  return {
    name: 'site-demo-wide-viewport',
    transformIndexHtml: (html) => html.replace(/<meta name="viewport"[^>]*>/, '<meta name="viewport" content="width=1280" />'),
  }
}

export default defineConfig(({ mode }) => {
  const site = mode === 'site-demo'
  return {
    plugins: site ? [react(), noReferrer(), wideViewport()] : [react()],
    base: site ? SITE_DEMO_BASE : '/',
    ...(site ? { publicDir: 'site-demo', define: { 'import.meta.env.VITE_SITE_DEMO': JSON.stringify('1') } } : {}),
    build: { outDir: site ? 'dist-site' : 'dist', emptyOutDir: true },
    // Vitest loads every stylesheet as an empty one, except those a test reads as text: `import css from './x.css?raw'`.
    test: { include: ['src/**/*.test.ts'], environment: 'node', css: { include: [/\.css\?raw$/] } },
  }
})
