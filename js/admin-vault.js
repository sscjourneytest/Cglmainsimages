/* ════════════════════════════════════════════════════════════════════════
   Admin Vault — engine. Backend contract IDENTICAL to the previous version
   (same tables, queries, worker endpoint, IST maths, PDF receipt).
   UI layer upgraded: toasts + styled confirm/prompt dialogs instead of
   native alert/confirm/prompt, count-up stats, theme parity with the app.
   ════════════════════════════════════════════════════════════════════════ */
const WORKER_BASE = "https://auth.mockmatrixhub.in";
let myRole = null;
let myToken = null;
let myUserId = null;
let myEmail = null;
let myUsername = null;

const el = (id) => document.getElementById(id);

// -----------------------------------------------------------
// Theme — OWNED BY THE COMMON SHELL (/js/app-shell.js): mmh_theme key,
// sun/moon icon swap, meta status-bar colour (#121a30 / #ffffff). This page
// keeps zero theme logic of its own — it only paints once via the shell and
// wires its header button to the shell's toggleTheme(), exactly like the
// exam/hub pages do. (The two tiny pre-paint scripts in <head>/<body> only
// set classes before the shell file executes, to avoid a theme flash.)
// -----------------------------------------------------------
function initTheme() {
    if (typeof window.applyTheme === 'function' && typeof window.currentTheme === 'function') {
        window.applyTheme(window.currentTheme());
    }
    const b = el('themeBtn');
    if (b && typeof window.toggleTheme === 'function') {
        b.addEventListener('click', () => window.toggleTheme());
    }
}

// -----------------------------------------------------------
// Adaptive appbar — verbatim port of home-engine.js fitAppbar()
// Walks a shrink ladder (.appbar-fit-1…5) until the COMPLETE brand name /
// tagline fits — never an ellipsis. The header BOX never changes size; only
// the inner items shrink, so the fitted state persists.
// -----------------------------------------------------------
const APPBAR_FIT_LEVELS = 5;
function fitAppbar() {
    const bar = document.querySelector('.appbar');
    const title = bar && bar.querySelector('.brand-title');
    const sub = bar && bar.querySelector('.brand-sub');
    if (!bar || !title) return;

    // Measure with transitions killed — mid-animation widths gave false
    // "it fits" reads and the fit bounced straight back to normal.
    bar.classList.add('appbar-measuring');
    bar.classList.remove('appbar-compact', 'appbar-wrap');   // compact = legacy, never re-added
    for (let i = 1; i <= APPBAR_FIT_LEVELS; i++) bar.classList.remove('appbar-fit-' + i);

    const stripped = () =>
        title.scrollWidth > title.clientWidth + 1 ||
        !!(sub && sub.scrollWidth > sub.clientWidth + 1);

    let lvl = 0;
    while (stripped() && lvl < APPBAR_FIT_LEVELS) {
        lvl++;
        bar.classList.add('appbar-fit-' + lvl);   // inner items step down, boxes stay
    }
    if (stripped()) bar.classList.add('appbar-wrap');   // last resort: wrap, never "…"
    bar.classList.remove('appbar-measuring');
}
window.fitAppbar = fitAppbar;

let _appbarFitT = null;
window.addEventListener('resize', () => {
    clearTimeout(_appbarFitT);
    _appbarFitT = setTimeout(fitAppbar, 150);
});
window.addEventListener('load', fitAppbar);
window.addEventListener('pageshow', fitAppbar);   // bfcache back-navigation restores stale widths
// webfonts landing change text metrics — refit once they are ready
if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
    document.fonts.ready.then(() => fitAppbar()).catch(() => {});
}
fitAppbar();
setTimeout(fitAppbar, 500);      // after auth chip / badges settle
// refit on every header-action mutation (theme icon swap, sync badge) so the
// fitted state persists — observe ONLY .appbar-actions: fitAppbar() mutates
// classes on .appbar itself, so watching the whole header would self-trigger
if (window.MutationObserver) {
    const _appbarMO = new MutationObserver(() => fitAppbar());
    const _actions = document.querySelector('.appbar-actions');
    if (_actions) _appbarMO.observe(_actions, { childList: true, subtree: true, attributes: true, characterData: true });
}
// header images (logo) can land late on slow connections — refit when
// they finally paint, or fail and swap to the fallback svg
document.querySelectorAll('.screen-header img').forEach(im => {
    im.addEventListener('load', fitAppbar);
    im.addEventListener('error', fitAppbar);
});

// -----------------------------------------------------------
// Toasts (replace alert)
// -----------------------------------------------------------
function toast(message, type) {
    const root = el('avToastRoot');
    if (!root) return;
    const node = document.createElement('div');
    node.className = 'av-toast ' + (type || '');
    const ico = type === 'err'
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7.5V13M12 16.5h.01"/></svg>'
        : type === 'warn'
            ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4M12 17h.01"/></svg>'
            : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12.5 9.5 17.5 19.5 6.5"/></svg>';
    node.innerHTML = ico + '<span></span>';
    node.querySelector('span').textContent = message;
    root.appendChild(node);
    setTimeout(() => { node.classList.add('out'); setTimeout(() => node.remove(), 260); }, 3200);
}
window.avToast = toast;

// -----------------------------------------------------------
// Styled confirm / prompt (replace native dialogs)
// -----------------------------------------------------------
let _dlgResolve = null;
function _avDialogOpen(message, isPrompt, title) {
    return new Promise((resolve) => {
        _dlgResolve = resolve;
        el('avDialogTitle').textContent = title || (isPrompt ? 'Input required' : 'Please confirm');
        el('avDialogMsg').textContent = message || '';
        const inp = el('avDialogInput');
        inp.style.display = isPrompt ? 'block' : 'none';
        inp.value = '';
        el('avDialogOk').textContent = isPrompt ? 'Submit' : 'Confirm';
        el('avDialog').classList.add('active');
        if (isPrompt) setTimeout(() => inp.focus(), 40);
    });
}
function _avDialogClose(value) {
    el('avDialog').classList.remove('active');
    const r = _dlgResolve; _dlgResolve = null;
    if (r) r(value);
}
function avConfirm(message, title) { return _avDialogOpen(message, false, title); }
function avPrompt(message, title) { return _avDialogOpen(message, true, title); }
window.avConfirm = avConfirm;
window.avPrompt = avPrompt;
document.addEventListener('DOMContentLoaded', () => {
    el('avDialogOk').addEventListener('click', () => {
        const inp = el('avDialogInput');
        _avDialogClose(inp.style.display === 'none' ? true : inp.value);
    });
    el('avDialogCancel').addEventListener('click', () => _avDialogClose(null));
    el('avDialogInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') _avDialogClose(el('avDialogInput').value);
    });
    el('avDialog').addEventListener('click', (e) => { if (e.target === el('avDialog')) _avDialogClose(null); });
});

