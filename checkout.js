// checkout.js — Razorpay checkout flow for Mock Matrix Hub Premium
// Requires: <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
// Requires: auth.js already loaded (provides _supabase client)

const WORKER_BASE = "https://auth.mockmatrixhub.in";

let plans = [];
let selectedPlan = null;
let appliedCoupon = null;

// -----------------------------------------------------------
// 0. Load all active plans from Supabase, pick / render selection
// -----------------------------------------------------------
async function loadPlans() {
  try {
    const { data, error } = await _supabase
      .from("pricing")
      .select("plan_name, original_price, offer_price, validity_days, coupon_applicable")
      .eq("is_active", true);

    if (error || !data || data.length === 0) return; // keep hardcoded fallback in HTML

    // Longest validity first (1 Year → 6 Months → 1 Month) so BOTH the
    // selector order and the default match the plan page, and the 365-day
    // plan is ALWAYS pre-selected on load.
    plans = data.slice().sort((a, b) => (Number(b.validity_days) || 0) - (Number(a.validity_days) || 0));

    if (plans.length > 1) {
      renderPlanSelector();
    }

    // Default = longest term (365 days). If the user already picked a plan on
    // page 1 moments ago (fresh localStorage stamp), keep THAT one selected so
    // the two pages never disagree.
    let initial = plans[0];
    try {
      const raw = localStorage.getItem("mmh_premium_sel");
      if (raw) {
        const o = JSON.parse(raw);
        if (o && o.backend && Date.now() - (Number(o.ts) || 0) < 10 * 60 * 1000) {
          const match = plans.find((p) => p.plan_name === o.backend);
          if (match) initial = match;
        }
      }
    } catch (e) { /* ignore */ }

    selectPlan(initial.plan_name);

    // Auto-apply a coupon passed via ?c=CODE in the URL (e.g. from a
    // shared referral/from.link). Must run AFTER selectPlan() above,
    // since applyCoupon() needs selectedPlan to already be set.
    applyCouponFromUrl();
  } catch (err) {
    // silently keep hardcoded fallback price if this fails
  }
}

// -----------------------------------------------------------
// 0.5 Auto-apply coupon from ?c=CODE query param
// -----------------------------------------------------------
function applyCouponFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("c");
  if (!code) return;

  const codeInput = document.getElementById("couponCode");
  if (codeInput) codeInput.value = code;

  applyCoupon(code);
}

function renderPlanSelector() {
  const container = document.getElementById("planSelector");
  container.innerHTML = "";
  container.style.display = "flex";

  plans.forEach((plan) => {
    const el = document.createElement("div");
    el.className = "plan-option";
    el.dataset.plan = plan.plan_name;
    el.innerHTML = `
      <div class="po-name">${termLabel(plan.validity_days)}</div>
      <div class="po-price">₹${plan.offer_price} · ${plan.validity_days}d</div>
    `;
    el.addEventListener("click", () => selectPlan(plan.plan_name));
    container.appendChild(el);
  });
}

// Friendly term label from validity_days — "1 Month" / "6 Months" / "1 Year"
function termLabel(days) {
  const d = Number(days) || 0;
  const months = Math.max(1, Math.round(d / 30.44));
  if (months % 12 === 0) return (months / 12) + (months === 12 ? " Year" : " Years");
  return months + (months === 1 ? " Month" : " Months");
}

function selectPlan(planName) {
  const plan = plans.find((p) => p.plan_name === planName);
  if (!plan) return;

  selectedPlan = plan;
  appliedCoupon = null;

  document.getElementById("planNameLabel").textContent = plan.plan_name + " Premium";
  document.getElementById("validityBadge").textContent = `VALID ${plan.validity_days} DAYS`;
  document.getElementById("originalPrice").textContent = plan.original_price;
  document.getElementById("finalPrice").textContent = plan.offer_price;

  document.getElementById("couponCode").value = "";

  // Coupon applicability — the pricing table now carries a
  // `coupon_applicable` flag. When false, hide the coupon box and say so
  // plainly (never show "invalid coupon" for a plan that simply doesn't
  // support coupons).
  const couponBox = document.getElementById("couponBox");
  const msgEl = document.getElementById("couponMsg");
  const couponOff = plan.coupon_applicable === false || String(plan.coupon_applicable) === "false";
  if (couponOff) {
    if (couponBox) couponBox.style.display = "none";
    msgEl.textContent = "Coupon not applicable on this plan";
    msgEl.style.color = "#b45309";
  } else {
    if (couponBox) couponBox.style.display = "";
    msgEl.textContent = "";
    msgEl.style.color = "";
  }

  document.querySelectorAll(".plan-option").forEach((el) => {
    el.classList.toggle("active", el.dataset.plan === planName);
  });
}

