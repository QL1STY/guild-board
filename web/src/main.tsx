import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/alegreya-sans/400.css'
import '@fontsource/alegreya-sans/500.css'
import '@fontsource/alegreya-sans/700.css'
import '@fontsource/alegreya-sans/800.css'
import './styles/tokens.css'
import './styles/base.css'
import './styles/signs.css'
import './styles/frame.css'
import './styles/note.css'
import './styles/timers.css'
import './styles/commissions.css'
import './styles/fresh.css'
import './styles/motion.css'
import App from './App.tsx'

// The overlay's page (plan 2A-4) is see-through before React draws anything, as it must be by its load event: the shell
// shows the overlay's window over the game once the page has loaded. App keeps the class in step with later addresses.
if (window.location.hash.startsWith('#/overlay')) document.documentElement.classList.add('ov-doc')

async function start(): Promise<void> {
  // The site's browser demo (VITE_SITE_DEMO, `npm run build:site-demo`) has no core: its answers are a recording. In every other
  // build this is false at build time, and the demo's code and data are not in the bundle.
  if (import.meta.env.VITE_SITE_DEMO === '1') {
    const { startSiteDemo } = await import('./sitedemo.ts')
    await startSiteDemo()
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void start()