// -----------------------------------------------------------
// Count-up numbers
// -----------------------------------------------------------
function avCountUp(node, value, prefix) {
    if (!node) return;
    const target = Number(value) || 0;
    prefix = prefix || '';
    const fmt = (v) => prefix + Math.round(v).toLocaleString('en-IN');
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        node.textContent = fmt(target);
        return;
    }
    const dur = 700;
    const t0 = performance.now();
    function step(t) {
        const k = Math.min(1, (t - t0) / dur);
        const e = 1 - Math.pow(1 - k, 3);
        node.textContent = fmt(target * e);
        if (k < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
}

// -----------------------------------------------------------
// Pagination helper
// Supabase/PostgREST caps any unpaginated select() at 1000 rows.
// This walks a query in pages of 1000 using .range() until a
// short page tells us we've hit the end, so totals (revenue,
// counts, coupon usage, clearance amounts, etc.) are correct no
// matter how many rows the table has.
// queryFactory must be a function that returns a FRESH, unexecuted
// Supabase query each time it's called (so .range() can be applied
// per page) — not an already-built/awaited query object.
// -----------------------------------------------------------
async function fetchAllRows(queryFactory, pageSize = 1000) {
    let allRows = [];
    let offset = 0;
    while (true) {
        const { data, error } = await queryFactory().range(offset, offset + pageSize - 1);
        if (error) {
            console.error("fetchAllRows error:", error);
            break;
        }
        const rows = data || [];
        allRows = allRows.concat(rows);
        if (rows.length < pageSize) break;
        offset += pageSize;
    }
    return allRows;
}

// -----------------------------------------------------------
// IST helpers
// All "day" boundaries and calendar-date groupings in this file
// are anchored to IST (UTC+5:30), not the browser's local zone
// and not raw UTC. created_at in Supabase is stored in UTC, so
// every comparison/grouping converts through these helpers.
// -----------------------------------------------------------
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

// Returns a Date representing the UTC instant equal to IST midnight
// for "today" (or for an arbitrary Date passed in).
function istMidnightUTC(baseDate = new Date()) {
    const istNow = new Date(baseDate.getTime() + IST_OFFSET_MS);
    const y = istNow.getUTCFullYear();
    const m = istNow.getUTCMonth();
    const d = istNow.getUTCDate();
    return new Date(Date.UTC(y, m, d) - IST_OFFSET_MS);
}

// Parses a "YYYY-MM-DD" <input type="date"> value as IST midnight
// (not UTC midnight, which is what `new Date("YYYY-MM-DD")` gives).
function istDateInputToUTC(dateStr) {
    const [y, m, d] = dateStr.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d) - IST_OFFSET_MS);
}

// Given an ISO timestamp string, returns its IST calendar date
// as "YYYY-MM-DD" for grouping purposes.
function toISTDateKey(isoString) {
    const istDate = new Date(new Date(isoString).getTime() + IST_OFFSET_MS);
    return istDate.toISOString().slice(0, 10);
}

// Formats an ISO timestamp as an IST time string, e.g. "8:49 AM".
function toISTTimeLabel(isoString) {
    return new Date(isoString).toLocaleTimeString("en-IN", {
        timeZone: "Asia/Kolkata",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
    });
}

// Formats a "YYYY-MM-DD" IST date key as a readable date, e.g. "Fri Jul 24 2026".
function istDateKeyToLabel(dateKey) {
    const [y, m, d] = dateKey.split("-").map(Number);
    return new Date(y, m - 1, d).toDateString();
}

// -----------------------------------------------------------
// Role gate
// -----------------------------------------------------------
document.addEventListener("DOMContentLoaded", async () => {
    initTheme();   // common shell (app-shell.js) owns theme state
    el('syncBtn').addEventListener('click', refreshAll);

    const { data: sessionData } = await _supabase.auth.getSession();
    const session = sessionData && sessionData.session;

    if (!session) {
        if (!window.STANDALONE_DEMO) {
            window.location.href = "/login.html?redirect=/admin-vault.html";
        }
        return;
    }
    myToken = session.access_token;
    myUserId = session.user.id;
    myEmail = session.user.email;

    const { data: profile } = await _supabase
        .from("profiles")
        .select("role, username")
        .eq("id", session.user.id)
        .maybeSingle();

    myRole = profile && profile.role;
    myUsername = (profile && profile.username) || myEmail;

    if (!["owner", "subowner", "admin"].includes(myRole)) {
        el("deniedScreen").style.display = "block";
        return;
    }

    if (myRole === "owner") document.body.classList.add("role-owner");

    const ownerDisplay = el("saleOwnerDisplay");
    if (ownerDisplay) ownerDisplay.value = `${myUsername} (${myEmail})`;

    el("vaultApp").style.display = "block";
    initTabs();

    loadStats();
    loadRevenue("today");
    loadCoupons();
    loadPricing();
    loadPayouts();
    loadLegacyPayments();
    initClearanceTab();
    wireForms();
    initUserInfoTab();
    initCancelPremiumTab();
});

// -----------------------------------------------------------
// Refresh everything (appbar sync button)
// -----------------------------------------------------------
let _lastRevenueArgs = ["today"];
async function refreshAll() {
    const btn = el('syncBtn');
    btn.classList.add('spinning');
    btn.disabled = true;
    try {
        loadStats();
        loadRevenue.apply(null, _lastRevenueArgs);
        loadCoupons();
        loadPricing();
        loadPayouts();
        loadLegacyPayments();
        refreshClearanceFromDate().then(() => {
            updateNotClearedStat();
            loadClearanceHistory();
            loadSummaryTable();
        });
        toast('Vault data refreshed', 'ok');
    } finally {
        setTimeout(() => { btn.classList.remove('spinning'); btn.disabled = false; }, 600);
    }
}

// -----------------------------------------------------------
// Tabs
// -----------------------------------------------------------
function initTabs() {
    document.querySelectorAll(".tab-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
            document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
            btn.classList.add("active");
            el("tab-" + btn.dataset.tab).classList.add("active");
        });
    });
}

// -----------------------------------------------------------
// Stats
// -----------------------------------------------------------
async function loadStats() {
    const { count: totalUsers } = await _supabase.from("profiles").select("*", { count: "exact", head: true });
    const { count: paidUsers } = await _supabase.from("profiles").select("*", { count: "exact", head: true }).eq("is_paid", true);
    const allPayments = await fetchAllRows(() => _supabase.from("payments").select("amount_paid"));

    const totalRevenue = allPayments.reduce((sum, p) => sum + Number(p.amount_paid), 0);

    avCountUp(el("statTotalUsers"), totalUsers ?? 0, "");
    avCountUp(el("statPaidUsers"), paidUsers ?? 0, "");
    avCountUp(el("statTotalRevenue"), totalRevenue, "₹");
}

// -----------------------------------------------------------
// Revenue tab
// -----------------------------------------------------------
// State for the flat, paginated transaction table.
const REVENUE_PAGE_SIZE = 10;
let revenueRows = [];      // all payments for the current filter, newest first
let revenueRowsShown = 0;  // how many rows are currently rendered

function initRevenueFilters() {
    document.querySelectorAll(".filter-btn[data-range]").forEach((btn) => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".filter-btn[data-range]").forEach((b) => b.classList.remove("active"));
            btn.classList.add("active");
            loadRevenue(btn.dataset.range);
        });
    });
    el("customApply").addEventListener("click", async () => {
        const from = el("customFrom").value;
        const to = el("customTo").value;
        if (!from || !to) return toast("Pick both dates", "warn");
        document.querySelectorAll(".filter-btn[data-range]").forEach((b) => b.classList.remove("active"));
        loadRevenue("custom", from, to);
    });
    const viewMoreBtn = el("revenueViewMoreBtn");
    if (viewMoreBtn) {
        viewMoreBtn.addEventListener("click", () => {
            revenueRowsShown += REVENUE_PAGE_SIZE;
            renderRevenueTable();
        });
    }
}
initRevenueFilters();

async function loadRevenue(range, customFrom, customTo) {
    _lastRevenueArgs = [range, customFrom, customTo];
    let fromDate;

    if (range === "today") {
        fromDate = istMidnightUTC();
    } else if (range === "7") {
        fromDate = new Date(istMidnightUTC().getTime() - 6 * 86400000);
    } else if (range === "30") {
        fromDate = new Date(istMidnightUTC().getTime() - 29 * 86400000);
    } else if (range === "all") {
        fromDate = new Date("2000-01-01");
    } else if (range === "custom") {
        fromDate = istDateInputToUTC(customFrom);
    }

    let toDate = null;
    if (range === "custom" && customTo) {
        const toStart = istDateInputToUTC(customTo);
        toDate = new Date(toStart.getTime() + 86400000 - 1);
    }

    const rows = await fetchAllRows(() => {
        let q = _supabase.from("payments").select("amount_paid, coupon_code, user_id, created_at").gte("created_at", fromDate.toISOString());
        if (toDate) q = q.lte("created_at", toDate.toISOString());
        return q.order("created_at", { ascending: false });
    });

    const total = rows.reduce((s, p) => s + Number(p.amount_paid), 0);
    avCountUp(el("periodRevenue"), total, "₹");
    avCountUp(el("periodCount"), rows.length, "");

    // Flat, newest-first list of every transaction in the selected range.
    revenueRows = rows;

    // Default: first page only.
    revenueRowsShown = Math.min(REVENUE_PAGE_SIZE, revenueRows.length);

    renderRevenueTable();
}

