// ── premium-engine.js — rendering + glue for buy-premium.html ───────────────
// Screen 1 (plan select) and the page chrome render from /premium-plans.json.
// Screen 2 (checkout) is driven by the EXISTING /checkout.js — this file never
// re-implements payment logic; it only:
//   · fetches the same Supabase 'pricing' rows to show live prices on the
//     plan cards (price/validity are NOT in the JSON — planIds map to
//     pricing.plan_name),
//   · switches screens and calls checkout.js's selectPlan(plan_name),
//   · wraps selectPlan/applyCoupon to add the per-month + you-save maths,
//   · renders features / compare / stats / FAQs / bot / SEO-LD from JSON.
// NOTE: checkout.js owns these globals — do NOT redeclare them here:
//   WORKER_BASE, plans, selectedPlan, appliedCoupon, loadPlans, selectPlan,
//   applyCoupon, startCheckout, pollForAccess, recoverPendingPayment…

const PR_DATA_URL = '/premium-plans.json';

// ── Live-first config loader (online → mockmatrixhub.in, offline → APK) ─────
// Config JSONs are fetched from https://mockmatrixhub.in/<path> when online
// (so content can be updated without shipping a new APK), and fall back to
// the copy bundled inside the APK when offline. Guarded so it stays a single
// shared definition even if two engines load on the same page.
window.MMH_LIVE_BASE = window.MMH_LIVE_BASE || 'https://mockmatrixhub.in';
if (typeof window.fetchLiveFirst !== 'function') {
    window.fetchLiveFirst = async function (localUrl, fetchOpts) {
        let rel = String(localUrl);
        while (rel.charAt(0) === '/') rel = rel.slice(1);
        const liveUrl = window.MMH_LIVE_BASE + '/' + rel;
        try {
            const res = await fetch(liveUrl, fetchOpts);
            if (res && res.ok) return res;
        } catch (e) { /* offline / blocked — fall back to the bundled copy */ }
        const res = await fetch(localUrl, fetchOpts);
        if (!res.ok) throw new Error('Failed to load ' + localUrl);
        return res;
    };
}

let PR_DATA = null;         // premium-plans.json
let PR_PRICING = [];        // supabase pricing rows
let prSelPlanId = null;     // selected plan card id
const prSelTerm = {};       // planId → selected term index