// -----------------------------------------------------------
// 1. Apply coupon — live price update, no payment yet
//
// Send the code exactly as the user typed it (just trimmed).
// The backend check is case-sensitive, so forcing uppercase here
// was causing valid lowercase-stored coupons to fail as "Invalid,
// inactive, or expired coupon".
// -----------------------------------------------------------
async function applyCoupon(codeOverride) {
  const codeInput = document.getElementById("couponCode");
  const msgEl = document.getElementById("couponMsg");
  const code = (codeOverride !== undefined ? codeOverride : codeInput.value).trim();
  codeInput.value = code;

  if (!selectedPlan) return;

  // Coupon not allowed on this plan (pricing.coupon_applicable = false).
  // Fail fast with the same message the checkout shows — the worker also
  // enforces this server-side, so a bypassed UI can't slip a coupon in.
  const couponOff = selectedPlan.coupon_applicable === false || String(selectedPlan.coupon_applicable) === "false";
  if (couponOff) {
    msgEl.style.color = "#b45309";
    msgEl.textContent = "Coupon not applicable on this plan";
    appliedCoupon = null;
    return;
  }

  if (!code) {
    msgEl.textContent = "";
    appliedCoupon = null;
    document.getElementById("finalPrice").textContent = selectedPlan.offer_price;
    return;
  }

  msgEl.style.color = "#64748b";
  msgEl.textContent = "Checking coupon...";

  try {
    const requestBody = { plan_name: selectedPlan.plan_name, coupon_code: code };
    console.log("[coupon-debug] sending:", requestBody, "to:", `${WORKER_BASE}/validate-coupon`);

    const res = await fetch(`${WORKER_BASE}/validate-coupon`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });

    console.log("[coupon-debug] response status:", res.status, res.statusText);

    const data = await res.json();
    console.log("[coupon-debug] response body:", data);

    if (!res.ok || !data.valid) {
      msgEl.style.color = "#dc2626";
      msgEl.textContent = data.error || "Invalid coupon code";
      appliedCoupon = null;
      return;
    }

    appliedCoupon = code;
    document.getElementById("finalPrice").textContent = data.final_amount;
    msgEl.style.color = "#16a34a";
    msgEl.textContent = `Coupon applied — ${data.discount_percent}% off`;
  } catch (err) {
    console.error("[coupon-debug] fetch threw an error:", err);
    msgEl.style.color = "#dc2626";
    msgEl.textContent = "Could not check coupon, try again";
    appliedCoupon = null;
  }
}

function showAlreadyPremium(expiresAt) {
  const btn = document.getElementById("payBtn");
  btn.disabled = true;
  btn.innerText = "Already Premium ✓";
  btn.style.background = "#16a34a";

  const msgEl = document.getElementById("couponMsg");
  const expInfo = document.getElementById("expiringInfo");
  if(expInfo){ expInfo.style.display='none'; expInfo.innerHTML=''; }
  const validText = expiresAt
    ? `You already have Premium, valid until ${new Date(expiresAt).toDateString()}.`
    : "You already have Premium access.";
  msgEl.style.color = "#16a34a";
  msgEl.textContent = validText;
}