function renderRevenueTable() {
    const tbody = el("revenueTable");
    const viewMoreBtn = el("revenueViewMoreBtn");

    const rowsToShow = revenueRows.slice(0, revenueRowsShown);

    let html = "";
    let lastDateKey = null;
    rowsToShow.forEach((p) => {
        const dateKey = toISTDateKey(p.created_at);
        if (dateKey !== lastDateKey) {
            html += `<tr class="date-divider"><td colspan="4"><b>${istDateKeyToLabel(dateKey)}</b></td></tr>`;
            lastDateKey = dateKey;
        }
        html += `<tr>
      <td>${toISTTimeLabel(p.created_at)}</td>
      <td><b>₹${Number(p.amount_paid).toLocaleString("en-IN")}</b></td>
      <td>${p.coupon_code || "-"}</td>
      <td class="av-mono">${p.user_id}</td>
    </tr>`;
    });

    tbody.innerHTML = html || '<tr><td colspan="4">No payments in this period.</td></tr>';

    if (viewMoreBtn) {
        const hasMore = revenueRowsShown < revenueRows.length;
        viewMoreBtn.style.display = hasMore ? "inline-block" : "none";
    }
}

// -----------------------------------------------------------
// Coupons tab
// -----------------------------------------------------------
let partnerCoupons = [];   // coupons owned by normal partners
let staffCoupons = [];     // coupons owned by owner/subowner/admin

async function loadCoupons() {
    const { data: pending } = await _supabase.from("coupon_requests").select("*").eq("status", "pending");
    let pHtml = "";
    (pending || []).forEach((r) => {
        pHtml += `<tr>
      <td><b>${r.username}</b><br><small>${r.email}</small></td>
      <td><b>${r.requested_code}</b></td>
      <td style="max-width:180px; overflow-wrap:anywhere;">${
        r.channel_links
            ? `<a class="btn-sm edit" href="${r.channel_links}" target="_blank" rel="noopener noreferrer">Open Link</a>`
            : "-"
      }</td>
      <td>${r.upi_id || "-"}</td>
      <td><input type="number" class="inline-input" id="disc-${r.id}" value="20"></td>
      <td><input type="number" class="inline-input" id="pay-${r.id}" value="20"></td>
      <td>
        <button class="btn-sm approve" onclick="approveCouponRequest('${r.id}','${r.user_id}','${r.username}','${r.requested_code}','${r.upi_id || ""}','${r.email}')">Approve</button>
        <button class="btn-sm reject" onclick="rejectCouponRequest('${r.id}')">Reject</button>
      </td>
    </tr>`;
    });
    el("pendingCouponTable").innerHTML = pHtml || '<tr><td colspan="7">No pending requests.</td></tr>';

    const { data: coupons } = await _supabase.from("coupons").select("*").order("code");
    const { data: staffProfiles } = await _supabase.from("profiles").select("id").in("role", ["owner", "subowner", "admin"]);
    const staffIds = new Set((staffProfiles || []).map((p) => p.id));
    const payments = await fetchAllRows(() => _supabase.from("payments").select("amount_paid, coupon_code"));

    partnerCoupons = (coupons || []).filter((c) => !staffIds.has(c.owner_user_id));
    staffCoupons = (coupons || []).filter((c) => staffIds.has(c.owner_user_id));

    el("couponsTablePartner").innerHTML =
        renderCouponRows(partnerCoupons, payments) || '<tr><td colspan="9">No partner coupons yet.</td></tr>';
    el("couponsTableStaff").innerHTML =
        renderCouponRows(staffCoupons, payments) || '<tr><td colspan="9">No owner/sub-owner/admin coupons yet.</td></tr>';
}

function renderCouponRows(list, payments) {
    let html = "";
    list.forEach((c) => {
        const uses = payments.filter((p) => p.coupon_code === c.code);
        const revenue = uses.reduce((s, p) => s + Number(p.amount_paid), 0);
        const validValue = c.valid_until ? toISTDateKey(c.valid_until) : "";
        html += `<tr>
      <td><b>${c.code}</b></td>
      <td>${c.owner_name || "-"}</td>
      <td><input type="number" class="inline-input" id="edit-disc-${c.id}" value="${c.discount_percent}"></td>
      <td><input type="number" class="inline-input" id="edit-pay-${c.id}" value="${c.payout_percent}"></td>
      <td><input type="date" class="inline-input" id="edit-valid-${c.id}" value="${validValue}"></td>
      <td><b>₹${revenue.toLocaleString("en-IN")}</b></td>
      <td>${uses.length}</td>
      <td><span class="badge ${c.is_active ? "on" : "off"}">${c.is_active ? "Active" : "Inactive"}</span></td>
      <td>
        <button class="btn-sm edit" onclick="saveCouponEdits('${c.id}')">Save</button>
        <button class="btn-sm toggle" onclick="toggleCoupon('${c.id}', ${c.is_active})">${c.is_active ? "Deactivate" : "Activate"}</button>
      </td>
    </tr>`;
    });
    return html;
}

async function approveCouponRequest(reqId, userId, username, code, upiId, email) {
    const discount = Number(el(`disc-${reqId}`).value) || 20;
    const payout = Number(el(`pay-${reqId}`).value) || 20;
    if (!await avConfirm(`Approve ${username} with code ${code}? Discount ${discount}%, Payout ${payout}%.`)) return;

    const { error: cErr } = await _supabase.from("coupons").insert([{
        code, owner_name: username, owner_user_id: userId, owner_email: email,
        discount_percent: discount, payout_percent: payout,
        upi_id: upiId, is_active: true,
    }]);
    if (cErr) return toast("Error creating coupon: " + cErr.message, "err");

    await _supabase.from("coupon_requests").update({ status: "approved" }).eq("id", reqId);

    toast("Approved " + username + " (" + code + ")", "ok");
    loadCoupons();
}

async function rejectCouponRequest(reqId) {
    const reason = await avPrompt("Reason for rejection:");
    if (reason === null || reason.trim() === "") return;
    await _supabase.from("coupon_requests").update({ status: "rejected", rejection_reason: reason }).eq("id", reqId);
    toast("Request rejected", "ok");
    loadCoupons();
}

async function saveCouponEdits(couponId) {
    const discount = Number(el(`edit-disc-${couponId}`).value);
    const payout = Number(el(`edit-pay-${couponId}`).value);
    const validInput = el(`edit-valid-${couponId}`).value;
    const validUntil = validInput ? istDateInputToUTC(validInput).toISOString() : null;
    const { error } = await _supabase.from("coupons")
        .update({ discount_percent: discount, payout_percent: payout, valid_until: validUntil })
        .eq("id", couponId);
    if (error) return toast("Error: " + error.message, "err");
    toast("Coupon saved", "ok");
    loadCoupons();
}

async function toggleCoupon(couponId, currentlyActive) {
    await _supabase.from("coupons").update({ is_active: !currentlyActive }).eq("id", couponId);
    toast(currentlyActive ? "Coupon deactivated" : "Coupon activated", "ok");
    loadCoupons();
}