// ── icons ────────────────────────────────────────────────────────────────────
const _PRS = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';
const PIC = {
    lock:     `<svg ${_PRS}><rect x="4.6" y="10.2" width="14.8" height="10.4" rx="2.6"/><path d="M8.2 10.2V7.6a3.8 3.8 0 0 1 7.6 0v2.6M12 14.4v2.4"/></svg>`,
    shield:   `<svg ${_PRS}><path d="M12 2.9 19.4 5.7v5.5c0 4.7-3.1 8.3-7.4 9.9-4.3-1.6-7.4-5.2-7.4-9.9V5.7L12 2.9z"/><path d="m8.9 11.9 2.2 2.2 4-4.3"/></svg>`,
    bolt:     `<svg ${_PRS}><path d="M13 2 4.8 13.5h5L9.5 22l8.7-11.5h-5L13 2z"/></svg>`,
    refund:   `<svg ${_PRS}><path d="M3.6 8.4A9 9 0 1 1 3 12"/><path d="M3 4.2v4.2h4.2M12 8.6v4l2.8 1.6"/></svg>`,
    users:    `<svg ${_PRS}><circle cx="9.2" cy="8" r="3.3"/><path d="M3.4 19.6c.7-3.4 2.9-5.2 5.8-5.2s5.1 1.8 5.8 5.2M15.8 5.1a3.3 3.3 0 0 1 0 5.8M17.6 14.9c2.1.6 3.4 2.3 3.9 4.7"/></svg>`,
    notebook: `<svg ${_PRS}><rect x="4.8" y="3.2" width="14.4" height="17.6" rx="2.4"/><path d="M9.2 3.2v17.6M12.6 8.2h3.4M12.6 12h3.4M12.6 15.8h3.4"/></svg>`,
    doc:      `<svg ${_PRS}><path d="M6 2.8h7.6L19 8.2v13H6a1 1 0 0 1-1-1V3.8a1 1 0 0 1 1-1z"/><path d="M13.4 2.8v5.6H19M8.6 12.8h7M8.6 16.4h7"/></svg>`,
    headset:  `<svg ${_PRS}><path d="M4.4 13.2a7.6 7.6 0 0 1 15.2 0"/><rect x="3" y="13" width="4" height="6" rx="1.6"/><rect x="17" y="13" width="4" height="6" rx="1.6"/><path d="M19 19v.6a2.4 2.4 0 0 1-2.4 2.4H13"/></svg>`,
    layers:   `<svg ${_PRS}><path d="M12 3 3 7.6l9 4.6 9-4.6L12 3zM3 12.2l9 4.6 9-4.6M3 16.6l9 4.6 9-4.6"/></svg>`,
    timer:    `<svg ${_PRS}><circle cx="12" cy="13.4" r="7.6"/><path d="M12 9.8v3.6l2.4 1.4M9.4 2.8h5.2M12 2.8v3"/></svg>`,
    infinity: `<svg ${_PRS}><path d="M8.4 8.8c-2 0-3.6 1.5-3.6 3.2s1.6 3.2 3.6 3.2c3 0 4.2-6.4 7.2-6.4 2 0 3.6 1.5 3.6 3.2s-1.6 3.2-3.6 3.2c-3 0-4.2-6.4-7.2-6.4z"/></svg>`,
    trophy:   `<svg ${_PRS}><path d="M7 4.4h10v5.2a5 5 0 0 1-10 0V4.4z"/><path d="M7 5.6H4.4a2.6 2.6 0 0 0 2.7 3M17 5.6h2.6a2.6 2.6 0 0 1-2.7 3M12 14.6v3M8.6 20.4h6.8M10 17.6h4"/></svg>`,
    star:     `<svg ${_PRS}><path d="m12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8L3.6 9.7l5.8-.8L12 3.6z"/></svg>`,
    chart:    `<svg ${_PRS}><path d="M4 20h16M6.6 16.6v-5M11 16.6V7.4M15.4 16.6v-7.2M19.8 16.6V4.6"/></svg>`,
    crown:    `<svg ${_PRS}><path d="M3.5 8.5 8 12l4-6 4 6 4.5-3.5-1.6 10H5.1L3.5 8.5zM5 21h14"/></svg>`,
    check:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12.5 9.5 17.5 19.5 6.5"/></svg>`,
    chev:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>`,
    arrow:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`,
    x:        `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>`,
    bot:      `<svg ${_PRS}><rect x="4.4" y="8.4" width="15.2" height="11" rx="3.4"/><path d="M12 8.4V5.2M12 5.2a1.4 1.4 0 1 0-.1 0zM8.8 13v1.6M15.2 13v1.6M2.8 12.4v3.2M21.2 12.4v3.2"/></svg>`,
    spark:    `<svg ${_PRS}><path d="M12 3.4 13.8 9l5.6 1.8-5.6 1.8L12 18.2l-1.8-5.6L4.6 10.8 10.2 9 12 3.4z"/></svg>`,
    telegram: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>`,
    whatsapp: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>`
};
const ico = k => PIC[k] || PIC.star;

// ── helpers ──────────────────────────────────────────────────────────────────
function _prEsc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
const prCur = () => (PR_DATA && PR_DATA.meta && PR_DATA.meta.currency) || '₹';
const prPlanById = id => (PR_DATA.plans || []).find(p => p.id === id) || null;

// terms come from Supabase pricing rows matched by planIds — NOT from JSON
function prTerms(plan) {
    return (plan.planIds || [])
        .map(name => PR_PRICING.find(r => r.plan_name === name))
        .filter(Boolean)
        .map(row => {
            const days = Number(row.validity_days) || 0;
            const months = Math.max(1, Math.round(days / 30.44));
            return {
                backendName: row.plan_name,
                price: Number(row.offer_price) || 0,
                original: Number(row.original_price) || 0,
                validityDays: days,
                months,
                label: months >= 12 ? (months === 12 ? '1 Year' : (months / 12) + ' Years') : months + (months === 1 ? ' Month' : ' Months')
            };
        });
}
function prTermOf(plan) {
    const terms = prTerms(plan);
    return terms[prSelTerm[plan.id] || 0] || null;
}
// Default term = the longest validity (the 365-day plan). Kept in sync with
// checkout.js so BOTH pages open with 1 Year pre-selected.
function prDefaultTermIndex(plan) {
    const terms = prTerms(plan);
    let best = 0, bestDays = -1;
    terms.forEach((t, i) => {
        if ((t.validityDays || 0) > bestDays) { bestDays = t.validityDays; best = i; }
    });
    return best;
}
const prPerMonth = t => Math.max(1, Math.round(t.price / (t.months || 1)));
const prSave = t => Math.max(0, (t.original || t.price) - t.price);
const prSavePct = t => t.original ? Math.round(prSave(t) / t.original * 100) : 0;

function prAnimateNum(el, to, prefix, suffix, dur) {
    if (!el) return;
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) {
        el.textContent = prefix + to + (suffix || ''); return;
    }
    const t0 = performance.now();
    function step(ts) {
        const p = Math.min(1, (ts - t0) / (dur || 700));
        const e = 1 - Math.pow(1 - p, 3);
        el.textContent = prefix + Math.round(to * e) + (suffix || '');
        if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
}

