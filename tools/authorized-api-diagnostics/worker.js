/*
 * Authorized API diagnostic Worker
 *
 * Purpose: diagnose an API that YOU own or are explicitly permitted to test.
 * This is deliberately NOT an open proxy:
 *   - UPSTREAM_URL is configured at deployment, never supplied by a browser.
 *   - Browser-supplied cookies, Origin, Referer, Authorization, and arbitrary
 *     request headers are never forwarded.
 *   - Only GET or POST is accepted.
 *
 * Required Worker secrets/variables:
 *   UPSTREAM_URL        Full HTTPS endpoint to test, owned/authorized by you.
 *   ALLOWED_UI_ORIGIN   Exact origin hosting diagnostic.html, e.g.
 *                       https://example.github.io
 *
 * Optional Worker secrets:
 *   UPSTREAM_BEARER_TOKEN  A documented API bearer token.
 *   UPSTREAM_API_KEY       A documented API key, sent as X-API-Key.
 */

const MAX_REQUEST_BYTES = 128 * 1024;
const MAX_RESPONSE_PREVIEW_BYTES = 12 * 1024;
const SAFE_RESPONSE_HEADERS = [
  'content-type',
  'content-length',
  'retry-after',
  'server',
  'cf-ray',
  'www-authenticate',
  'x-request-id',
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'x-ratelimit-reset'
];

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const corsHeaders = buildCorsHeaders(origin, env.ALLOWED_UI_ORIGIN || '');

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (!isAllowedOrigin(origin, env.ALLOWED_UI_ORIGIN || '')) {
      return json({
        ok: false,
        code: 'UI_ORIGIN_NOT_ALLOWED',
        message: 'This diagnostic page origin is not allowed by this Worker configuration.'
      }, 403, corsHeaders);
    }

    if (request.method !== 'POST') {
      return json({ ok: false, code: 'METHOD_NOT_ALLOWED', message: 'Use POST /diagnose.' }, 405, corsHeaders);
    }

    const pathname = new URL(request.url).pathname;
    if (pathname !== '/diagnose') {
      return json({ ok: false, code: 'NOT_FOUND', message: 'Use the /diagnose endpoint.' }, 404, corsHeaders);
    }

    if (!env.UPSTREAM_URL) {
      return json({
        ok: false,
        code: 'UPSTREAM_NOT_CONFIGURED',
        message: 'Set the UPSTREAM_URL Worker secret to an HTTPS endpoint you are authorized to test.'
      }, 500, corsHeaders);
    }

    let upstreamUrl;
    try {
      upstreamUrl = new URL(env.UPSTREAM_URL);
      if (upstreamUrl.protocol !== 'https:') throw new Error('Only HTTPS upstreams are allowed.');
    } catch (error) {
      return json({ ok: false, code: 'INVALID_UPSTREAM_URL', message: error.message }, 500, corsHeaders);
    }

    if ((request.headers.get('Content-Length') || 0) > MAX_REQUEST_BYTES) {
      return json({ ok: false, code: 'PAYLOAD_TOO_LARGE', message: 'Payload exceeds 128 KB.' }, 413, corsHeaders);
    }

    let input;
    try {
      input = await request.json();
    } catch {
      return json({ ok: false, code: 'INVALID_JSON', message: 'The diagnostic request body must be JSON.' }, 400, corsHeaders);
    }

    const method = String(input.method || 'POST').toUpperCase();
    if (!['GET', 'POST'].includes(method)) {
      return json({ ok: false, code: 'UPSTREAM_METHOD_NOT_ALLOWED', message: 'Only GET and POST are enabled.' }, 400, corsHeaders);
    }

    // The payload is data only. Client-supplied credentials/cookies/headers are
    // intentionally ignored; use documented credentials stored as Worker secrets.
    const payload = input.payload ?? null;
    const outboundHeaders = new Headers({
      'Accept': 'application/json, text/plain, */*',
      'User-Agent': 'Authorized-API-Diagnostic/1.0'
    });
    if (method === 'POST') outboundHeaders.set('Content-Type', 'application/json');
    if (env.UPSTREAM_BEARER_TOKEN) outboundHeaders.set('Authorization', `Bearer ${env.UPSTREAM_BEARER_TOKEN}`);
    if (env.UPSTREAM_API_KEY) outboundHeaders.set('X-API-Key', env.UPSTREAM_API_KEY);

    const startedAt = Date.now();
    try {
      const upstreamResponse = await fetch(upstreamUrl.toString(), {
        method,
        headers: outboundHeaders,
        body: method === 'POST' ? JSON.stringify(payload) : undefined,
        redirect: 'manual'
      });
      const responseText = await readPreview(upstreamResponse, MAX_RESPONSE_PREVIEW_BYTES);
      const elapsedMs = Date.now() - startedAt;
      const diagnostic = diagnose(upstreamResponse.status, upstreamResponse.headers, responseText);
      // Safe operational log: deliberately excludes request payloads, cookies,
      // credentials, and response bodies because they may contain personal data.
      console.log(JSON.stringify({
        event: 'authorized_api_diagnostic',
        upstreamHost: upstreamUrl.host,
        method,
        status: upstreamResponse.status,
        elapsedMs,
        category: diagnostic.category
      }));

      return json({
        ok: upstreamResponse.ok,
        upstream: {
          host: upstreamUrl.host,
          method,
          status: upstreamResponse.status,
          statusText: upstreamResponse.statusText,
          elapsedMs,
          headers: selectedHeaders(upstreamResponse.headers),
          bodyPreview: responseText,
          bodyPreviewTruncated: responseText.length >= MAX_RESPONSE_PREVIEW_BYTES
        },
        diagnostic
      }, 200, corsHeaders);
    } catch (error) {
      // Workers expose a generic fetch error for many DNS/TLS/connectivity
      // failures, so do not claim an "exact" root cause that the platform
      // did not reveal.
      return json({
        ok: false,
        upstream: { host: upstreamUrl.host, method, elapsedMs: Date.now() - startedAt },
        diagnostic: {
          category: 'upstream_network_or_platform_failure',
          confidence: 'observed',
          message: 'The Worker could not obtain an HTTP response. This can be DNS, TLS, routing, a connection reset, or an upstream/WAF refusal; the Worker runtime did not expose a more specific cause.',
          workerError: String(error && error.message ? error.message : error)
        }
      }, 200, corsHeaders);
    }
  }
};

