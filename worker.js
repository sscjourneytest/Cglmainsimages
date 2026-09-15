export default {
  async fetch(request, env) {
    const SUPABASE_URL = "https://duqmejyypqgkrjlpplrz.supabase.co";
    const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1cW1lanl5cHFna3JqbHBwbHJ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE2MDIyNTAsImV4cCI6MjA4NzE3ODI1MH0.aAIITdr-BS-D-TJHY1fEkqgN4CRVwsyz90d2I9IrhVc";

    const allowedOrigins = [
      "https://mockmatrixhub.in",
      "https://www.mockmatrixhub.in",
      "https://mockmatrixhub.pages.dev",
      "https://localhost",
      "http://localhost",
      "capacitor://localhost",
    ];
    const requestOrigin = request.headers.get("Origin");
    const allowOrigin = allowedOrigins.includes(requestOrigin) ? requestOrigin : allowedOrigins[0];

    const corsHeaders = {
      "Access-Control-Allow-Origin": allowOrigin,
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type, apikey, x-client-info, x-supabase-auth, x-supabase-api-version, preferred_alphabets, x-address-t, accept-profile, content-profile, Prefer, x-razorpay-signature",
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Max-Age": "86400",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);

    // ---------------------------------------------------------
    // NEW: Razorpay routes — handled here, never forwarded to Supabase
    // ---------------------------------------------------------
    if (url.pathname === "/create-order" && request.method === "POST") {
      return handleCreateOrder(request, env, SUPABASE_URL, SUPABASE_ANON_KEY, corsHeaders);
    }
    if (url.pathname === "/validate-coupon" && request.method === "POST") {
      return handleValidateCoupon(request, env, SUPABASE_URL, corsHeaders);
    }
    if (url.pathname === "/razorpay-webhook" && request.method === "POST") {
      return handleWebhook(request, env, SUPABASE_URL, corsHeaders);
    }
    if (url.pathname === "/admin-grant-premium" && request.method === "POST") {
      return handleAdminGrant(request, env, SUPABASE_URL, SUPABASE_ANON_KEY, corsHeaders);
    }
    if (url.pathname === "/admin-cancel-premium" && request.method === "POST") {
      return handleAdminCancelPremium(request, env, SUPABASE_URL, SUPABASE_ANON_KEY, corsHeaders);
    }
    if (url.pathname === "/delete-account" && request.method === "POST") {
      return handleDeleteAccount(request, env, SUPABASE_URL, SUPABASE_ANON_KEY, corsHeaders);
    }

    // ---------------------------------------------------------
    // EXISTING: generic Supabase reverse proxy (unchanged)
    // ---------------------------------------------------------
    const targetUrl = `${SUPABASE_URL}${url.pathname}${url.search}`;
    const newHeaders = new Headers(request.headers);
    newHeaders.set("Host", "duqmejyypqgkrjlpplrz.supabase.co");

    try {
      const response = await fetch(targetUrl, {
        method: request.method,
        headers: newHeaders,
        body: request.method !== "GET" && request.method !== "HEAD" ? request.body : null,
        redirect: "follow",
      });

      const proxyResponse = new Response(response.body, response);
      Object.keys(corsHeaders).forEach((h) => proxyResponse.headers.set(h, corsHeaders[h]));
      proxyResponse.headers.delete("content-security-policy");

      return proxyResponse;
    } catch (err) {
      return new Response("Proxy Error: " + err.message, { status: 502, headers: corsHeaders });
    }
  },
};

// ==================================================================
// Helpers
// ==================================================================

function json(data, status, corsHeaders) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Confirms the logged-in user's identity from their Supabase access token.
// Never trust a user_id sent directly from the browser.
async function getUserFromToken(request, SUPABASE_URL, SUPABASE_ANON_KEY) {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader) return null;

  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: authHeader,
    },
  });
  if (!res.ok) return null;
  return await res.json(); // { id, email, ... }
}

async function supabaseServiceRequest(env, SUPABASE_URL, path, method, body) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res;
}