let _prRvIO = null;
function prReveal(root) {
    const els = (root || document).querySelectorAll('.rv:not(.in)');
    if (!els.length) return;
    if (!('IntersectionObserver' in window)) { els.forEach(e => e.classList.add('in')); return; }
    if (!_prRvIO) {
        _prRvIO = new IntersectionObserver(en => en.forEach(x => {
            if (x.isIntersecting) { x.target.classList.add('in'); _prRvIO.unobserve(x.target); }
        }), { threshold: 0.12 });
    }
    els.forEach(e => _prRvIO.observe(e));
}

// ── data ─────────────────────────────────────────────────────────────────────
async function prLoadData() {
    if (window.__PREMIUM_DATA__) PR_DATA = window.__PREMIUM_DATA__;
    else {
        for (let i = 0; i < 3; i++) {
            try {
                const res = await fetchLiveFirst(PR_DATA_URL + '?v=' + Date.now(), { cache: 'no-store' });
                if (!res.ok) throw new Error('HTTP ' + res.status);
                PR_DATA = await res.json(); break;
            } catch (e) { if (i === 2) throw e; await new Promise(r => setTimeout(r, 600 * (i + 1))); }
        }
    }
    // live prices: preview pin → supabase (same query checkout.js uses)
    if (window.__PRICING_ROWS__) PR_PRICING = window.__PRICING_ROWS__;
    else if (typeof _supabase !== 'undefined' && _supabase) {
        try {
            const { data, error } = await _supabase
                .from('pricing')
                .select('plan_name, original_price, offer_price, validity_days')
                .eq('is_active', true);
            if (!error && data) PR_PRICING = data;
        } catch (e) { /* cards render without prices */ }
    }
}

// ── screen switching (same .screen pattern as the mock pages) ───────────────
function prShowScreen(name, fromLeft) {
    const plans = document.getElementById('screenPlans');
    const ck = document.getElementById('screenCheckout');
    if (!plans || !ck) return;
    plans.classList.toggle('active', name === 'plans');
    ck.classList.toggle('active', name === 'checkout');
    plans.classList.toggle('from-left', name === 'plans' && !!fromLeft);
    document.body.classList.toggle('checkout-mode', name === 'checkout');
    const scroller = document.querySelector('.screen.active .screen-scroll');
    if (scroller) scroller.scrollTop = 0;
    prUpdateSticky();
    prReveal(document);
    prFitAppbar();
}
window.prShowScreen = prShowScreen;

// ── Screen 1: plans ─────────────────────────────────────────────────────────
function prRenderHero() {
    const el = document.getElementById('prHero');
    if (!el || !PR_DATA) return;
    const m = PR_DATA.meta || {};
    el.innerHTML = `
        <span class="pr-eyebrow rv">${ico('spark')} ${_prEsc(m.eyebrow || 'PREMIUM')}</span>
        <h1 class="pr-title rv">${_prEsc(m.title || '')}</h1>
        <p class="pr-sub rv">${_prEsc(m.subtitle || '')}</p>
        <div class="pr-trustchips rv">
            ${((PR_DATA.trust && PR_DATA.trust.badges) || []).map(b =>
                `<span class="pr-tchip">${ico(b.icon)} ${_prEsc(b.label)}</span>`).join('')}
        </div>`;
}

// Re-render everything tied to the current selection, then reveal the fresh
// `.rv` nodes — without prReveal() the re-rendered cards stay at opacity:0
// (the .rv scroll-reveal class) and the card area looks blank/white.
function prRefreshSel() {
    prRenderPlans(); prRenderFeatures(); prRenderAside(); prUpdateSticky();
    prReveal(document);
}