function isAllowedOrigin(origin, allowedOrigin) {
  return Boolean(origin && allowedOrigin && origin === allowedOrigin);
}

function buildCorsHeaders(origin, allowedOrigin) {
  const headers = new Headers({
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '600'
  });
  if (isAllowedOrigin(origin, allowedOrigin)) headers.set('Access-Control-Allow-Origin', origin);
  return headers;
}

function json(value, status, corsHeaders) {
  const headers = new Headers(corsHeaders);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(value, null, 2), { status, headers });
}

async function readPreview(response, limit) {
  const text = await response.text();
  return text.length > limit ? text.slice(0, limit) : text;
}

function selectedHeaders(headers) {
  const output = {};
  for (const name of SAFE_RESPONSE_HEADERS) {
    const value = headers.get(name);
    if (value) output[name] = value;
  }
  return output;
}

function diagnose(status, headers, body) {
  const normalizedBody = String(body || '').toLowerCase();
  const server = headers.get('server') || '';
  const cloudflareChallenge =
    /just a moment|attention required|cf-chl|challenge-platform|cloudflare/.test(normalizedBody) ||
    /cloudflare/i.test(server);

  if (status >= 200 && status < 300) {
    return {
      category: 'success',
      confidence: 'observed',
      message: 'The configured upstream returned a successful HTTP response to the Worker.'
    };
  }
  if (status === 401) {
    return {
      category: 'authentication_required_or_invalid',
      confidence: 'observed',
      message: 'The upstream returned HTTP 401. Use the provider’s documented authentication method/credential.'
    };
  }
  if (status === 403 && cloudflareChallenge) {
    return {
      category: 'cloudflare_or_bot_protection',
      confidence: 'observed',
      message: 'The upstream returned HTTP 403 with Cloudflare/challenge indicators. Obtain authorized API access; do not replay browser challenge cookies.'
    };
  }
  if (status === 403) {
    return {
      category: 'authorization_or_upstream_policy_denied',
      confidence: 'observed',
      message: 'The upstream returned HTTP 403. CORS is not the blocker at this point; the upstream denied this Worker request.'
    };
  }
  if (status === 404) {
    return {
      category: 'endpoint_not_found',
      confidence: 'observed',
      message: 'The upstream returned HTTP 404. Verify the documented endpoint path and API version.'
    };
  }
  if (status === 405) {
    return {
      category: 'upstream_method_not_allowed',
      confidence: 'observed',
      message: 'The upstream rejected the selected HTTP method. Check its API documentation.'
    };
  }
  if (status === 415 || status === 422 || status === 400) {
    return {
      category: 'request_schema_or_content_type_rejected',
      confidence: 'observed',
      message: `The upstream returned HTTP ${status}. Check the documented JSON schema, required fields, and content type.`
    };
  }
  if (status === 429) {
    return {
      category: 'rate_limited',
      confidence: 'observed',
      message: 'The upstream returned HTTP 429. Honor Retry-After and use the provider’s permitted rate limit.'
    };
  }
  if (status >= 500) {
    return {
      category: 'upstream_server_error',
      confidence: 'observed',
      message: `The upstream returned HTTP ${status}. The request reached the upstream, but its server failed or was unavailable.`
    };
  }
  return {
    category: 'upstream_rejected_request',
    confidence: 'observed',
    message: `The upstream returned HTTP ${status}. Inspect the safe response headers and body preview for its documented reason.`
  };
}
