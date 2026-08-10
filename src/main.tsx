import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PublicRentPage } from './features/public-rent/PublicRentPage'
import { PUBLIC_DATASETS } from './mocks/fixtures/public-rent-link'
import { worker } from './mocks/browser'
import './styles/globals.css'

/**
 * Точка входу standalone-прототипу BP-1089.
 *
 * У CRM сторінка живе на роутах `/o` і `/o/$token` (TanStack Router). Тут
 * роутера немає — окремий проєкт заради одного екрана його не вартий, тому
 * набір демо-даних читається прямо з адреси.
 *
 * Підтримані форми (усі дають один результат), шлях рахується від `BASE_URL` —
 * на GitHub Pages сайт лежить у `/<repo>/`, а не в корені:
 *   .../           → demo
 *   .../o          → demo
 *   .../o/holiday  → holiday   ← так само, як у CRM
 *   .../holiday    → holiday
 *   .../#holiday   → holiday   ← запасний варіант, якщо фолбек 404 не спрацює
 *
 * Невідомий ключ віддає `demo`, а не порожній екран: посилання їздять у чатах
 * і псуються, а демо має відкриватися завжди.
 */
function resolveDataset(): string {
  const path = window.location.pathname.startsWith(import.meta.env.BASE_URL)
    ? window.location.pathname.slice(import.meta.env.BASE_URL.length)
    : window.location.pathname
  const segments = path
    .split('/')
    .filter(Boolean)
    .filter((s) => s !== 'o')
  const key = segments[0] ?? window.location.hash.replace(/^#\/?/, '')
  return key && key in PUBLIC_DATASETS ? key : 'demo'
}

const qc = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
})

// Хендлери MSW тут — не інструмент розробки, а сам бекенд прототипу, тому
// воркер стартує і в продакшн-збірці. `bypass` пропускає шрифти й статику.
worker
  .start({
    serviceWorker: { url: `${import.meta.env.BASE_URL}mockServiceWorker.js` },
    onUnhandledRequest: 'bypass',
    quiet: true,
  })
  .then(() => {
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <QueryClientProvider client={qc}>
          <PublicRentPage token={resolveDataset()} />
        </QueryClientProvider>
      </StrictMode>,
    )
  })