function prRenderPlans() {
    const wrap = document.getElementById('prPlans');
    if (!wrap || !PR_DATA) return;
    const plans = PR_DATA.plans || [];
    wrap.className = 'pr-plans' + (plans.length > 1 ? ' multi' : '');
    wrap.innerHTML = plans.map(p => {
        const terms = prTerms(p);
        const t = terms[prSelTerm[p.id] || 0] || null;
        const sel = p.id === prSelPlanId;
        return `
        <div class="pr-plan rv${sel ? ' selected' : ''}${p.badge ? ' has-badge' : ''}" data-plan="${_prEsc(p.id)}" role="button" tabindex="0" aria-pressed="${sel}">
            ${p.badge ? `<span class="pr-badge${p.highlight ? '' : ' gold'}">${_prEsc(p.badge)}</span>` : ''}
            <span class="pr-sel-dot">${ico('check')}</span>
            <div class="pr-plan-name">${_prEsc(p.name)}</div>
            <div class="pr-plan-tag">${_prEsc(p.tagline || '')}</div>
            ${t ? `
            ${terms.length > 1 ? `
            <div class="pr-terms c${terms.length}">
                ${terms.map((tm, i) => `
                    <button type="button" class="pr-term${i === (prSelTerm[p.id] || 0) ? ' active' : ''}" data-plan="${_prEsc(p.id)}" data-i="${i}"><span>${_prEsc(tm.label)}</span><small>${prCur()}${tm.price}</small></button>`).join('')}
            </div>` : `
            <div class="pr-termchip">${ico('timer')} ${_prEsc(t.label)} · ${t.validityDays} days</div>`}
            <div class="pr-price-row">
                <span class="pr-price">${prCur()}${t.price}</span>
                ${t.original > t.price ? `<span class="pr-price-old">${prCur()}${t.original}</span>` : ''}
                <span class="pr-price-term">/ ${_prEsc(t.label)}</span>
                ${t.original > t.price ? `<span class="pr-save">${ico('bolt')} SAVE ${prSavePct(t)}%</span>` : ''}
            </div>
            <div class="pr-permo">Equivalent to <b>${prCur()}${prPerMonth(t)}/mo</b> · valid ${t.validityDays} days</div>`
            : `<div class="pr-price-note">Live pricing loads from our server — refresh if it stays empty.</div>`}
            <div class="pr-chips">${(p.chips || []).map(c => `<span class="pr-chip">${_prEsc(c)}</span>`).join('')}</div>
        </div>`;
    }).join('');

    wrap.querySelectorAll('.pr-plan').forEach(card => {
        card.addEventListener('click', e => {
            const termBtn = e.target.closest('.pr-term');
            if (termBtn) {
                prSelTerm[termBtn.dataset.plan] = parseInt(termBtn.dataset.i, 10) || 0;
                prSelPlanId = termBtn.dataset.plan;
                prRefreshSel();
                return;
            }
            if (prSelPlanId !== card.dataset.plan) {
                prSelPlanId = card.dataset.plan;
                prRefreshSel();
            }
        });
        card.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); card.click(); }
        });
    });
}

function prRenderFeatures() {
    const el = document.getElementById('prFeatures');
    if (!el || !PR_DATA) return;
    const p = prPlanById(prSelPlanId);
    if (!p) { el.innerHTML = ''; return; }
    el.innerHTML = `
        <div class="pr-sec-head rv">${ico('star')} Everything inside ${_prEsc(p.name)}</div>
        <div class="pr-feats">
            ${(p.features || []).map(f => `
                <div class="pr-feat rv">
                    <span class="pr-feat-ico">${ico(f.icon)}</span>
                    <span class="pr-feat-txt">${_prEsc(f.text)}</span>
                </div>`).join('')}
        </div>`;
}

function prRenderCompare() {
    const el = document.getElementById('prCompare');
    if (!el || !PR_DATA || !PR_DATA.compare) return;
    const c = PR_DATA.compare;
    el.innerHTML = `
        <div class="pr-sec-head rv">${ico('chart')} Free vs Premium — at a glance</div>
        <table class="pr-compare rv">
            <thead><tr><th>Feature</th><th>${_prEsc(c.freeLabel || 'Free')}</th><th class="premium-col">${_prEsc(c.premiumLabel || 'Premium')}</th></tr></thead>
            <tbody>
                ${(c.rows || []).map(r => `
                    <tr>
                        <td class="lab">${_prEsc(r.label)}</td>
                        <td class="${r.free === '—' ? 'no' : ''}">${_prEsc(r.free)}</td>
                        <td class="yes">${_prEsc(r.premium)}</td>
                    </tr>`).join('')}
            </tbody>
        </table>`;
}

function prRenderStats() {
    const el = document.getElementById('prStats');
    if (!el || !PR_DATA) return;
    const stats = (PR_DATA.trust && PR_DATA.trust.stats) || [];
    el.innerHTML = stats.map(s => `
        <div class="pr-stat rv">
            <span class="pr-stat-ico">${ico(s.icon)}</span>
            <span class="pr-stat-num" data-target="${s.value}" data-suffix="${_prEsc(s.suffix || '+')}">0</span>
            <span class="pr-stat-lab">${_prEsc(s.label || '')}</span>
        </div>`).join('');
    el.querySelectorAll('.pr-stat-num').forEach((n, i) => {
        setTimeout(() => prAnimateNum(n, parseFloat(n.dataset.target) || 0, '', n.dataset.suffix || '+', 1200), 150 + i * 120);
    });
}

