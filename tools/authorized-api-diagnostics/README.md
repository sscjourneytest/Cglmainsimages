# Authorized API Diagnostic Worker

This is a **locked-down API diagnostic tool** for an upstream API that you own or are explicitly authorized to test.

It tells you what the Worker itself can observe:

- successful upstream response;
- HTTP status and safe response headers;
- likely category: missing auth (`401`), policy denial (`403`), Cloudflare/challenge indicator (`403` with challenge response), schema rejection (`400`/`415`/`422`), rate limit (`429`), or upstream error (`5xx`);
- elapsed time and a capped response-body preview.

It cannot truthfully identify every low-level root cause. For example, Workers expose a generic fetch failure for various DNS, TLS, routing, connection-reset, and platform failures.

## Security boundary

This is not an open proxy:

- The browser cannot choose the upstream domain. Set `UPSTREAM_URL` when deploying the Worker.
- It does not forward browser-supplied `Cookie`, `Authorization`, `Origin`, `Referer`, Cloudflare-clearance values, or arbitrary headers.
- It accepts only `GET` and `POST`.
- The browser origin must exactly match `ALLOWED_UI_ORIGIN`.

Do not use this to replay browser sessions, Cloudflare challenge cookies, or access an API without authorization. CORS is a browser policy, not permission to use an API.

## Deploy the Worker

1. Create a Cloudflare Worker and deploy `worker.js`, or use Wrangler:

   ```bash
   cd tools/authorized-api-diagnostics
   cp wrangler.toml.example wrangler.toml
   npx wrangler deploy
   ```

2. Configure Worker secrets. `UPSTREAM_URL` must be the full HTTPS API endpoint you are authorized to call:

   ```bash
   npx wrangler secret put UPSTREAM_URL
   npx wrangler secret put ALLOWED_UI_ORIGIN
   ```

   Example `ALLOWED_UI_ORIGIN`:

   ```text
   https://your-account.github.io
   ```

   If the API provider gives you documented server credentials, store them as Worker secrets rather than in the HTML page:

   ```bash
   npx wrangler secret put UPSTREAM_BEARER_TOKEN
   # or
   npx wrangler secret put UPSTREAM_API_KEY
   ```

3. Deploy `diagnostic.html` to the exact origin supplied as `ALLOWED_UI_ORIGIN`, then paste your Worker URL into the page.

> Opening `diagnostic.html` directly from your computer as `file://` will not work: it has a `null` origin and is intentionally rejected. Use GitHub Pages, Cloudflare Pages, or another HTTPS static host.

## What CORS result means

- **Browser → third-party API:** the browser may block JavaScript from reading a response because of CORS.
- **Worker → upstream API:** browser CORS does not apply.
- **Worker response → your browser:** the Worker explicitly allows only your configured UI origin.

A Worker avoiding browser CORS does not defeat real upstream controls such as API credentials, account sessions, Cloudflare/WAF protections, IP restrictions, rate limits, mTLS, or terms of service.