function showExpiringSoon(expiresAt) {
  const btn = document.getElementById("payBtn");
  btn.disabled = false;
  btn.innerText = "Buy Now — Extend Premium";
  btn.style.background = "";

  const msgEl = document.getElementById("couponMsg");
  msgEl.textContent = "";
  const expInfo = document.getElementById("expiringInfo");
  if(!expInfo) return;
  const d = new Date(expiresAt);
  const dateStr = isNaN(d) ? String(expiresAt) : d.toLocaleString('en-IN', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit', hour12:true });
  expInfo.style.display = 'block';
  expInfo.innerHTML = `
    <div>⚠️ Your premium is expiring at <span class="exp-date">📅 ${dateStr}</span></div>
    <div style="margin-top:6px">Buy now — <b>validity will be counted after existing plan expires</b>. No days lost, your new plan starts after <b>${dateStr}</b>.</div>
  `;
}
window.showExpiringSoon = showExpiringSoon;


async function checkAlreadyPremiumOnLoad() {
  const { data: sessionData } = await getSessionOnce(_supabase);
  const userId = sessionData?.session?.user?.id;
  if (!userId) return;

  const { data: profile } = await _supabase
    .from("profiles")
    .select("is_paid, expires_at")
    .eq("id", userId)
    .maybeSingle();

  const stillValid = profile && profile.is_paid &&
    (!profile.expires_at || new Date(profile.expires_at) > new Date());

  if (stillValid) {
    // if expiring within 48h, allow renewal with stacking message
    let msLeft = null;
    try{
      if(profile.expires_at){
        const exp = window.parseExpiryDate ? window.parseExpiryDate(profile.expires_at) : new Date(profile.expires_at);
        if(exp) msLeft = exp.getTime() - Date.now();
      }
    }catch(e){}
    const isExpiringSoon = msLeft !== null && msLeft > 0 && msLeft <= 48*60*60*1000;
    if(isExpiringSoon){
      showExpiringSoon(profile.expires_at);
    } else {
      showAlreadyPremium(profile.expires_at);
    }

    // DB says paid, but if the local cache is stale (still shows free —
    // e.g. cached before this payment, or from before the 7-day refresh),
    // fix it here too. Otherwise the user sees "Already Premium" on this
    // page but other pages (which read getLocalProfile(), not the DB)
    // would still show them as free until the cache naturally expires.
    const cached = getLocalProfile();
    if (cached && !cached.is_paid) {
      saveLocalProfile({ ...cached, is_paid: true, expires_at: profile.expires_at });
    }
  }
}

function showSuccessBanner() {
  const processing = document.getElementById("processingOverlay");
  if (processing) processing.classList.remove("active");

  const success = document.getElementById("successOverlay");
  if (success) success.classList.add("active");

  setTimeout(() => {
    window.location.href = "/index.html";
  }, 1800);
}

// -----------------------------------------------------------
// 1.5 Recover from a killed tab mid-payment — same job as the
// check in index.html, but this one runs on buy-premium.html
// itself, since Android usually relaunches a killed PWA back on
// the exact page it died on, not on index.html.
// -----------------------------------------------------------
async function recoverPendingPayment() {
  const raw = localStorage.getItem("mmh_payment_pending");
  if (!raw) return;

  let pending;
  try { pending = JSON.parse(raw); } catch (e) { localStorage.removeItem("mmh_payment_pending"); return; }

  const oneHour = 60 * 60 * 1000;
  if (!pending.ts || Date.now() - pending.ts > oneHour) {
    localStorage.removeItem("mmh_payment_pending");
    return;
  }

  // Silent recovery — NO overlay flash and NO "payment received" alert.
  // A cancelled payment must never haunt the next visit; a real one is
  // confirmed by the webhook within seconds. getSession() reads the
  // locally persisted session (fast, no network round-trip needed unless
  // actually near expiry).
  const { data: sessionData } = await getSessionOnce(_supabase);
  const userId = sessionData?.session?.user?.id;
  if (!userId) { localStorage.removeItem("mmh_payment_pending"); return; }

  const { data: profile } = await _supabase
    .from("profiles")
    .select("is_paid, expires_at")
    .eq("id", userId)
    .maybeSingle();

  if (profile && profile.is_paid) {
    const cached = getLocalProfile() || {};
    saveLocalProfile({ ...cached, is_paid: true, expires_at: profile.expires_at });
    localStorage.removeItem("mmh_payment_pending");
    showSuccessBanner();
    return;
  }

  // Not confirmed yet — poll briefly and QUIETLY (no alert at the end:
  // an unconfirmed flag almost always means the user cancelled, and a
  // genuinely late webhook will still flip access on the next visit).
  quietPollForAccess();
}

// Short silent version of pollForAccess for pending-flag recovery.
// Max ~18s; on give-up it just drops the flag instead of alerting.
function quietPollForAccess() {
  const maxAttempts = 6;
  let attempts = 0;

  const interval = setInterval(async () => {
    attempts++;
    const { data: sessionData } = await getSessionOnce(_supabase);
    const userId = sessionData?.session?.user?.id;

    if (userId) {
      const { data: profile } = await _supabase
        .from("profiles")
        .select("is_paid, expires_at")
        .eq("id", userId)
        .maybeSingle();

      if (profile && profile.is_paid) {
        clearInterval(interval);
        const cached = getLocalProfile() || {};
        saveLocalProfile({ ...cached, is_paid: true, expires_at: profile.expires_at });
        localStorage.removeItem("mmh_payment_pending");
        showSuccessBanner();
        return;
      }
    }

    if (attempts >= maxAttempts) {
      clearInterval(interval);
      localStorage.removeItem("mmh_payment_pending");
    }
  }, 3000);
}

// -----------------------------------------------------------
// 2. Start checkout — creates order, opens Razorpay modal
// -----------------------------------------------------------
async function startCheckout() {
  const btn = document.getElementById("payBtn");
  if (!selectedPlan) return;

  btn.disabled = true;
  btn.innerText = "Preparing checkout...";

  try {
    const { data: sessionData } = await getSessionOnce(_supabase);
    const token = sessionData?.session?.access_token;
    const userEmail = sessionData?.session?.user?.email || "";

    if (!token) {
      alert("Please login to continue.");
      window.location.href = "/login.html?redirect=/buy-premium.html";
      return;
    }

    // Check live is_paid + expires_at from profiles before creating an order —
    // don't let an already-premium user pay again.
    // (userId comes straight from the session above — no need for a
    // second, separate getUser() network round-trip that could fail
    // on its own even when the session itself is perfectly valid.)
    const userId = sessionData?.session?.user?.id;

    if (userId) {
      const { data: profile } = await _supabase
        .from("profiles")
        .select("is_paid, expires_at")
        .eq("id", userId)
        .maybeSingle();

      const stillValid = profile && profile.is_paid &&
        (!profile.expires_at || new Date(profile.expires_at) > new Date());

      if (stillValid) {
        let msLeft = null;
        try{
          if(profile.expires_at){
            const exp = window.parseExpiryDate ? window.parseExpiryDate(profile.expires_at) : new Date(profile.expires_at);
            if(exp) msLeft = exp.getTime() - Date.now();
          }
        }catch(e){}
        const isExpiringSoon = msLeft !== null && msLeft > 0 && msLeft <= 48*60*60*1000;
        if(!isExpiringSoon){
          showAlreadyPremium(profile.expires_at);
          return;
        }
        // expiring soon -> allow checkout, stacking handled in worker
      }
    }

    const res = await fetch(`${WORKER_BASE}/create-order`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        plan_name: selectedPlan.plan_name,
        coupon_code: appliedCoupon || undefined,
      }),
    });

    const order = await res.json();

    if (!res.ok) {
      alert("Could not start checkout: " + (order.error || "unknown error") + "\n\nDetails: " + JSON.stringify(order.details || {}));
      btn.disabled = false;
      btn.innerText = "Continue";
      return;
    }

    // Mark a payment as pending BEFORE opening the modal — if the tab gets
    // killed while the user is in a UPI app and reloads later, index.html
    // will see this flag and force a fresh profile check on its own.
    localStorage.setItem("mmh_payment_pending", JSON.stringify({ ts: Date.now() }));

    const options = {
      key: order.key_id,
      amount: order.amount * 100,
      currency: order.currency,
      name: "Mock Matrix Hub",
      description: `${order.plan_name} Premium`,
      order_id: order.order_id,
      prefill: { email: userEmail },
      handler: function (response) {
        // This fires client-side on success — NOT the source of truth.
        // The webhook confirms the payment server-side; we just start polling.
        // Show the full-screen "don't close / wait for redirect" overlay right
        // now, since this is exactly the window where users tend to bail out.
        document.getElementById("processingOverlay").classList.add("active");
        btn.innerText = "Confirming payment...";
        pollForAccess();
      },
      modal: {
        ondismiss: function () {
          // User closed the Razorpay modal = payment cancelled. Drop the
          // pending flag here, otherwise the next page load thinks a
          // payment is still in flight (and later shows a false
          // "payment received" warning after polling gives up).
          localStorage.removeItem("mmh_payment_pending");
          btn.disabled = false;
          btn.innerText = "Continue";
        },
      },
      theme: { color: "#2563eb" },
      config: {
        display: {
          blocks: {
            qr_block: {
              name: "Pay via UPI QR",
              instruments: [{ method: "upi", flows: ["qr"] }],
            },
          },
          sequence: ["block.qr_block"],
          preferences: { show_default_blocks: true },
        },
      },
    };

    // Android app (Capacitor WebView): enable Razorpay's UPI-intent flow so
    // tapping GPay / PhonePe / Paytm / BHIM opens those apps instead of
    // silently doing nothing. Flag is added ONLY inside the native app —
    // website behaviour is unchanged.
    try {
        if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) {
            options.webview_intent = true;
        }
    } catch (e) { /* ignore */ }

    const rzp = new Razorpay(options);

    rzp.on("payment.failed", function (response) {
      localStorage.removeItem("mmh_payment_pending");
      alert("Payment failed: " + response.error.description);
      btn.disabled = false;
      btn.innerText = "Continue";
    });

    rzp.open();
  } catch (err) {
    alert("Something went wrong: " + err.message);
    btn.disabled = false;
    btn.innerText = "Continue";
  }
}