function prRenderFaqs() {
    const el = document.getElementById('prFaqs');
    if (!el || !PR_DATA) return;
    el.innerHTML = `
        <div class="pr-sec-head rv">${ico('headset')} Frequently asked questions</div>
        <div class="pr-faqs">
            ${(PR_DATA.faqs || []).map((f, i) => `
                <div class="pr-faq rv" data-i="${i}">
                    <button type="button" class="pr-faq-q">${_prEsc(f.q)} ${ico('chev')}</button>
                    <div class="pr-faq-a"><p>${_prEsc(f.a)}</p></div>
                </div>`).join('')}
        </div>`;
    el.querySelectorAll('.pr-faq-q').forEach(q => {
        q.addEventListener('click', () => {
            const item = q.parentElement;
            const panel = item.querySelector('.pr-faq-a');
            const open = item.classList.toggle('open');
            panel.style.maxHeight = open ? panel.scrollHeight + 'px' : '0px';
        });
    });
}

function prSelection() {
    const p = prPlanById(prSelPlanId);
    if (!p) return null;
    const t = prTermOf(p);
    return t ? { plan: p, term: t } : null;
}

function prRenderAside() {
    const el = document.getElementById('prAside');
    if (!el || !PR_DATA) return;
    const S = prSelection();
    if (!S) {
        el.innerHTML = `
            <div class="pr-aside-card rv">
                <div class="pr-aside-title">${ico('lock')} Order summary</div>
                <div class="pr-sum-row"><span>Live pricing is loading…</span></div>
            </div>`;
        return;
    }
    const final = S.term.price;
    el.innerHTML = `
        <div class="pr-aside-card rv">
            <div class="pr-aside-title">${ico('lock')} Order summary</div>
            <div class="pr-sum-row"><span>Plan</span><b>${_prEsc(S.plan.name)}</b></div>
            <div class="pr-sum-row"><span>Validity</span><b>${_prEsc(S.term.label)} · ${S.term.validityDays} days</b></div>
            ${S.term.original > final ? `<div class="pr-sum-row"><span>Regular price</span><b style="text-decoration:line-through;color:var(--text-3)">${prCur()}${S.term.original}</b></div>` : ''}
            ${S.term.original > final ? `<div class="pr-sum-row save"><span>You save</span><b>− ${prCur()}${prSave(S.term)} (${prSavePct(S.term)}%)</b></div>` : ''}
            <div class="pr-sum-div"></div>
            <div class="pr-sum-total"><span>Total payable</span><b id="asideTotal">${prCur()}${final}</b></div>
            <div class="pr-permo" style="margin-top:4px;">≈ <b>${prCur()}${prPerMonth(S.term)}/mo</b> for ${S.term.months} months · coupon applies at checkout</div>
            <button type="button" class="pr-cta gold-cta" id="proceedBtn">PROCEED TO CHECKOUT ${ico('arrow')}</button>
            <div class="pr-aside-trust">
                ${((PR_DATA.trust && PR_DATA.trust.badges) || []).map(b => `<div>${ico(b.icon)} ${_prEsc(b.label)}</div>`).join('')}
            </div>
            <div class="pr-payrow">
                ${((PR_DATA.trust && PR_DATA.trust.payments) || []).map(x => `<span>${_prEsc(x)}</span>`).join('')}
                <span class="pr-paynote">${ico('shield')} Razorpay secured</span>
            </div>
        </div>`;
    document.getElementById('proceedBtn').addEventListener('click', prProceed);
}

function prUpdateSticky() {
    const el = document.getElementById('prSticky');
    if (!el || !PR_DATA) return;
    const onPlans = document.getElementById('screenPlans').classList.contains('active');
    const S = prSelection();
    if (!S || !onPlans) { el.classList.remove('show'); el.innerHTML = ''; return; }
    el.innerHTML = `
        <div>
            <div class="sb-price">${prCur()}${S.term.price}</div>
            <div class="sb-meta">${_prEsc(S.plan.name)} · ${_prEsc(S.term.label)} · ≈${prCur()}${prPerMonth(S.term)}/mo</div>
        </div>
        <button type="button" class="pr-cta gold-cta" id="proceedBtnM">GET PREMIUM ${ico('arrow')}</button>`;
    el.classList.add('show');
    document.getElementById('proceedBtnM').addEventListener('click', prProceed);
}