// Bulk-updates discount_percent (only) for every coupon in one group.
// scope: "partner" -> all normal partner coupons, "staff" -> all owner/subowner/admin coupons.
// Does not touch payout_percent, valid_until, or revenue.
async function bulkUpdateDiscount(scope) {
    const inputId = scope === "staff" ? "bulkDiscountStaff" : "bulkDiscountPartner";
    const input = el(inputId);
    const discount = Number(input.value);

    if (input.value.trim() === "" || !Number.isFinite(discount) || discount < 0) {
        return toast("Enter a valid discount %", "warn");
    }

    const list = scope === "staff" ? staffCoupons : partnerCoupons;
    if (!list.length) return toast("No coupons in this group yet.", "warn");

    const label = scope === "staff" ? "all Owner / Sub-owner / Admin coupons" : "all Partner coupons";
    const confirmMsg = `Set discount to ${discount}% for ${label} (${list.length} coupon${list.length > 1 ? "s" : ""})?\nThis only changes discount % — payout %, valid-until, and revenue stay as they are.`;
    if (!await avConfirm(confirmMsg)) return;

    const ids = list.map((c) => c.id);
    const { error } = await _supabase.from("coupons").update({ discount_percent: discount }).in("id", ids);
    if (error) return toast("Error: " + error.message, "err");

    toast(`Discount updated for ${ids.length} coupon(s)`, "ok");
    input.value = "";
    loadCoupons();
}

// -----------------------------------------------------------
// Pricing tab (owner only — enforced by RLS + UI)
// -----------------------------------------------------------
async function loadPricing() {
    const { data: plans } = await _supabase.from("pricing").select("*").order("offer_price");
    let html = "";
    (plans || []).forEach((p) => {
        html += `<tr>
      <td><input type="text" class="inline-input" style="width:110px" id="pn-${p.id}" value="${p.plan_name}"></td>
      <td><input type="number" class="inline-input" id="po-${p.id}" value="${p.original_price}"></td>
      <td><input type="number" class="inline-input" id="pf-${p.id}" value="${p.offer_price}"></td>
      <td><input type="number" class="inline-input" id="pv-${p.id}" value="${p.validity_days}"></td>
      <td><input type="checkbox" id="pa-${p.id}" ${p.is_active ? "checked" : ""}></td>
      <td><button class="btn-sm edit" onclick="savePlan('${p.id}')">Save</button></td>
    </tr>`;
    });
    el("pricingTable").innerHTML = html || '<tr><td colspan="6">No plans yet.</td></tr>';
}

async function savePlan(planId) {
    const update = {
        plan_name: el(`pn-${planId}`).value,
        original_price: Number(el(`po-${planId}`).value),
        offer_price: Number(el(`pf-${planId}`).value),
        validity_days: Number(el(`pv-${planId}`).value),
        is_active: el(`pa-${planId}`).checked,
    };
    const { error } = await _supabase.from("pricing").update(update).eq("id", planId);
    if (error) return toast("Error: " + error.message, "err");
    toast("Plan updated", "ok");
    loadPricing();
}