// Looks up pricing + (optional) coupon and returns the final amount,
// rounded to the nearest whole rupee.
async function computeFinalAmount(env, SUPABASE_URL, planName, couponCode) {
  const priceRes = await supabaseServiceRequest(
    env, SUPABASE_URL,
    `/rest/v1/pricing?plan_name=eq.${encodeURIComponent(planName)}&is_active=eq.true&select=*`,
    "GET"
  );
  const priceRows = await priceRes.json();
  if (!priceRows || priceRows.length === 0) return { error: "Invalid or inactive plan" };
  const plan = priceRows[0];

  // NEW — coupon applicability gate (pricing.coupon_applicable column).
  // If a coupon is being applied and this plan has coupon_applicable = false,
  // fail fast with a DISTINCT error so the UI shows "Coupon not supported
  // for this plan" — never "Invalid, inactive, or expired coupon".
  // A missing column (older rows) defaults to allowed, so nothing breaks
  // before the migration below runs.
  if (couponCode) {
    const couponAllowed = plan.coupon_applicable !== false && String(plan.coupon_applicable) !== "false";
    if (!couponAllowed) {
      return { error: "Coupon not supported for this plan" };
    }
  }

  let discountPercent = 0;
  let coupon = null;

  if (couponCode) {
    const nowIso = new Date().toISOString();
    const couponRes = await supabaseServiceRequest(
      env, SUPABASE_URL,
      `/rest/v1/coupons?code=eq.${encodeURIComponent(couponCode)}&is_active=eq.true` +
      `&or=(valid_until.is.null,valid_until.gte.${nowIso})&select=*`,
      "GET"
    );
    const couponRows = await couponRes.json();
    if (!couponRows || couponRows.length === 0) {
      return { error: "Invalid, inactive, or expired coupon" };
    }
    coupon = couponRows[0];
    discountPercent = coupon.discount_percent;
  }

  const rawFinal = plan.offer_price - (plan.offer_price * discountPercent) / 100;
  const finalAmount = Math.round(rawFinal); // always nearest integer

  return { plan, coupon, finalAmount };
}

// ==================================================================
// Route handlers
// ==================================================================

async function handleValidateCoupon(request, env, SUPABASE_URL, corsHeaders) {
  try {
    const { plan_name, coupon_code } = await request.json();
    if (!plan_name || !coupon_code) {
      return json({ valid: false, error: "Missing plan_name or coupon_code" }, 400, corsHeaders);
    }

    const result = await computeFinalAmount(env, SUPABASE_URL, plan_name, coupon_code);
    if (result.error) {
      return json({ valid: false, error: result.error }, 400, corsHeaders);
    }

    return json(
      {
        valid: true,
        discount_percent: result.coupon.discount_percent,
        final_amount: result.finalAmount,
      },
      200,
      corsHeaders
    );
  } catch (err) {
    return json({ valid: false, error: err.message }, 500, corsHeaders);
  }
}

async function handleCreateOrder(request, env, SUPABASE_URL, SUPABASE_ANON_KEY, corsHeaders) {
  try {
    const user = await getUserFromToken(request, SUPABASE_URL, SUPABASE_ANON_KEY);
    if (!user || !user.id) {
      return json({ error: "Not authenticated" }, 401, corsHeaders);
    }

    const { plan_name, coupon_code } = await request.json();
    if (!plan_name) {
      return json({ error: "Missing plan_name" }, 400, corsHeaders);
    }

    const result = await computeFinalAmount(env, SUPABASE_URL, plan_name, coupon_code);
    if (result.error) {
      return json({ error: result.error }, 400, corsHeaders);
    }

    const { plan, finalAmount } = result;

    // Razorpay order — amount in paise
    const orderRes = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        Authorization: "Basic " + btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: finalAmount * 100,
        currency: "INR",
        notes: {
          user_id: user.id,
          plan_name: plan.plan_name,
          validity_days: String(plan.validity_days),
          coupon_code: coupon_code || "",
        },
      }),
    });

    const order = await orderRes.json();
    if (!orderRes.ok) {
      return json({ error: "Razorpay order creation failed", details: order }, 502, corsHeaders);
    }

    return json(
      {
        order_id: order.id,
        amount: finalAmount,
        currency: "INR",
        key_id: env.RAZORPAY_KEY_ID, // public, safe to expose
        plan_name: plan.plan_name,
      },
      200,
      corsHeaders
    );
  } catch (err) {
    return json({ error: err.message }, 500, corsHeaders);
  }
}