// ── glue into checkout.js ────────────────────────────────────────────────────
async function prProceed() {
    const S = prSelection();
    if (!S) { if (window.showToast) showToast('Live pricing is still loading — please wait or refresh'); return; }
    try { localStorage.setItem('mmh_premium_sel', JSON.stringify({ planId: S.plan.id, backend: S.term.backendName, ts: Date.now() })); } catch (e) { /* ignore */ }

    // Plan browsing itself is public (buy-premium.html is not a gated
    // page), but moving on to checkout is a real account action — check
    // login right here, the same way every other protected action in the
    // app does (auth.js's own requireLogin(), which reuses the same
    // deduped session check initAuth() uses). If not logged in, this
    // redirects to /login.html?redirect=/buy-premium.html and returns
    // null; the plan choice already saved above survives the round trip.
    if (typeof requireLogin === 'function') {
        const user = await requireLogin();
        if (!user) return; // requireLogin() already redirected to login (or alerted on a network failure)
    }

    prShowScreen('checkout');
    // hand the choice to checkout.js (its own function — labels, coupon reset…)
    if (typeof window.selectPlan === 'function') window.selectPlan(S.term.backendName);
    prUpdateCkExtras();
}

// per-month + you-save maths on the checkout card, refreshed whenever
// checkout.js changes the plan or applies a coupon
function prUpdateCkExtras() {
    const perEl = document.getElementById('ckPerMonth');
    const saveEl = document.getElementById('ckSaveRow');
    if (!perEl || !saveEl) return;
    const finalP = parseFloat((document.getElementById('finalPrice') || {}).textContent);
    const origP = parseFloat((document.getElementById('originalPrice') || {}).textContent);
    let days = 0;
    try {
        if (typeof selectedPlan !== 'undefined' && selectedPlan) days = Number(selectedPlan.validity_days) || 0;
    } catch (e) { /* checkout.js not loaded */ }
    if (!days) {
        const vb = (document.getElementById('validityBadge') || {}).textContent || '';
        const m = vb.match(/(\d+)\s*DAYS/i);
        if (m) days = parseInt(m[1], 10);
    }
    if (!isFinite(finalP) || !days) { perEl.innerHTML = ''; saveEl.innerHTML = ''; return; }
    const months = Math.max(1, Math.round(days / 30.44));
    perEl.innerHTML = `Equivalent to <b>${prCur()}${Math.max(1, Math.round(finalP / months))}/mo</b> · valid ${days} days`;
    if (isFinite(origP) && origP > finalP) {
        const save = Math.round(origP - finalP);
        const pct = Math.round(save / origP * 100);
        saveEl.innerHTML = `<span class="pr-save">${ico('bolt')} YOU SAVE ${prCur()}${save} (${pct}%)</span>`;
    } else saveEl.innerHTML = '';
}
window.prUpdateCkExtras = prUpdateCkExtras;

// wrap checkout.js's own functions so the maths row follows every change
(function patchCheckoutHooks() {
    if (typeof window.selectPlan === 'function' && !window.selectPlan.__prPatched) {
        const _sp = window.selectPlan;
        window.selectPlan = function (n) { const r = _sp(n); prUpdateCkExtras(); return r; };
        window.selectPlan.__prPatched = true;
    }
    if (typeof window.applyCoupon === 'function' && !window.applyCoupon.__prPatched) {
        const _ac = window.applyCoupon;
        window.applyCoupon = function (c) {
            const r = _ac(c);
            if (r && r.then) r.then(prUpdateCkExtras).catch(() => {});
            else setTimeout(prUpdateCkExtras, 0);
            return r;
        };
        window.applyCoupon.__prPatched = true;
    }
})();

// ── checkout screen static bits from JSON ────────────────────────────────────
function prRenderCheckoutChrome() {
    const trust = document.getElementById('ckTrust');
    const pays = document.getElementById('ckPayments');
    const guar = document.getElementById('ckGuarantee');
    if (trust && PR_DATA && PR_DATA.trust) {
        trust.innerHTML = (PR_DATA.trust.badges || []).map(b => `<div>${ico(b.icon)} ${_prEsc(b.label)}</div>`).join('');
    }
    if (pays && PR_DATA && PR_DATA.trust) {
        pays.innerHTML = (PR_DATA.trust.payments || []).map(x => `<span>${_prEsc(x)}</span>`).join('') +
            `<span class="pr-paynote">${ico('shield')} Razorpay secured</span>`;
    }
    if (guar && PR_DATA && PR_DATA.trust) guar.textContent = PR_DATA.trust.guarantee || '';
}