// -----------------------------------------------------------
// Form wiring: add plan, create sale coupon, direct grant
// -----------------------------------------------------------
function wireForms() {
    el("bulkDiscountPartnerBtn").addEventListener("click", () => bulkUpdateDiscount("partner"));
    el("bulkDiscountStaffBtn").addEventListener("click", () => bulkUpdateDiscount("staff"));

    el("addPlanBtn").addEventListener("click", async () => {
        const name = await avPrompt("New plan name:");
        if (!name) return;
        const { error } = await _supabase.from("pricing").insert([{
            plan_name: name, original_price: 0, offer_price: 0, validity_days: 365, is_active: false,
        }]);
        if (error) return toast("Error: " + error.message, "err");
        toast("Plan added", "ok");
        loadPricing();
    });

    el("createSaleCouponBtn").addEventListener("click", async () => {
        const code = el("saleCode").value.trim().toUpperCase();
        const discount = Number(el("saleDiscount").value) || 0;
        const payout = Number(el("salePayout").value) || 0;
        const upi = el("saleUpi").value.trim();
        const validUntil = el("saleValidUntil").value;

        if (!code) return toast("Enter a coupon code", "warn");

        const { error } = await _supabase.from("coupons").insert([{
            code, owner_name: myUsername, owner_user_id: myUserId, owner_email: myEmail,
            discount_percent: discount, payout_percent: payout,
            upi_id: upi || null, is_active: true,
            valid_until: validUntil ? istDateInputToUTC(validUntil).toISOString() : null,
        }]);
        if (error) return toast("Error: " + error.message, "err");
        toast("Sale coupon " + code + " created", "ok");
        el("saleCode").value = "";
        loadCoupons();
    });

    el("grantBtn").addEventListener("click", async () => {
        const email = el("grantEmail").value.trim();
        const days = el("grantDays").value;
        const msgEl = el("grantMsg");
        if (!email || !days) return toast("Enter email and validity days", "warn");

        msgEl.className = "av-inline-msg";
        msgEl.textContent = "Granting...";
        try {
            const res = await fetch(`${WORKER_BASE}/admin-grant-premium`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${myToken}` },
                body: JSON.stringify({ email, validity_days: Number(days) }),
            });
            const data = await res.json();
            if (!res.ok) {
                msgEl.className = "av-inline-msg err";
                msgEl.textContent = data.error || "Failed";
                return;
            }
            msgEl.className = "av-inline-msg ok";
            msgEl.textContent = `Granted to ${data.username} until ${new Date(data.expires_at).toDateString()}`;
            loadStats();
        } catch (err) {
            msgEl.className = "av-inline-msg err";
            msgEl.textContent = "Error: " + err.message;
        }
    });
}

// -----------------------------------------------------------
// Payouts tab
// -----------------------------------------------------------
async function loadPayouts() {
    const { data: pending } = await _supabase.from("payout_requests").select("*").eq("status", "pending");
    let pHtml = "";
    (pending || []).forEach((r) => {
        pHtml += `<tr>
      <td><b>${r.username}</b><br><small>${r.email}</small></td>
      <td><b>₹${r.amount}</b></td>
      <td>${new Date(r.payout_upto).toLocaleString()}</td>
      <td>
        <button class="btn-sm approve" onclick="approvePayoutReq('${r.id}')">Mark Paid</button>
        <button class="btn-sm reject" onclick="rejectPayoutReq('${r.id}')">Reject</button>
      </td>
    </tr>`;
    });
    el("payoutTable").innerHTML = pHtml || '<tr><td colspan="4">No pending payouts.</td></tr>';

    const { data: history } = await _supabase.from("payout_requests").select("*").neq("status", "pending").order("requested_at", { ascending: false }).limit(20);
    let hHtml = "";
    (history || []).forEach((r) => {
        hHtml += `<tr><td>${r.username}</td><td><b>₹${r.amount}</b></td><td><span class="badge ${r.status === "successful" ? "on" : "off"}">${r.status}</span></td><td>${new Date(r.requested_at).toLocaleDateString()}</td></tr>`;
    });
    el("payoutHistoryTable").innerHTML = hHtml || '<tr><td colspan="4">No history.</td></tr>';
}

async function approvePayoutReq(id) {
    if (!await avConfirm("Confirm payout completion?")) return;
    await _supabase.from("payout_requests").update({ status: "successful" }).eq("id", id);
    toast("Payout marked paid", "ok");
    loadPayouts();
}

async function rejectPayoutReq(id) {
    const reason = await avPrompt("Reason for rejection:");
    if (reason === null || reason.trim() === "") return;
    await _supabase.from("payout_requests").update({ status: "rejected", rejection_reason: reason }).eq("id", id);
    toast("Payout rejected", "ok");
    loadPayouts();
}

// -----------------------------------------------------------
// Legacy manual payment requests tab
// -----------------------------------------------------------
async function loadLegacyPayments() {
    const { data: pending } = await _supabase.from("payment_requests").select("*").eq("status", "pending");
    let html = "";
    (pending || []).forEach((r) => {
        html += `<tr>
      <td><b>${r.username}</b><br><small>${r.email}</small></td>
      <td class="av-mono">${r.utr || "-"}</td>
      <td><b>₹${r.amount_paid}</b></td>
      <td>
        <button class="btn-sm approve" onclick="approveLegacy('${r.id}')">Approve</button>
        <button class="btn-sm reject" onclick="rejectLegacy('${r.id}')">Reject</button>
      </td>
    </tr>`;
    });
    el("legacyPaymentTable").innerHTML = html || '<tr><td colspan="4">No pending manual requests.</td></tr>';
}

async function approveLegacy(id) {
    if (!await avConfirm("Approve this manual payment?")) return;
    await _supabase.from("payment_requests").update({ status: "success" }).eq("id", id);
    toast("Manual payment approved", "ok");
    loadLegacyPayments();
    loadStats();
}

async function rejectLegacy(id) {
    const reason = await avPrompt("Reason for rejection:");
    if (reason === null || reason.trim() === "") return;
    await _supabase.from("payment_requests").update({ status: "rejected", rejection_reason: reason }).eq("id", id);
    toast("Manual payment rejected", "ok");
    loadLegacyPayments();
}


async function loadSummaryTable() {
    const { data: shares } = await _supabase.from("clearance_shares").select("user_id, username, amount_due, amount_paid");
    const byUser = {};
    (shares || []).forEach((s) => {
        if (!byUser[s.user_id]) byUser[s.user_id] = { username: s.username, due: 0, paid: 0 };
        byUser[s.user_id].due += Number(s.amount_due);
        byUser[s.user_id].paid += Number(s.amount_paid);
    });

    let html = "";
    Object.values(byUser).forEach((u) => {
        const pending = u.due - u.paid;
        const pendingLabel = pending === 0 ? "—" : (pending < 0 ? "-₹" + Math.abs(pending).toLocaleString("en-IN") : "₹" + pending.toLocaleString("en-IN"));
        html += `<tr>
      <td><b>${u.username}</b></td>
      <td>₹${u.due.toLocaleString("en-IN")}</td>
      <td>₹${u.paid.toLocaleString("en-IN")}</td>
      <td><b>${pendingLabel}</b></td>
    </tr>`;
    });
    el("summaryTable").innerHTML = html || '<tr><td colspan="4">No clearances yet.</td></tr>';
}

// -----------------------------------------------------------
// Downloadable payment receipt (PDF) — every clearance batch,
// its date range, and to-be-paid/paid/due per partner, plus
// the all-time grand totals.
// -----------------------------------------------------------
function loadLogoAsDataURL() {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
            // Downscale to a small fixed size — this is only ever drawn as a
            // faint 110mm watermark, so the source resolution doesn't matter.
            const MAX_DIM = 500;
            const scale = Math.min(1, MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
            const w = Math.round(img.naturalWidth * scale);
            const h = Math.round(img.naturalHeight * scale);
            const canvas = document.createElement("canvas");
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext("2d");
            // JPEG has no alpha channel, so fill white first (matches the
            // white PDF page it sits on) instead of letting transparency
            // render as black.
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, w, h);
            ctx.drawImage(img, 0, 0, w, h);
            try { resolve(canvas.toDataURL("image/jpeg", 0.8)); } catch (e) { reject(e); }
        };
        img.onerror = reject;
        img.src = "/logo.png";
    });
}

function fmtAmt(n) {
    const v = Number(n);
    return (v < 0 ? "-Rs " : "Rs ") + Math.abs(v).toLocaleString("en-IN");
}

// For aggregate "Total" figures only (batch total, all-time grand total).
// Individual partner amounts keep their exact paise via fmtAmt — this
// is only for the summary lines, which should read as clean whole rupees.
function fmtAmtInt(n) {
    const v = Math.round(Number(n));
    return (v < 0 ? "-Rs " : "Rs ") + Math.abs(v).toLocaleString("en-IN");
}

async function downloadPaymentReceipt() {
    const btn = el("downloadReceiptBtn");
    btn.disabled = true;
    const originalLabel = btn.textContent;
    btn.textContent = "Generating...";

    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ unit: "mm", format: "a4" });
        const pageW = doc.internal.pageSize.getWidth();
        const pageH = doc.internal.pageSize.getHeight();
        const marginX = 14;

        let logoData = null;
        try { logoData = await loadLogoAsDataURL(); } catch (e) { /* logo optional */ }

        function drawWatermark() {
            if (!logoData) return;
            doc.saveGraphicsState();
            doc.setGState(new doc.GState({ opacity: 0.06 }));
            const size = 110;
            doc.addImage(logoData, "JPEG", (pageW - size) / 2, (pageH - size) / 2, size, size);
            doc.restoreGraphicsState();
        }

        function drawHeader() {
            drawWatermark();
            doc.setFont("helvetica", "bold");
            doc.setFontSize(20);
            doc.setTextColor(20, 30, 60);
            doc.text("MOCK MATRIX PAYMENTS", pageW / 2, 18, { align: "center" });
            doc.setFont("helvetica", "normal");
            doc.setFontSize(10);
            doc.setTextColor(90, 90, 90);
            doc.text(`Generated: ${new Date().toLocaleString("en-IN")}`, pageW / 2, 24, { align: "center" });
            doc.setTextColor(0, 0, 0);
        }

        let y = 34;
        function ensureSpace(rowHeight) {
            if (y + rowHeight > pageH - 16) {
                doc.addPage();
                drawHeader();
                y = 34;
            }
        }

        drawHeader();

        const { data: batches } = await _supabase.from("revenue_clearances").select("*").order("to_date", { ascending: true });
        const { data: allShares } = await _supabase.from("clearance_shares").select("*").order("username");

        let grandDue = 0, grandPaid = 0;
        const partnerTotals = {}; // username -> { due, paid }

        (batches || []).forEach((batch) => {
            ensureSpace(16);
            doc.setFont("helvetica", "bold");
            doc.setFontSize(12);
            doc.text(`Clearance: ${batch.from_date}  to  ${batch.to_date}`, marginX, y);
            doc.setFont("helvetica", "normal");
            doc.setFontSize(10);
            doc.text(`Batch Total: ${fmtAmtInt(batch.total_amount)}`, pageW - marginX, y, { align: "right" });
            y += 6;

            doc.setFont("helvetica", "bold");
            doc.setFontSize(9);
            doc.text("Partner", marginX, y);
            doc.text("To Be Paid", marginX + 70, y);
            doc.text("Paid", marginX + 110, y);
            doc.text("Due", marginX + 145, y);
            y += 4;
            doc.setDrawColor(210);
            doc.line(marginX, y, pageW - marginX, y);
            y += 5;

            doc.setFont("helvetica", "normal");
            const shares = (allShares || []).filter((s) => s.clearance_id === batch.id);
            let batchAssigned = 0;
            shares.forEach((s) => {
                ensureSpace(7);
                const due = Number(s.amount_due), paid = Number(s.amount_paid);
                doc.text(String(s.username), marginX, y);
                doc.text(fmtAmt(due), marginX + 70, y);
                doc.text(fmtAmt(paid), marginX + 110, y);
                doc.text(fmtAmt(due - paid), marginX + 145, y);
                y += 6;
                grandDue += due;
                grandPaid += paid;
                batchAssigned += due;
                if (!partnerTotals[s.username]) partnerTotals[s.username] = { due: 0, paid: 0 };
                partnerTotals[s.username].due += due;
                partnerTotals[s.username].paid += paid;
            });

            const batchLeftover = Math.round(Number(batch.total_amount) - batchAssigned);
            if (batchLeftover > 0) {
                ensureSpace(6);
                doc.setFont("helvetica", "italic");
                doc.setFontSize(8.5);
                doc.setTextColor(140, 100, 20);
                doc.text(`₹${batchLeftover} not evenly splittable — carried into next clearance`, marginX, y);
                doc.setTextColor(0, 0, 0);
                y += 6;
            }
            y += 5;
        });

        if (!batches || batches.length === 0) {
            doc.setFont("helvetica", "normal");
            doc.setFontSize(11);
            doc.text("No clearance batches yet.", marginX, y);
            y += 8;
        }

        ensureSpace(30);
        doc.setDrawColor(20, 30, 60);
        doc.setLineWidth(0.5);
        doc.line(marginX, y, pageW - marginX, y);
        y += 8;
        doc.setFont("helvetica", "bold");
        doc.setFontSize(12);
        doc.text("All-Time Partner Summary", marginX, y);
        y += 7;

        doc.setFontSize(9);
        doc.text("Partner", marginX, y);
        doc.text("Total Due", marginX + 70, y);
        doc.text("Total Paid", marginX + 110, y);
        doc.text("Total Pending", marginX + 145, y);
        y += 4;
        doc.setDrawColor(210);
        doc.line(marginX, y, pageW - marginX, y);
        y += 5;

        doc.setFont("helvetica", "normal");
        Object.keys(partnerTotals).forEach((username) => {
            ensureSpace(7);
            const t = partnerTotals[username];
            const pending = t.due - t.paid;
            doc.text(username, marginX, y);
            doc.text(fmtAmt(t.due), marginX + 70, y);
            doc.text(fmtAmt(t.paid), marginX + 110, y);
            doc.text(pending === 0 ? "-" : fmtAmt(pending), marginX + 145, y);
            y += 6;
        });
        y += 5;

        ensureSpace(30);
        doc.setDrawColor(20, 30, 60);
        doc.setLineWidth(0.5);
        doc.line(marginX, y, pageW - marginX, y);
        y += 8;
        doc.setFont("helvetica", "bold");
        doc.setFontSize(12);
        doc.text("All-Time Totals", marginX, y);
        y += 7;
        doc.setFontSize(11);
        doc.text(`Total To Be Paid: ${fmtAmtInt(grandDue)}`, marginX, y); y += 6;
        doc.text(`Total Paid: ${fmtAmtInt(grandPaid)}`, marginX, y); y += 6;
        doc.text(`Total Due: ${fmtAmtInt(grandDue - grandPaid)}`, marginX, y);

        if (window.mmhSaveOrShare) {
            window.mmhSaveOrShare(`MockMatrix-Payment-Receipt-${new Date().toISOString().slice(0, 10)}.pdf`, doc.output('blob'), 'application/pdf');
        } else {
            doc.save(`MockMatrix-Payment-Receipt-${new Date().toISOString().slice(0, 10)}.pdf`);
        }
        toast("Receipt PDF downloaded", "ok");
    } catch (err) {
        toast("Could not generate receipt: " + err.message, "err");
    } finally {
        btn.disabled = false;
        btn.textContent = originalLabel;
    }
}

// -----------------------------------------------------------
// Payment Clearance tab
// -----------------------------------------------------------
let staffList = [];          // [{id, username}] for owner/subowner/admin
let lastClearedToDate = null; // "YYYY-MM-DD" or null if never cleared
let previewFromKey = null;
let previewToKey = null;

async function initClearanceTab() {
    await loadStaffList();
    await loadSplitEditor();
    await refreshClearanceFromDate();
    await updateNotClearedStat();
    await loadClearanceHistory();
    await loadSummaryTable();

    el("saveSplitBtn").addEventListener("click", saveSplit);
    el("previewClearanceBtn").addEventListener("click", previewClearance);
    el("confirmClearanceBtn").addEventListener("click", openClearanceModal);
    el("modalCancelBtn").addEventListener("click", closeClearanceModal);
    el("modalConfirmBtn").addEventListener("click", confirmClearance);
    el("downloadReceiptBtn").addEventListener("click", downloadPaymentReceipt);
}

async function loadStaffList() {
    const { data } = await _supabase.from("profiles").select("id, username").in("role", ["owner", "subowner", "admin"]);
    staffList = data || [];
}

async function loadSplitEditor() {
    const { data: splits } = await _supabase.from("staff_revenue_split").select("*");
    const container = el("splitEditor");
    let html = "";
    staffList.forEach((s) => {
        const existing = (splits || []).find((sp) => sp.user_id === s.id);
        const pct = existing ? existing.percentage : (100 / staffList.length).toFixed(2);
        html += `<div class="split-row"><span>${s.username}</span><input type="number" step="0.01" class="inline-input split-input" id="split-${s.id}" value="${pct}"></div>`;
    });
    container.innerHTML = html;
}

async function saveSplit() {
    const rows = staffList.map((s) => ({
        user_id: s.id,
        percentage: Number(el(`split-${s.id}`).value) || 0,
        updated_at: new Date().toISOString(),
    }));
    const { error } = await _supabase.from("staff_revenue_split").upsert(rows, { onConflict: "user_id" });
    if (error) return toast("Error: " + error.message, "err");
    toast("Split saved", "ok");
}

async function getLastClearedToDate() {
    const { data } = await _supabase.from("revenue_clearances").select("to_date").order("to_date", { ascending: false }).limit(1);
    return data && data[0] ? data[0].to_date : null;
}

async function refreshClearanceFromDate() {
    lastClearedToDate = await getLastClearedToDate();
    const label = el("clearanceFromLabel");
    if (lastClearedToDate) {
        const next = new Date(lastClearedToDate + "T00:00:00Z");
        next.setUTCDate(next.getUTCDate() + 1);
        label.textContent = "From: " + next.toISOString().slice(0, 10) + "  (cleared up to " + lastClearedToDate + ")";
    } else {
        label.textContent = "From: the very beginning (no clearance done yet)";
    }
}

async function updateNotClearedStat() {
    const fromKey = lastClearedToDate;
    const data = await fetchAllRows(() => {
        let q = _supabase.from("payments").select("amount_paid");
        if (fromKey) {
            const fromUTC = istDateInputToUTC(fromKey);
            const fromEnd = new Date(fromUTC.getTime() + 86400000); // end of that IST day
            q = q.gte("created_at", fromEnd.toISOString());
        }
        return q;
    });
    const total = data.reduce((s, p) => s + Number(p.amount_paid), 0);
    avCountUp(el("statNotCleared"), total, "₹");
    el("clearedUpToLabel").textContent = "Cleared up to: " + (lastClearedToDate || "Never");
}

async function previewClearance() {
    const toInput = el("clearanceToDate").value;
    if (!toInput) return toast("Pick a 'to' date", "warn");

    const fromUTC = lastClearedToDate
        ? new Date(istDateInputToUTC(lastClearedToDate).getTime() + 86400000)
        : new Date("2000-01-01T00:00:00Z");
    const toStart = istDateInputToUTC(toInput);
    const toUTC = new Date(toStart.getTime() + 86400000 - 1);

    if (toUTC < fromUTC) return toast("'To' date must be after the last cleared date.", "warn");

    const data = await fetchAllRows(() =>
        _supabase.from("payments").select("amount_paid")
            .gte("created_at", fromUTC.toISOString()).lte("created_at", toUTC.toISOString())
    );

    const total = data.reduce((s, p) => s + Number(p.amount_paid), 0);

    previewFromKey = lastClearedToDate
        ? new Date(fromUTC.getTime()).toISOString().slice(0, 10)
        : "2000-01-01";
    previewToKey = toInput;

    el("previewAmount").textContent = "₹" + total.toLocaleString("en-IN");
    el("previewCount").textContent = data.length;
    el("clearancePreview").dataset.total = total;
    el("clearancePreview").style.display = "block";
}

async function getPriorLeftover() {
    // Whole-rupee splits can leave 1-2 rupees unassigned in a batch (e.g. a
    // total that isn't evenly divisible 3 ways). Rather than padding one
    // partner's share, that remainder is carried into the next batch's total
    // and re-split from there. This looks at the most recent batch and
    // returns (its total) minus (sum of what was actually assigned to
    // partners in it).
    const { data: lastBatchArr } = await _supabase.from("revenue_clearances").select("*").order("to_date", { ascending: false }).limit(1);
    const lastBatch = lastBatchArr && lastBatchArr[0];
    if (!lastBatch) return 0;
    const { data: shares } = await _supabase.from("clearance_shares").select("amount_due").eq("clearance_id", lastBatch.id);
    const assigned = (shares || []).reduce((s, r) => s + Number(r.amount_due), 0);
    const leftover = Math.round(Number(lastBatch.total_amount) - assigned);
    return leftover > 0 ? leftover : 0;
}

async function openClearanceModal() {
    const previewTotal = Number(el("clearancePreview").dataset.total || 0);
    const priorLeftover = await getPriorLeftover();
    const total = previewTotal + priorLeftover;
    // Save the carried-forward total back so confirmClearance stores this
    // same number as the batch's total_amount — the batch total should
    // include whatever rolled in from the last one.
    el("clearancePreview").dataset.total = total;

    const { data: splits } = await _supabase.from("staff_revenue_split").select("*");

    el("modalRangeLabel").textContent =
        `${previewFromKey} → ${previewToKey}  ·  Total ₹${total.toLocaleString("en-IN")}` +
        (priorLeftover > 0 ? ` (incl. ₹${priorLeftover} carried forward)` : "");

    let html = "";
    const pctList = staffList.map((s) => {
        const split = (splits || []).find((sp) => sp.user_id === s.id);
        return split ? Number(split.percentage) : (100 / staffList.length);
    });
    // Normalize against the sum of everyone's stored % rather than a fixed
    // 100 — three partners saved at 33.33% each only add to 99.99%, but
    // 33.33/99.99 is exactly 1/3, so this splits the total evenly.
    const sumPct = pctList.reduce((a, b) => a + b, 0) || 100;

    let assignedTotal = 0;
    staffList.forEach((s, idx) => {
        const pct = pctList[idx];
        // Whole rupees only, always rounded down — nobody gets a decimal
        // padded on to make the split "come out even". If the total divides
        // evenly (e.g. divisible by 3 for an equal three-way split) everyone
        // already gets a clean integer; any 1-2 rupees left over stay
        // unassigned this batch and carry into the next one via
        // getPriorLeftover() above.
        const due = Math.floor(total * pct / sumPct);
        assignedTotal += due;
        html += `<div class="modal-share-row" data-user="${s.id}" data-username="${s.username}" data-pct="${pct}" data-due="${due}">
      <div class="msr-name">${s.username}</div>
      <div class="msr-due">To be paid (locked, ${pct}%): ₹${due.toLocaleString("en-IN")}</div>
      <label><input type="checkbox" class="msr-cleared" checked onchange="toggleClearedRow(this)"> Fully cleared now</label>
      <input type="number" class="msr-paid-input" value="${due}" disabled>
    </div>`;
    });

    const unassigned = total - assignedTotal;
    el("modalShareRows").innerHTML = html +
        (unassigned > 0 ? `<p class="hint">₹${unassigned} isn't evenly splittable this batch — carries into the next clearance.</p>` : "");

    el("clearanceModal").classList.add("active");
}

function toggleClearedRow(checkbox) {
    const row = checkbox.closest(".modal-share-row");
    const input = row.querySelector(".msr-paid-input");
    const due = Number(row.dataset.due);
    if (checkbox.checked) {
        input.value = due;
        input.disabled = true;
    } else {
        input.disabled = false;
        input.focus();
    }
}
window.toggleClearedRow = toggleClearedRow;

function closeClearanceModal() {
    el("clearanceModal").classList.remove("active");
}

async function confirmClearance() {
    const total = Number(el("clearancePreview").dataset.total || 0);

    const rows = Array.from(document.querySelectorAll(".modal-share-row")).map((row) => {
        const due = Number(row.dataset.due);
        let paid = Number(row.querySelector(".msr-paid-input").value) || 0;
        return {
            user_id: row.dataset.user,
            username: row.dataset.username,
            percentage_at_time: Number(row.dataset.pct),
            amount_due: due,
            amount_paid: paid,
            status: paid >= due ? "done" : "pending",
        };
    });

    if (!await avConfirm(`Create this clearance batch for ₹${total.toLocaleString("en-IN")}?`)) return;

    const { data: batch, error: batchErr } = await _supabase.from("revenue_clearances").insert([{
        from_date: previewFromKey, to_date: previewToKey, total_amount: total, created_by: myUserId,
    }]).select().single();

    if (batchErr) return toast("Error: " + batchErr.message, "err");

    const shareRows = rows.map((r) => ({ ...r, clearance_id: batch.id }));
    const { error: shareErr } = await _supabase.from("clearance_shares").insert(shareRows);
    if (shareErr) return toast("Error creating shares: " + shareErr.message, "err");

    toast("Clearance batch created", "ok");
    closeClearanceModal();
    el("clearancePreview").style.display = "none";
    el("clearanceToDate").value = "";
    await refreshClearanceFromDate();
    await updateNotClearedStat();
    await loadClearanceHistory();
    await loadSummaryTable();
}

async function loadClearanceHistory() {
    const { data: batches } = await _supabase.from("revenue_clearances").select("*").order("to_date", { ascending: false });
    const container = el("clearanceHistory");

    if (!batches || batches.length === 0) {
        container.innerHTML = '<p class="hint">No clearances yet.</p>';
        return;
    }

    let html = "";
    for (const batch of batches) {
        const { data: shares } = await _supabase.from("clearance_shares").select("*").eq("clearance_id", batch.id).order("username");
        const batchAssigned = (shares || []).reduce((s, r) => r.amount_due ? s + Number(r.amount_due) : s, 0);
        const batchLeftover = Math.round(Number(batch.total_amount) - batchAssigned);
        html += `<div class="clearance-batch">
      <div class="clearance-batch-head">
        <b>${batch.from_date} → ${batch.to_date}</b>
        <span>Total: ₹${Number(batch.total_amount).toLocaleString("en-IN")}</span>
      </div>${batchLeftover > 0 ? `<p class="hint" style="color:var(--amber-strong, #d97706);">₹${batchLeftover} not evenly splittable — carried into next clearance</p>` : ""}`;
        (shares || []).forEach((sh) => {
            const remaining = Math.max(0, Number(sh.amount_due) - Number(sh.amount_paid));
            html += `<div class="share-row">
        <span class="share-name">${sh.username}</span>
        <span class="share-amounts">
          Due ₹<input type="number" class="pay-input" id="due-${sh.id}" value="${sh.amount_due}">
          · Paid ₹${Number(sh.amount_paid).toLocaleString("en-IN")}${remaining > 0 ? " · Pending ₹" + remaining.toLocaleString("en-IN") : ""}
        </span>
        <span class="badge ${sh.status === "done" ? "on" : "off"}">${sh.status}</span>
        <div class="share-actions">
          <button class="btn-sm edit" onclick="saveDueEdit('${sh.id}')">Save Due</button>
          <input type="number" class="pay-input" id="addpay-${sh.id}" placeholder="Add ₹">
          <button class="btn-sm edit" onclick="addSharePayment('${sh.id}')">Add</button>
          <button class="btn-sm approve" onclick="markShareDone('${sh.id}')">Mark Done</button>
        </div>
      </div>`;
        });
        html += `</div>`;
    }
    container.innerHTML = html;
}

async function saveDueEdit(shareId) {
    const newDue = Number(el(`due-${shareId}`).value);
    if (isNaN(newDue) || newDue < 0) return toast("Enter a valid amount", "warn");
    if (!await avConfirm(`Change amount due to ₹${newDue}? This is a manual correction.`)) return;

    const { data: share } = await _supabase.from("clearance_shares").select("*").eq("id", shareId).single();
    const newStatus = Number(share.amount_paid) >= newDue ? "done" : "pending";

    const { error } = await _supabase.from("clearance_shares").update({
        amount_due: newDue, status: newStatus, updated_at: new Date().toISOString(),
    }).eq("id", shareId);

    if (error) return toast("Error: " + error.message, "err");
    toast("Due amount updated", "ok");
    loadClearanceHistory();
    loadSummaryTable();
}

async function addSharePayment(shareId) {
    const input = el(`addpay-${shareId}`);
    const addAmount = Number(input.value);
    if (!addAmount || addAmount <= 0) return toast("Enter a valid amount", "warn");

    const { data: share } = await _supabase.from("clearance_shares").select("*").eq("id", shareId).single();
    if (!share) return;

    const newPaid = Number(share.amount_paid) + addAmount;
    const newStatus = newPaid >= Number(share.amount_due) ? "done" : "pending";

    const { error } = await _supabase.from("clearance_shares").update({
        amount_paid: newPaid, status: newStatus, updated_at: new Date().toISOString(),
    }).eq("id", shareId);

    if (error) return toast("Error: " + error.message, "err");
    toast("Payment added", "ok");
    loadClearanceHistory();
    loadSummaryTable();
}

async function markShareDone(shareId) {
    const { data: share } = await _supabase.from("clearance_shares").select("*").eq("id", shareId).single();
    if (!share) return;
    if (!await avConfirm(`Mark ₹${share.amount_due} as fully paid to ${share.username}?`)) return;

    const { error } = await _supabase.from("clearance_shares").update({
        amount_paid: share.amount_due, status: "done", updated_at: new Date().toISOString(),
    }).eq("id", shareId);

    if (error) return toast("Error: " + error.message, "err");
    toast("Share marked done", "ok");
    loadClearanceHistory();
    loadSummaryTable();
}



// -----------------------------------------------------------
// User Info tab — find any user's full profile row by email,
// username, or mobile, and edit it directly.
// -----------------------------------------------------------
const USER_INFO_READONLY = ["id", "created_at", "updated_at"];
let currentUserInfoRow = null;

function initUserInfoTab() {
    el("userSearchBtn").addEventListener("click", searchUserInfo);
    el("userSearchInput").addEventListener("keydown", (e) => {
        if (e.key === "Enter") searchUserInfo();
    });
    el("saveUserBtn").addEventListener("click", saveUserInfoEdits);
}

async function searchUserInfo() {
    const q = el("userSearchInput").value.trim();
    const resultCard = el("userResultCard");
    if (!q) return toast("Enter an email, username, or mobile number", "warn");

    const { data, error } = await _supabase
        .from("profiles")
        .select("*")
        .or(`email.eq.${q},username.eq.${q},mobile.eq.${q}`)
        .maybeSingle();

    if (error) return toast("Error: " + error.message, "err");
    if (!data) {
        resultCard.style.display = "none";
        return toast("No user found with that email, username, or mobile.", "warn");
    }

    renderUserInfoRow(data);
    resultCard.style.display = "block";
}

function renderUserInfoRow(row) {
    currentUserInfoRow = row;
    let html = "";
    Object.keys(row).forEach((key) => {
        const val = row[key];
        const displayVal = val === null || val === undefined ? "" : val;
        if (USER_INFO_READONLY.includes(key)) {
            html += `<tr><td><b>${key}</b></td><td class="av-mono">${displayVal}</td></tr>`;
        } else if (typeof val === "boolean") {
            html += `<tr><td><b>${key}</b></td><td><input type="checkbox" id="uf-${key}" ${val ? "checked" : ""}></td></tr>`;
        } else {
            html += `<tr><td><b>${key}</b></td><td><input type="text" class="inline-input" style="width:100%; max-width:340px;" id="uf-${key}" value="${displayVal}"></td></tr>`;
        }
    });
    el("userInfoTable").innerHTML = html;
    el("userSaveMsg").textContent = "";
    el("userSaveMsg").className = "av-inline-msg";
}

async function saveUserInfoEdits() {
    if (!currentUserInfoRow) return;
    const update = {};
    Object.keys(currentUserInfoRow).forEach((key) => {
        if (USER_INFO_READONLY.includes(key)) return;
        const elm = el(`uf-${key}`);
        if (!elm) return;
        if (elm.type === "checkbox") {
            update[key] = elm.checked;
        } else {
            const raw = elm.value;
            update[key] = typeof currentUserInfoRow[key] === "number"
                ? (raw === "" ? null : Number(raw))
                : (raw === "" ? null : raw);
        }
    });

    if (!await avConfirm("Save changes to this user's profile?")) return;

    const msgEl = el("userSaveMsg");
    msgEl.className = "av-inline-msg";
    msgEl.textContent = "Saving...";

    const { error } = await _supabase.from("profiles").update(update).eq("id", currentUserInfoRow.id);
    if (error) {
        msgEl.className = "av-inline-msg err";
        msgEl.textContent = "Error: " + error.message;
        return;
    }
    msgEl.className = "av-inline-msg ok";
    msgEl.textContent = "Saved.";
    toast("User profile saved", "ok");
}

// -----------------------------------------------------------
// Cancel Premium tab (owner only)
// Resolves email/username/mobile -> uuid the same way the User Info
// tab does (direct Supabase lookup), then hands the uuid to the
// worker, which deletes the D1 paid_users row and clears
// is_paid/expires_at on the profile.
// -----------------------------------------------------------
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function initCancelPremiumTab() {
    el("cancelPremiumBtn").addEventListener("click", cancelPremiumFlow);
    el("cancelSearchInput").addEventListener("keydown", (e) => {
        if (e.key === "Enter") cancelPremiumFlow();
    });
}

async function cancelPremiumFlow() {
    const q = el("cancelSearchInput").value.trim();
    const msgEl = el("cancelMsg");
    msgEl.className = "av-inline-msg";
    if (!q) return toast("Enter an email, username, mobile, or UUID", "warn");

    let uuid = null;
    let username = null;

    if (UUID_RE.test(q)) {
        uuid = q;
    } else {
        msgEl.textContent = "Looking up user...";
        const { data, error } = await _supabase
            .from("profiles")
            .select("id, username")
            .or(`email.eq.${q},username.eq.${q},mobile.eq.${q}`)
            .maybeSingle();
        if (error) {
            msgEl.className = "av-inline-msg err";
            msgEl.textContent = "Error: " + error.message;
            return;
        }
        if (!data) {
            msgEl.className = "av-inline-msg err";
            msgEl.textContent = "No user found with that email, username, or mobile.";
            return;
        }
        uuid = data.id;
        username = data.username;
    }

    if (!await avConfirm(`Cancel premium for ${username || uuid}? This deletes their D1 access row and clears is_paid/expires_at.`)) {
        msgEl.textContent = "";
        return;
    }

    msgEl.textContent = "Cancelling...";
    try {
        const res = await fetch(`${WORKER_BASE}/admin-cancel-premium`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${myToken}` },
            body: JSON.stringify({ uuid }),
        });
        const data = await res.json();
        if (!res.ok) {
            msgEl.className = "av-inline-msg err";
            msgEl.textContent = data.error || "Failed";
            return;
        }
        msgEl.className = "av-inline-msg ok";
        msgEl.textContent = `Premium cancelled for ${data.username || uuid}.`;
        el("cancelSearchInput").value = "";
        loadStats();
    } catch (err) {
        msgEl.className = "av-inline-msg err";
        msgEl.textContent = "Error: " + err.message;
    }
}