// -----------------------------------------------------------
// 3. Poll profile.is_paid until the webhook has processed it
// -----------------------------------------------------------
async function pollForAccess() {
  const btn = document.getElementById("payBtn");
  const maxAttempts = 20; // ~60 seconds at 3s interval
  let attempts = 0;

  const interval = setInterval(async () => {
    attempts++;
    const { data: sessionData } = await getSessionOnce(_supabase);
    const userId = sessionData?.session?.user?.id;

    if (userId) {
      const { data: profile } = await _supabase
        .from("profiles")
        .select("is_paid, expires_at")
        .eq("id", userId)
        .maybeSingle();

      if (profile && profile.is_paid) {
        clearInterval(interval);
        const cached = getLocalProfile() || {};
        saveLocalProfile({ ...cached, is_paid: true, expires_at: profile.expires_at });
        localStorage.removeItem("mmh_payment_pending");
        showSuccessBanner();
        return;
      }
    }

    if (attempts >= maxAttempts) {
      clearInterval(interval);
      document.getElementById("processingOverlay").classList.remove("active");
      alert(
        "Payment received, but confirmation is taking longer than usual. " +
        "Please check back in a few minutes — your access will activate automatically."
      );
      btn.disabled = false;
      btn.innerText = "Continue";
    }
  }, 3000);
}