// ── support bot ──────────────────────────────────────────────────────────────
function prInitBot() {
    const fab = document.getElementById('botFab');
    const panel = document.getElementById('botPanel');
    if (!fab || !panel || !PR_DATA || !PR_DATA.bot) return;
    const B = PR_DATA.bot;
    panel.innerHTML = `
        <div class="pr-bot-head">
            <span class="bh-ico">${ico('bot')}</span>
            <div><div class="bh-name">${_prEsc(B.name || 'Support Bot')}</div><div class="bh-sub">Online · replies instantly</div></div>
            <button type="button" id="botClose" aria-label="Close">${ico('x')}</button>
        </div>
        <div class="pr-bot-msgs" id="botMsgs"></div>
        <div class="pr-bot-quick" id="botQuick">
            ${(B.quick || []).map(q => `<button type="button">${_prEsc(q)}</button>`).join('')}
        </div>
        <div class="pr-bot-handoff">
            ${(B.handoff || []).map(h => `<a class="${h.icon === 'telegram' ? 'tg' : 'wa'}" href="${_prEsc(h.url)}" target="_blank" rel="noopener">${ico(h.icon)} ${_prEsc(h.label)}</a>`).join('')}
        </div>`;
    const msgs = panel.querySelector('#botMsgs');
    const push = (txt, who) => {
        const d = document.createElement('div');
        d.className = 'pr-bot-msg ' + who;
        d.textContent = txt;
        msgs.appendChild(d);
        msgs.scrollTop = msgs.scrollHeight;
        return d;
    };
    const answer = q => {
        const s = String(q || '').toLowerCase();
        const hit = (B.intents || []).find(it => (it.match || []).some(k => s.includes(k)));
        return hit ? hit.answer : (B.fallback || 'Please contact support.');
    };
    const ask = q => {
        push(q, 'user');
        const typing = document.createElement('div');
        typing.className = 'pr-bot-msg bot typing';
        typing.innerHTML = '<span></span><span></span><span></span>';
        msgs.appendChild(typing);
        msgs.scrollTop = msgs.scrollHeight;
        setTimeout(() => { typing.remove(); push(answer(q), 'bot'); }, 650);
    };
    panel.querySelector('#botQuick').addEventListener('click', e => {
        const b = e.target.closest('button');
        if (b) ask(b.textContent);
    });
    panel.querySelector('#botClose').addEventListener('click', () => panel.classList.remove('open'));
    fab.addEventListener('click', () => {
        const open = panel.classList.toggle('open');
        if (open && !msgs.children.length) push(B.greeting || 'Hi!', 'bot');
    });
}

// ── SEO (title/description + Product & FAQ structured data from JSON) ───────
function prInjectSeo() {
    if (!PR_DATA) return;
    if (PR_DATA.seo && PR_DATA.seo.title) document.title = PR_DATA.seo.title;
    if (PR_DATA.seo && PR_DATA.seo.description) {
        let m = document.querySelector('meta[name="description"]');
        if (!m) { m = document.createElement('meta'); m.name = 'description'; document.head.appendChild(m); }
        m.content = PR_DATA.seo.description;
    }
    const prices = (PR_DATA.plans || []).flatMap(p => prTerms(p).map(t => t.price));
    const graph = [];
    const product = {
        '@type': 'Product',
        'name': 'Mock Matrix Hub Premium Pass',
        'description': (PR_DATA.seo && PR_DATA.seo.description) || '',
        'brand': { '@type': 'Brand', 'name': 'Mock Matrix Hub' }
    };
    if (prices.length) {
        product.offers = {
            '@type': 'AggregateOffer',
            'priceCurrency': 'INR',
            'lowPrice': Math.min.apply(null, prices),
            'highPrice': Math.max.apply(null, prices),
            'offerCount': prices.length,
            'url': 'https://mockmatrixhub.in/buy-premium.html'
        };
    }
    graph.push(product);
    graph.push({
        '@type': 'FAQPage',
        'mainEntity': (PR_DATA.faqs || []).map(f => ({
            '@type': 'Question', 'name': f.q,
            'acceptedAnswer': { '@type': 'Answer', 'text': f.a }
        }))
    });
    const s = document.createElement('script');
    s.type = 'application/ld+json';
    s.textContent = JSON.stringify({ '@context': 'https://schema.org', '@graph': graph });
    document.head.appendChild(s);
}