async function handleWebhook(request, env, SUPABASE_URL, corsHeaders) {
  try {
    const rawBody = await request.text();
    const signature = request.headers.get("x-razorpay-signature");

    const isValid = await verifySignature(rawBody, signature, env.RAZORPAY_WEBHOOK_SECRET);
    if (!isValid) {
      return json({ error: "Invalid signature" }, 400, corsHeaders);
    }

    const payload = JSON.parse(rawBody);

    if (payload.event !== "payment.captured") {
      return json({ status: "ignored" }, 200, corsHeaders); // 200 so Razorpay doesn't retry
    }

    const payment = payload.payload.payment.entity;
    const orderId = payment.order_id;
    const paymentId = payment.id;
    const notes = payment.notes || {};
    const amountPaid = payment.amount / 100;

    // Idempotency check — Razorpay may retry the same event
    const existingRes = await supabaseServiceRequest(
      env, SUPABASE_URL,
      `/rest/v1/payments?order_id=eq.${encodeURIComponent(orderId)}&select=id`,
      "GET"
    );
    const existing = await existingRes.json();
    if (existing && existing.length > 0) {
      return json({ status: "already processed" }, 200, corsHeaders);
    }

    // Insert payment record
    await supabaseServiceRequest(env, SUPABASE_URL, "/rest/v1/payments", "POST", {
      order_id: orderId,
      payment_id: paymentId,
      user_id: notes.user_id,
      amount_paid: amountPaid,
      coupon_code: notes.coupon_code || null,
    });

    // Update the user's profile - with stacking logic for existing users
    const validityDays = parseInt(notes.validity_days || "365", 10);
    
    // Fetch existing expiry to support stacking (renewal before expiry)
    let baseDate = new Date();
    try {
      const existingRes = await supabaseServiceRequest(
        env, SUPABASE_URL,
        `/rest/v1/profiles?id=eq.${encodeURIComponent(notes.user_id)}&select=expires_at`,
        "GET"
      );
      const existingRows = await existingRes.json();
      if (existingRows && existingRows.length > 0 && existingRows[0].expires_at) {
        const existingExp = new Date(existingRows[0].expires_at);
        if (!isNaN(existingExp.getTime()) && existingExp.getTime() > Date.now()) {
          // Existing plan still active -> stack new validity after existing expiry
          baseDate = existingExp;
        }
      }
    } catch (e) {
      // If fetch fails, fall back to now (safe)
      console.error("Failed to fetch existing expiry for stacking:", e.message);
    }

    const expiresAt = new Date(baseDate.getTime() + validityDays * 24 * 60 * 60 * 1000).toISOString();

    await supabaseServiceRequest(
      env, SUPABASE_URL,
      `/rest/v1/profiles?id=eq.${encodeURIComponent(notes.user_id)}`,
      "PATCH",
      { is_paid: true, expires_at: expiresAt }
    );

    // Dual-write to D1 — same stacking logic, D1 is what Gatekeeper reads
    try {
      const expiresAtSeconds = Math.floor(new Date(expiresAt).getTime() / 1000);
      await env.DB.prepare(
        `INSERT INTO paid_users (uuid, is_paid, expires_at, updated_at)
         VALUES (?, 1, ?, unixepoch())
         ON CONFLICT(uuid) DO UPDATE SET
           is_paid = 1,
           expires_at = excluded.expires_at,
           updated_at = unixepoch()`
      ).bind(notes.user_id, expiresAtSeconds).run();
    } catch (d1err) {
      console.error("D1 dual-write failed in handleWebhook:", d1err.message, "user_id:", notes.user_id);
    }

    return json({ status: "ok" }, 200, corsHeaders);
  } catch (err) {
    return json({ error: err.message }, 500, corsHeaders);
  }
}

async function verifyRole(env, SUPABASE_URL, userId, allowedRoles) {
  const res = await supabaseServiceRequest(
    env, SUPABASE_URL,
    `/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=role`,
    "GET"
  );
  const rows = await res.json();
  if (!rows || rows.length === 0) return false;
  return allowedRoles.includes(rows[0].role);
}