// -----------------------------------------------------------
// 4. Pre-payment instruction popup — must be acknowledged (checkbox)
// before Razorpay actually opens. The main "Continue" button on the
// page never calls startCheckout() directly anymore; it only opens
// this popup. startCheckout() only runs from the popup's own
// Continue button, once the checkbox is checked.
// -----------------------------------------------------------
function openInstructionPopup() {
  const overlay = document.getElementById("paymentInstructionOverlay");
  const checkbox = document.getElementById("popupAckCheckbox");
  const popupBtn = document.getElementById("popupContinueBtn");

  checkbox.checked = false;
  popupBtn.disabled = true;
  overlay.classList.add("active");
}

function closeInstructionPopup() {
  document.getElementById("paymentInstructionOverlay").classList.remove("active");
}

// -----------------------------------------------------------
// Wire up events
// -----------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  loadPlans();
  recoverPendingPayment();
  checkAlreadyPremiumOnLoad();

  const applyBtn = document.getElementById("applyCouponBtn");
  const payBtn = document.getElementById("payBtn");
  const popupCheckbox = document.getElementById("popupAckCheckbox");
  const popupBtn = document.getElementById("popupContinueBtn");

  if (applyBtn) applyBtn.addEventListener("click", () => applyCoupon());

  // Main "Continue" button -> open instructions popup (does NOT open Razorpay directly)
  // If the on-load check already disabled this button (already premium), this
  // handler simply never fires — disabled buttons don't dispatch click events.
  if (payBtn) payBtn.addEventListener("click", openInstructionPopup);

  // Checkbox enables/disables the popup's own Continue button
  if (popupCheckbox) {
    popupCheckbox.addEventListener("change", () => {
      popupBtn.disabled = !popupCheckbox.checked;
    });
  }

  // Popup's Continue -> close popup, THEN actually start Razorpay checkout
  if (popupBtn) {
    popupBtn.addEventListener("click", () => {
      if (popupCheckbox.checked) {
        closeInstructionPopup();
        startCheckout();
      }
    });
  }
});
