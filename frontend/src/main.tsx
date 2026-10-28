import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { Tooltips } from './components/Tooltips'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <Tooltips />
  </StrictMode>,
)

// Installable app + push notifications. Skipped where service workers aren't available (and in tests).
if ('serviceWorker' in navigator && !import.meta.env.VITE_NO_SW) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => undefined); });
}