async function handleAdminGrant(request, env, SUPABASE_URL, SUPABASE_ANON_KEY, corsHeaders) {
  try {
    const user = await getUserFromToken(request, SUPABASE_URL, SUPABASE_ANON_KEY);
    if (!user || !user.id) {
      return json({ error: "Not authenticated" }, 401, corsHeaders);
    }

    // Only 'owner' may directly grant premium — checked server-side,
    // never trust a role claim from the browser.
    const isOwner = await verifyRole(env, SUPABASE_URL, user.id, ["owner"]);
    if (!isOwner) {
      return json({ error: "Forbidden — owner access required" }, 403, corsHeaders);
    }

    const { email, validity_days } = await request.json();
    if (!email || !validity_days) {
      return json({ error: "Missing email or validity_days" }, 400, corsHeaders);
    }

    const profileRes = await supabaseServiceRequest(
      env, SUPABASE_URL,
      `/rest/v1/profiles?email=eq.${encodeURIComponent(email)}&select=id,username`,
      "GET"
    );
    const profiles = await profileRes.json();
    if (!profiles || profiles.length === 0) {
      return json({ error: "No user found with that email" }, 404, corsHeaders);
    }
    const targetId = profiles[0].id;

    // Stacking logic for admin grant too
    let baseDateAdmin = new Date();
    try {
      const existingResAdmin = await supabaseServiceRequest(
        env, SUPABASE_URL,
        `/rest/v1/profiles?id=eq.${encodeURIComponent(targetId)}&select=expires_at`,
        "GET"
      );
      const existingRowsAdmin = await existingResAdmin.json();
      if (existingRowsAdmin && existingRowsAdmin.length > 0 && existingRowsAdmin[0].expires_at) {
        const existingExpAdmin = new Date(existingRowsAdmin[0].expires_at);
        if (!isNaN(existingExpAdmin.getTime()) && existingExpAdmin.getTime() > Date.now()) {
          baseDateAdmin = existingExpAdmin;
        }
      }
    } catch (e) {}

    const expiresAt = new Date(baseDateAdmin.getTime() + Number(validity_days) * 24 * 60 * 60 * 1000).toISOString();

    const updateRes = await supabaseServiceRequest(
      env, SUPABASE_URL,
      `/rest/v1/profiles?id=eq.${encodeURIComponent(targetId)}`,
      "PATCH",
      { is_paid: true, expires_at: expiresAt }
    );

    if (!updateRes.ok) {
      const errDetails = await updateRes.json();
      return json({ error: "Failed to update profile", details: errDetails }, 502, corsHeaders);
    }

    // Dual-write to D1 with stacked expiry
    try {
      const expiresAtSeconds = Math.floor(new Date(expiresAt).getTime() / 1000);
      await env.DB.prepare(
        `INSERT INTO paid_users (uuid, is_paid, expires_at, updated_at)
         VALUES (?, 1, ?, unixepoch())
         ON CONFLICT(uuid) DO UPDATE SET
           is_paid = 1,
           expires_at = excluded.expires_at,
           updated_at = unixepoch()`
      ).bind(targetId, expiresAtSeconds).run();
    } catch (d1err) {
      console.error("D1 dual-write failed in handleAdminGrant:", d1err.message, "targetId:", targetId);
    }

    return json({ status: "ok", username: profiles[0].username, expires_at: expiresAt }, 200, corsHeaders);
  } catch (err) {
    return json({ error: err.message }, 500, corsHeaders);
  }
}

// ==================================================================
// ADMIN CANCEL PREMIUM — owner-only, by uuid.
// Mirrors handleAdminGrant's dual-write, just in reverse:
// 1) delete the D1 paid_users row (what the Gatekeeper Worker reads
//    at quiz-load time), 2) clear is_paid/expires_at on the profile.
// The admin panel resolves email/username/mobile -> uuid client-side
// (same lookup as the User Info tab) before calling this endpoint.
// ==================================================================
async function handleAdminCancelPremium(request, env, SUPABASE_URL, SUPABASE_ANON_KEY, corsHeaders) {
  try {
    const user = await getUserFromToken(request, SUPABASE_URL, SUPABASE_ANON_KEY);
    if (!user || !user.id) {
      return json({ error: "Not authenticated" }, 401, corsHeaders);
    }

    // Only 'owner' may cancel premium directly — same gate as admin-grant-premium.
    const isOwner = await verifyRole(env, SUPABASE_URL, user.id, ["owner"]);
    if (!isOwner) {
      return json({ error: "Forbidden — owner access required" }, 403, corsHeaders);
    }

    const { uuid } = await request.json();
    if (!uuid) {
      return json({ error: "Missing uuid" }, 400, corsHeaders);
    }

    // 1) D1 premium cache — delete outright, same as handleDeleteAccount.
    try {
      await env.DB.prepare("DELETE FROM paid_users WHERE uuid = ?").bind(uuid).run();
    } catch (d1err) {
      console.error("D1 delete failed in handleAdminCancelPremium:", d1err.message, "uuid:", uuid);
    }

    // 2) Profile — flip paid status off and clear expiry.
    const updateRes = await supabaseServiceRequest(
      env, SUPABASE_URL,
      `/rest/v1/profiles?id=eq.${encodeURIComponent(uuid)}`,
      "PATCH",
      { is_paid: false, expires_at: null }
    );
    if (!updateRes.ok) {
      const errDetails = await updateRes.json();
      return json({ error: "Failed to update profile", details: errDetails }, 502, corsHeaders);
    }
    const updatedRows = await updateRes.json();
    if (!updatedRows || updatedRows.length === 0) {
      return json({ error: "No profile found with that uuid" }, 404, corsHeaders);
    }

    return json({ status: "ok", username: updatedRows[0].username }, 200, corsHeaders);
  } catch (err) {
    return json({ error: err.message }, 500, corsHeaders);
  }
}