// ── header auto-fit (same ladder as the home page) ──────────────────────────
const PR_APPBAR_FIT_LEVELS = 5;
function prFitAppbar() {
    const bar = document.querySelector('.screen.active .appbar') || document.querySelector('.appbar');
    const title = bar && bar.querySelector('.brand-title');
    const sub = bar && bar.querySelector('.brand-sub');
    if (!bar || !title) return;
    // measure with transitions killed — mid-animation widths give false
    // "it fits" reads and the fit bounces back to normal (home page fix)
    bar.classList.add('appbar-measuring');
    bar.classList.remove('appbar-compact', 'appbar-wrap');   // compact = legacy, never re-added
    for (let i = 1; i <= PR_APPBAR_FIT_LEVELS; i++) bar.classList.remove('appbar-fit-' + i);
    const stripped = () =>
        title.scrollWidth > title.clientWidth + 1 ||
        !!(sub && sub.scrollWidth > sub.clientWidth + 1);
    let lvl = 0;
    while (stripped() && lvl < PR_APPBAR_FIT_LEVELS) {
        lvl++;
        bar.classList.add('appbar-fit-' + lvl);   // inner items step down, header box stays
    }
    if (stripped()) bar.classList.add('appbar-wrap');
    bar.classList.remove('appbar-measuring');
}
window.prFitAppbar = prFitAppbar;
let _prFitT = null;
window.addEventListener('resize', () => {
    clearTimeout(_prFitT);
    _prFitT = setTimeout(prFitAppbar, 150);
});
window.addEventListener('load', prFitAppbar);
window.addEventListener('pageshow', prFitAppbar);   // bfcache back-navigation
window.addEventListener('profileUpdated', prFitAppbar);
// webfonts landing change text metrics — refit once they are ready
if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
    document.fonts.ready.then(() => prFitAppbar()).catch(() => {});
}
// auth chip / app-switch slot land in the header AFTER the first fit —
// refit on every header-content mutation so the fitted state persists
(function () {
    function wireAppbarMO() {
        if (window.MutationObserver) {
            const mo = new MutationObserver(() => prFitAppbar());
            ['authHeaderArea', 'appSwitchSlot'].forEach(id => {
                const n = document.getElementById(id);
                if (n) mo.observe(n, { childList: true, subtree: true, attributes: true, characterData: true });
            });
        }
        // header images (logo) can land late on slow connections — refit
        // when they finally paint, or fail and swap to the fallback svg
        document.querySelectorAll('.screen-header img, .appbar img').forEach(im => {
            im.addEventListener('load', prFitAppbar);
            im.addEventListener('error', prFitAppbar);
        });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireAppbarMO);
    else wireAppbarMO();
})();

// ── toast fallback ───────────────────────────────────────────────────────────
if (typeof window.showToast !== 'function') {
    window.showToast = function (message) {
        let t = document.querySelector('.pr-toast');
        if (!t) { t = document.createElement('div'); t.className = 'pr-toast'; document.body.appendChild(t); }
        t.textContent = message;
        t.classList.add('show');
        clearTimeout(t._h);
        t._h = setTimeout(() => t.classList.remove('show'), 2600);
    };
}

// ── boot ─────────────────────────────────────────────────────────────────────
async function initPremiumPage() {
    const back = document.getElementById('backToPlans');
    if (back) back.addEventListener('click', () => prShowScreen('plans', true));

    try {
        await prLoadData();
    } catch (e) {
        const root = document.getElementById('plansRoot');
        if (root) root.innerHTML = `
            <div class="empty-state">
                <div class="empty-ico">${ico('shield')}</div>
                <div class="empty-title">Couldn't load plans</div>
                <div class="empty-sub">Please check your connection and try again.</div>
                <button type="button" class="ex-retry" onclick="initPremiumPage()">Try Again</button>
            </div>`;
        return;
    }

    const plans = PR_DATA.plans || [];
    const highlighted = plans.find(p => p.highlight) || plans[0];
    prSelPlanId = highlighted ? highlighted.id : null;
    // Default EVERY card to its longest term (365 days) so the 1 Year plan
    // is always pre-selected — same rule as checkout.js.
    plans.forEach(p => { prSelTerm[p.id] = prDefaultTermIndex(p); });
    // Restore a selection ONLY from the login round-trip (saved moments ago).
    // A stale old choice must never override the 365-day default.
    try {
        const raw = localStorage.getItem('mmh_premium_sel');
        if (raw) {
            const o = JSON.parse(raw);
            if (o && Date.now() - (Number(o.ts) || 0) < 10 * 60 * 1000) {
                const p = prPlanById(o.planId);
                if (p) {
                    prSelPlanId = p.id;
                    const terms = prTerms(p);
                    const ti = terms.findIndex(t => t.backendName === o.backend);
                    if (ti >= 0) prSelTerm[p.id] = ti;
                }
            }
        }
    } catch (e) { /* ignore */ }

    prRenderHero();
    prRenderPlans();
    prRenderFeatures();
    prRenderCompare();
    prRenderStats();
    prRenderFaqs();
    prRenderAside();
    prUpdateSticky();
    prRenderCheckoutChrome();
    prInitBot();
    prInjectSeo();
    prUpdateCkExtras();
    prReveal(document);
    prFitAppbar();
    setTimeout(prFitAppbar, 500);
}
window.initPremiumPage = initPremiumPage;
document.addEventListener('DOMContentLoaded', initPremiumPage);
