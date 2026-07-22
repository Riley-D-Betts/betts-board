import { useDb } from '../db/client'
import { verifyBearerToken } from '../services/apiKeys/keys'
import { getBoardSession } from '../utils/session'

// Interactive API reference (Scalar). /docs sits outside the /api/** and
// /uploads/** middleware guard, so it gates itself: any unlocked session may
// view it, a bearer key works too, and everyone else lands on the unlock
// screen. The Scalar bundle ships in public/docs-assets/ — fully offline.
export default defineEventHandler(async (event) => {
  let session = await getBoardSession(event)
  if (!session) {
    // Bearer keys never pass through the middleware for this path — verify here.
    const authHeader = getHeader(event, 'authorization')
    if (authHeader?.startsWith('Bearer ')) {
      session = verifyBearerToken(useDb(), authHeader.slice(7).trim())
    }
  }
  if (!session) return sendRedirect(event, '/unlock', 302)

  setHeader(event, 'Content-Type', 'text/html; charset=utf-8')
  return /* html */ `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Betts Board API</title>
  <style>
    body { margin: 0; }
    .docs-missing { font-family: system-ui, sans-serif; max-width: 40rem; margin: 4rem auto; padding: 0 1rem; color: #334155; }
    @media (prefers-color-scheme: dark) { body { background: #0f172a; } .docs-missing { color: #cbd5e1; } }
  </style>
</head>
<body>
  <div id="app"></div>
  <script src="/docs-assets/scalar.js"></script>
  <script>
    if (window.Scalar) {
      window.Scalar.createApiReference('#app', {
        url: '/api/openapi.json',
        darkMode: window.matchMedia('(prefers-color-scheme: dark)').matches,
        hideClientButton: true,
        metaData: { title: 'Betts Board API' },
      })
    }
    else {
      document.getElementById('app').innerHTML
        = '<div class="docs-missing"><h1>Docs bundle unavailable</h1>'
        + '<p>/docs-assets/scalar.js did not load. The raw spec is still at '
        + '<a href="/api/openapi.json">/api/openapi.json</a>.</p></div>'
    }
  </script>
</body>
</html>`
})