async function verifySignature(body, signature, secret) {
  if (!signature || !secret) return false;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBuffer = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  const expectedHex = [...new Uint8Array(sigBuffer)].map((b) => b.toString(16).padStart(2, "0")).join("");

  return expectedHex === signature;
}

// ==================================================================
// DELETE ACCOUNT — permanent server-side wipe
// (Play Store / data-safety requirement. Supabase auth users can only
//  be deleted with the service-role key, so it lives here, never in
//  the browser. Identity is proven from the caller's own access token.)
// ==================================================================
async function handleDeleteAccount(request, env, SUPABASE_URL, SUPABASE_ANON_KEY, corsHeaders) {
  try {
    const user = await getUserFromToken(request, SUPABASE_URL, SUPABASE_ANON_KEY);
    if (!user || !user.id) {
      return json({ error: "Not authenticated" }, 401, corsHeaders);
    }

    let confirmWord = "";
    try { confirmWord = ((await request.json()) || {}).confirm || ""; } catch (e) {}
    if (confirmWord !== "DELETE") {
      return json({ error: "Confirmation word missing or wrong" }, 400, corsHeaders);
    }

    const uid = user.id;

    // 1) Payments: unlink instead of destroy where possible (tax ledger
    //    keeps order/payment ids + amounts, but no longer points at the
    //    user). If the column refuses nulls, delete the rows instead.
    const payPatch = await supabaseServiceRequest(
      env, SUPABASE_URL,
      `/rest/v1/payments?user_id=eq.${encodeURIComponent(uid)}`,
      "PATCH", { user_id: null }
    );
    if (!payPatch.ok && payPatch.status !== 404) {
      await supabaseServiceRequest(
        env, SUPABASE_URL,
        `/rest/v1/payments?user_id=eq.${encodeURIComponent(uid)}`,
        "DELETE"
      );
    }

    // 2) Profile row — child tables with ON DELETE CASCADE follow it.
    const profDel = await supabaseServiceRequest(
      env, SUPABASE_URL,
      `/rest/v1/profiles?id=eq.${encodeURIComponent(uid)}`,
      "DELETE"
    );
    if (!profDel.ok && profDel.status !== 404) {
      const d = await profDel.json().catch(() => ({}));
      return json({ error: "Could not delete profile data", details: d }, 502, corsHeaders);
    }

    // 3) D1 premium cache read by the Gatekeeper worker at quiz-load.
    try {
      await env.DB.prepare("DELETE FROM paid_users WHERE uuid = ?").bind(uid).run();
    } catch (d1err) {
      // Supabase remains source of truth; log but don't fail the wipe.
      console.error("D1 delete failed in handleDeleteAccount:", d1err.message, "user_id:", uid);
    }

    // 4) The auth user itself — service-role admin call. Removes login
    //    identities, sessions and refresh tokens, and cascades any
    //    remaining FK rows in auth schema.
    const delRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${uid}`, {
      method: "DELETE",
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    });
    if (!delRes.ok && delRes.status !== 404) {
      const d = await delRes.json().catch(() => ({}));
      return json({ error: "Could not delete auth user", details: d }, 502, corsHeaders);
    }

    return json({ status: "deleted", id: uid }, 200, corsHeaders);
  } catch (err) {
    return json({ error: err.message }, 500, corsHeaders);
  }
}
