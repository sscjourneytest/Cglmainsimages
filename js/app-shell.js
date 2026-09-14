/* ═══════════════════════════════════════════════════════════════════════════
   APP SHELL — app chrome (works standalone AND on the live site)
   Multi-screen nav (Year → Subjects → Mocks, back exits via history.back)
   · toasts · bottom-sheet modals · theme toggle · chip-row wheel scroller
   · key-search title sync · back-to-top. Demo attempt seeds + "open test"
   intercept are STANDALONE_DEMO only. Every hook is null-checked, so the
   exam engine runs without any of it.
   ═══════════════════════════════════════════════════════════════════════════ */
(function(){
'use strict';

/* ── Inline icon set (stroke style — replaces FontAwesome, zero CDN) ─────── */
var S = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
var ICO = {
    check  : '<svg '+S+' stroke-width="2.4"><path d="M4.5 12.5l5 5L20 6.5"/></svg>',
    chart  : '<svg '+S+'><path d="M4 20h16"/><path d="M6.5 20v-6M12 20V7M17.5 20V10.5"/></svg>',
    info   : '<svg '+S+'><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M12 11.5V16"/></svg>',
    alert  : '<svg '+S+'><circle cx="12" cy="12" r="9"/><path d="M12 7.5V13M12 16.5h.01"/></svg>',
    sun    : '<svg '+S+'><circle cx="12" cy="12" r="4.5"/><path d="M12 2.5v2M12 19.5v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2.5 12h2M19.5 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    moon   : '<svg '+S+'><path d="M20.5 13.2A8.5 8.5 0 1 1 10.8 3.5a7 7 0 0 0 9.7 9.7z"/></svg>',
    bolt   : '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M13 2L4.8 13.5h5L9.5 22l8.7-11.5h-5L13 2z"/></svg>',
    play   : '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M8 5.8v12.4c0 .8.9 1.3 1.6.9l10-6.2c.7-.4.7-1.4 0-1.8l-10-6.2c-.7-.4-1.6.1-1.6.9z"/></svg>',
    lock   : '<svg '+S+' stroke-width="2.2"><rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/></svg>'
};

/* ── Toasts ──────────────────────────────────────────────────────────────── */
function showToast(msg, type){
    var root = document.getElementById('toastRoot');
    if (!root) return;
    var icon = type === 'error'   ? ICO.alert
             : type === 'success' ? ICO.check
             : ICO.info;
    var t = document.createElement('div');
    t.className = 'toast';
    var ico = document.createElement('span');
    ico.innerHTML = icon;
    if (type) ico.firstElementChild && ico.firstElementChild.classList.add(type === 'success' ? 'success' : (type === 'error' ? 'error' : 'info'));
    var span = document.createElement('span');
    span.textContent = msg;
    t.appendChild(ico);
    t.appendChild(span);
    root.appendChild(t);
    setTimeout(function(){
        t.classList.add('out');
        setTimeout(function(){ t.remove(); }, 260);
    }, 2400);
}
window.showToast = showToast;

/* ── Promise-based confirm sheet (replaces native confirm()) ─────────────── */
function showAppConfirm(opts){
    opts = opts || {};
    return new Promise(function(resolve){
        var ov = document.createElement('div');
        ov.className = 'modal-overlay';
        ov.innerHTML =
            '<div class="modal-sheet">' +
                '<div class="grabber"></div>' +
                '<div class="modal-title"></div>' +
                '<div class="modal-body"></div>' +
                '<div class="modal-actions">' +
                    '<button type="button" class="modal-btn ghost" data-role="no">Cancel</button>' +
                    '<button type="button" class="modal-btn danger" data-role="yes"></button>' +
                '</div>' +
            '</div>';
        ov.querySelector('.modal-title').textContent = opts.title || 'Are you sure?';
        ov.querySelector('.modal-body').textContent  = opts.body  || '';
        var yes = ov.querySelector('[data-role="yes"]');
        yes.textContent = opts.confirmLabel || 'Confirm';
        if (opts.danger === false) yes.className = 'modal-btn primary';

        function done(v){
            ov.remove();
            document.removeEventListener('keydown', onKey);
            resolve(v);
        }
        function onKey(e){ if (e.key === 'Escape') done(false); }
        ov.addEventListener('click', function(e){ if (e.target === ov) done(false); });
        ov.querySelector('[data-role="no"]').onclick  = function(){ done(false); };
        yes.onclick = function(){ done(true); };
        document.addEventListener('keydown', onKey);
        document.body.appendChild(ov);
    });
}
window.showAppConfirm = showAppConfirm;

/* ── Theme (same `mmh_theme` key the live home page uses) ────────────────── */
var THEME_KEY = 'mmh_theme';
function currentTheme(){
    try{
        var s = localStorage.getItem(THEME_KEY);
        if (s === 'dark' || s === 'light') return s;
    }catch(e){ /* private mode */ }
    return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
}
function applyTheme(t){
    document.body.classList.toggle('dark-mode', t === 'dark');
    var m = document.querySelector('meta[name="theme-color"]');
   if (m) m.content = t === 'dark' ? '#121a30' : '#ffffff';
   
    /* every screen has its own toggle — refresh them all */
    var btns = document.querySelectorAll ? document.querySelectorAll('.theme-btn') : [];
    var list = (btns && btns.length) ? btns : [document.getElementById('themeToggle')].filter(Boolean);
    list.forEach(function(b){
        b.innerHTML = t === 'dark' ? ICO.sun : ICO.moon;
        b.setAttribute('aria-label', t === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
    });
}
window.currentTheme = currentTheme;
window.applyTheme = applyTheme;
window.toggleTheme = function(){
    var t = currentTheme() === 'dark' ? 'light' : 'dark';
    try{ localStorage.setItem(THEME_KEY, t); }catch(e){ /* ignore */ }
    applyTheme(t);
};

/* ── Demo profile (STANDALONE only) ────────────────────────────────────────
   On the live site the host page's OWN getLocalProfile() (auth) takes
   precedence — we only provide a fallback when nothing else defines it.
   A named (non-Guest) profile lets the engine run its REAL logged-in flow:
   it absorbs local result_* keys into CLOUD_CHECKLIST, which powers the
   score bars, cutoff markers and attempt dates.                             */
var DEMO_USER = 'DemoStudent';
if (typeof window.getLocalProfile !== 'function'){
    window.getLocalProfile = function(){
        return { username: DEMO_USER, is_paid: false };
    };
}

/* ── Demo attempt seeds ────────────────────────────────────────────────────
   A few "attempted" mocks are pre-filled (first open only) so the score
   bars, cutoff markers, ANALYSIS/REATTEMPT buttons and dashboard stats are
   visible in the preview. They live under result_Guest_* exactly like the
   real test player writes them, and the engine absorbs them through its
   normal code path — nothing is faked at render time.                          */
(function seedDemoAttempts(){
    if (window.STANDALONE_DEMO !== true) return; /* live site: real attempts only */
    var KEY = 'mmh_demo_seeded_v1';
    try{ if (localStorage.getItem(KEY)) return; }catch(e){ return; }

    var data = (window.__EXAM_JSON__ && window.__EXAM_JSON__.data) || {};
    var year = Object.keys(data)[0];
    if (!year) return;
    var yd = data[year];

    function firstItem(node){
        if (Array.isArray(node)) return node.find(function(x){ return x && x.id; }) || null;
        if (node && typeof node === 'object'){
            for (var k in node){
                if (!Object.prototype.hasOwnProperty.call(node, k)) continue;
                var r = firstItem(node[k]);
                if (r) return r;
            }
        }
        return null;
    }

    var plans = [];
    var math   = yd['Math'] || {};
    var reason = yd['Reasoning'] || {};
    var ga     = yd['General Awareness'] || {};

    if (Array.isArray(math['PERCENTAGE']) && math['PERCENTAGE'].length >= 2){
        plans.push({ item: math['PERCENTAGE'][0], pctScore: 0.84, daysAgo: 2 });
        plans.push({ item: math['PERCENTAGE'][1], pctScore: 0.54, daysAgo: 6 });
    }
    if (Array.isArray(math['RATIO AND PROPORTION']) && math['RATIO AND PROPORTION'][0])
        plans.push({ item: math['RATIO AND PROPORTION'][0], pctScore: 0.92, daysAgo: 10 });

    var rt = Object.keys(reason)[0];
    if (rt){ var ri = firstItem(reason[rt]); if (ri) plans.push({ item: ri, pctScore: 0.76, daysAgo: 14 }); }

    var gt = Object.keys(ga)[0];
    if (gt){ var gi = firstItem(ga[gt]); if (gi) plans.push({ item: gi, pctScore: 0.68, daysAgo: 20 }); }

    try{
        plans.forEach(function(p){
            if (!p.item || p.item.id == null) return;
            var marks = typeof p.item.marks === 'number' ? p.item.marks : 50;
            var score = Math.round(marks * p.pctScore);
            var d = new Date(Date.now() - p.daysAgo * 86400000);
            function pad(n){ return (n < 10 ? '0' : '') + n; }
            var submittedAt = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
                               ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
            localStorage.setItem('result_' + DEMO_USER + '_' + p.item.id,
                JSON.stringify({ firebasePayload: { score: score, submittedAt: submittedAt } }));
        });
        localStorage.setItem(KEY, '1');
    }catch(e){ /* private mode — skip seeding, page still works */ }
})();

/* ── Grid observer: card entrance stagger on every render ───────────────── */
var grid = document.getElementById('quizGrid');
if (grid && window.MutationObserver){
    var tick = false;
    var mo = new MutationObserver(function(){
        if (tick) return;
        tick = true;
        requestAnimationFrame(function(){
            tick = false;
            grid.querySelectorAll('.mock-card').forEach(function(c, i){
                c.style.animationDelay = Math.min(i * 40, 320) + 'ms';
            });
        });
    });
    mo.observe(grid, { childList: true });
}

/* ── Search box (engine's key-search: subject / topic / subtopic) ───────── */
var sInput = document.getElementById('mockSearch');
var sClear = document.getElementById('searchClear');
if (sInput && sClear){
    sInput.addEventListener('input', function(){
        sClear.classList.toggle('show', !!sInput.value);
    });
    sClear.onclick = function(){
        sInput.value = '';
        sClear.classList.remove('show');
        /* dispatch a real 'input' so the engine's key-search dropdown hides */
        try{ sInput.dispatchEvent(new Event('input', { bubbles: true })); }catch(e){}
        if (typeof renderMocks === 'function') renderMocks();
        sInput.focus();
    };
}

/* ── Chip-row wheel scroller (desktop) ─────────────────────────────────────
   Long topic/subtopic rows scroll sideways with the mouse wheel; at either
   end the wheel is released back to the page so vertical scroll works.     */
(function chipWheel(){
    var tools = document.querySelector('.mocks-tools');
    if (!tools || !tools.addEventListener) return;
    tools.addEventListener('wheel', function(e){
        var t = e && e.target;
        var row = t && t.closest ? (t.closest('.filter-scroll-wrapper') || null) : null;
        if (!row) return;
        var max = (row.scrollWidth || 0) - (row.clientWidth || 0);
        if (max < 4) return;
        var d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        if (!d) return;
        if ((d < 0 && (row.scrollLeft || 0) <= 0) || (d > 0 && (row.scrollLeft || 0) >= max)) return;
        if (Math.abs(e.deltaY) >= Math.abs(e.deltaX)) e.preventDefault();
        row.scrollLeft += d;
    }, { passive: false });
})();

/* ── Back to top ─────────────────────────────────────────────────────────── */
var scroller = document.querySelector('.scrollable-grid-area');
var btt = document.getElementById('backTop');
if (scroller && btt){
    scroller.addEventListener('scroll', function(){
        btt.classList.toggle('show', scroller.scrollTop > 520);
    }, { passive: true });
    btt.onclick = function(){ scroller.scrollTo({ top: 0, behavior: 'smooth' }); };
}

/* ── "Open test" intercept (demo only — STANDALONE_DEMO flag) ───────────────
   On the live site the anchors navigate to test.html as before; here they
   open a polished preview sheet instead of 404ing on a missing file.        */
function openTestPreview(anchor){
    var card = anchor.closest('.mock-card');
    if (!card) return;
    var titleEl = card.querySelector('.card-title');
    var metaEl  = card.querySelector('.card-meta');
    var rawAction = (anchor.textContent || '').trim();
    var action = rawAction.replace(/[\u{1F000}-\u{1FFFF}\u2600-\u27BF\uFE0F]/gu, '').trim().toUpperCase();

    var title = titleEl ? titleEl.textContent.replace(/\b(FREE|PAID)\b/g, '').trim() : 'Mock Test';
    var metaText = metaEl ? metaEl.textContent.replace(/\s+/g, ' ').trim() : '';
    var isPaid = card.classList.contains('is-paid');
    var isUnlock    = action.indexOf('UNLOCK')    !== -1;
    var isAnalysis  = action.indexOf('ANALYSIS')  !== -1;
    var isResume    = action.indexOf('RESUME')    !== -1;
    var isReattempt = action.indexOf('REATTEMPT') !== -1;

    var icon = isAnalysis ? ICO.chart : (isResume ? ICO.play : (isUnlock ? ICO.lock : ICO.bolt));
    var tint = isPaid ? 'linear-gradient(135deg,#fbbf24,#d97706)' : (isAnalysis ? 'linear-gradient(135deg,#6366f1,#4338ca)' : 'var(--grad-primary)');
    var openLabel = isUnlock ? 'View Premium Plans'
                     : isAnalysis ? 'Open Analysis'
                     : isReattempt ? 'Start New Attempt'
                     : isResume ? 'Resume Test'
                     : 'Launch Test';

    var ov = document.createElement('div');
    ov.className = 'modal-overlay';
    ov.innerHTML =
        '<div class="modal-sheet test-preview">' +
            '<div class="grabber"></div>' +
            '<div class="tp-ico" style="--tp-c:' + tint + '">' + icon + '</div>' +
            '<div class="modal-title"></div>' +
            '<div class="tp-meta"></div>' +
            '<div class="tp-badge ' + (isPaid ? 'paid' : 'free') + '">' + (isPaid ? 'PAID' : 'FREE') + '</div>' +
            '<button type="button" class="modal-btn primary tp-open"></button>' +
            '<button type="button" class="modal-btn ghost tp-close">Close</button>' +
            '<div class="tp-note">Design preview — on the live site this button opens the test player (test.html).</div>' +
        '</div>';
    ov.querySelector('.modal-title').textContent = title;
    ov.querySelector('.tp-meta').textContent = metaText;
    ov.querySelector('.tp-open').textContent = openLabel;

    function close(){ ov.remove(); }
    ov.querySelector('.tp-close').onclick = close;
    ov.querySelector('.tp-open').onclick = function(){
        close();
        showToast(isUnlock ? 'Premium plans live on the full site' : 'Test player lives on the full site', 'info');
    };
    ov.addEventListener('click', function(e){ if (e.target === ov) close(); });
    document.body.appendChild(ov);
}

document.getElementById('quizGrid').addEventListener('click', function(e){
    var a = e.target.closest ? e.target.closest('a.action-btn') : null;
    if (!a || !window.STANDALONE_DEMO) return;
    e.preventDefault();
    openTestPreview(a);
});

/* ══ Multi-screen navigation — Year → Subjects → Mocks ════════════════════
   Android-app style flow. The URL always reflects the current drill using the
   SAME format the live site + engine already speak (?filter=year=...,
   subject=...,topic=...,subtopic=...) — deep links keep working untouched,
   and saveFilters() from the engine keeps the address bar in sync.        */

var ICO_NAV = {
    calendar : '<svg '+S+'><rect x="3.5" y="5" width="17" height="16" rx="3"/><path d="M3.5 9.5h17M8 3v4M16 3v4" stroke-linecap="round"/></svg>',
    calc     : '<svg '+S+'><rect x="5" y="3" width="14" height="18" rx="2.5"/><path d="M8.5 7.5h7" stroke-linecap="round"/><path d="M8.5 12h.01M12 12h.01M15.5 12h.01M8.5 15.5h.01M12 15.5h.01M15.5 15.5v.01" stroke-linecap="round" stroke-width="2.6"/></svg>',
    puzzle   : '<svg '+S+'><path d="M10 3.5a2 2 0 0 1 4 0V5h3a2 2 0 0 1 2 2v3h1.5a2 2 0 0 1 0 4H19v3a2 2 0 0 1-2 2h-3v-1.5a2 2 0 0 0-4 0V19h-3a2 2 0 0 1-2-2v-3H3.5a2 2 0 0 1 0-4H5V7a2 2 0 0 1 2-2h3V3.5z"/></svg>',
    globe    : '<svg '+S+'><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.3 3.8 5.2 3.8 8.5s-1.3 6.2-3.8 8.5c-2.5-2.3-3.8-5.2-3.8-8.5s1.3-6.2 3.8-8.5z"/></svg>',
    book     : '<svg '+S+'><path d="M12 6.5C10.2 5 7.8 4.5 4.5 4.5v13c3.3 0 5.7.5 7.5 2 1.8-1.5 4.2-2 7.5-2v-13c-3.3 0-5.7.5-7.5 2z"/><path d="M12 6.5v13"/></svg>',
    archive  : '<svg '+S+'><rect x="3.5" y="4" width="17" height="4.5" rx="1.5"/><path d="M5.5 8.5V18a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8.5M10 12.5h4"/></svg>',
    clip     : '<svg '+S+'><rect x="5.5" y="4" width="13" height="17" rx="2.5"/><path d="M9 2.5h6v3H9z" fill="currentColor" stroke="none"/><path d="M9 11h6M9 15h4"/></svg>',
    chev     : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>'
};

var hubYear = '';
var hubFromDeeper = false; /* year screen reached by stepping back from a deeper screen */
var ROOT_TITLE = document.title; /* this page's own root title, captured before any hub-nav rewrites */

/* exam data — standalone embeds it as window.__EXAM_JSON__; on the live site
   the engine holds it in its top-level EXAM_JSON binding */
function hubData(){
    if (window.__EXAM_JSON__) return window.__EXAM_JSON__;
    try{ if (typeof EXAM_JSON !== 'undefined' && EXAM_JSON) return EXAM_JSON; }catch(e){}
    return null;
}

function countItems(node){
    if (Array.isArray(node)) return node.length;
    if (node && typeof node === 'object'){
        var t = 0;
        Object.values(node).forEach(function(v){ t += countItems(v); });
        return t;
    }
    return 0;
}

function subjectIcon(name){
    var n = String(name).toLowerCase();
    if (n.indexOf('math') >= 0)    return { ico: ICO_NAV.calc,    cls: 'blue'   };
    if (n.indexOf('reason') >= 0)  return { ico: ICO_NAV.puzzle,  cls: 'violet' };
    if (n.indexOf('old') >= 0)     return { ico: ICO_NAV.archive, cls: 'slate'  };
    if (n.indexOf('english') >= 0) return { ico: ICO_NAV.book,    cls: 'teal'   };
    if (n.indexOf('general') >= 0 || n.indexOf('awareness') >= 0) return { ico: ICO_NAV.globe, cls: 'amber' };
    return { ico: ICO_NAV.clip, cls: 'blue' };
}

function isScreenActive(id){
    var s = document.getElementById(id);
    return !!(s && s.classList.contains('active'));
}

function showScreen(id, dir){
    ['screenYear','screenSubjects','screenMocks'].forEach(function(sid){
        var s = document.getElementById(sid);
        if (s){ s.classList.remove('active'); s.classList.remove('from-left'); }
    });
    var scr = document.getElementById(id);
    if (!scr) return;
    scr.classList.add('active');
    if (dir === -1) scr.classList.add('from-left');
    var sc = scr.querySelector('.screen-scroll') || scr.querySelector('.scrollable-grid-area');
    if (sc) sc.scrollTop = 0;
}

/* same URL format the engine's _updateUrlFilter writes — now also preserves
   the bare exam token (e.g. ?AtoZ-V) the same way the engine's own writer
   does, so it's never dropped when hubNavYear/hubNavSubject rewrite the URL */
function filterUrl(o){
    var fs = ['year','subject','topic','subtopic']
        .filter(function(k){ return o[k]; })
        .map(function(k){ return k + '=' + o[k]; })
        .join(',');

    var examToken = window.location.search
        ? window.location.search.slice(1).split('&').find(function(p){ return p.indexOf('filter=') !== 0; })
        : null;

    var query = examToken
        ? '?' + examToken + (fs ? '&filter=' + encodeURIComponent(fs) : '')
        : (fs ? '?filter=' + encodeURIComponent(fs) : '');

    return window.location.pathname + query;
}

function buildSubjectCards(y){
    var d = hubData() && hubData().data;
    var yd = d && d[y];
    var box = document.getElementById('subjectCards');
    if (!box || !yd) return;
    box.innerHTML = Object.keys(yd).map(function(s){
        var ic = subjectIcon(s);
        var nT = (yd[s] && !Array.isArray(yd[s])) ? Object.keys(yd[s]).length : 0;
        var safe = String(s).replace(/'/g, "\\'");
        return '<button type="button" class="nav-card" onclick="hubNavSubject(\'' + safe + '\')">' +
            '<span class="nc-ico ' + ic.cls + '">' + ic.ico + '</span>' +
            '<span class="nc-body"><span class="nc-title">' + s + '</span>' +
            '<span class="nc-meta">' + nT + ' topics · ' + countItems(yd[s]) + ' mocks</span></span>' +
            '<span class="nc-chev">' + ICO_NAV.chev + '</span>' +
        '</button>';
    }).join('');
    var t = document.getElementById('subjectsTitle');
    if (t) t.textContent = y;
    var sb = document.getElementById('subjectsSub');
    if (sb) sb.textContent = Object.keys(yd).length + ' subjects · ' + countItems(yd) + ' mocks';
}

/* Year card tapped → subjects screen (URL: ?filter=year=…) */
window.hubNavYear = function(y){
    var d = hubData() && hubData().data;
    if (!d || !d[y]) return;
    hubYear = y;
    try{
        history.pushState({ mmhNav: 1 }, '', filterUrl({ year: y }));
        currentFilters.year = y;
        currentFilters.subject = '';
        currentFilters.topic = '';
        currentFilters.subtopic = '';
        saveFilters();
    }catch(e){ /* history may be unavailable (file://) — screens still work */ }
    buildSubjectCards(y);
    showScreen('screenSubjects', 1);
    document.title = y + ' Subjects — Mock Matrix Hub';
};

/* Subject card tapped → mocks screen (engine renders, URL gets subject) */
window.hubNavSubject = function(s){
    var y = hubYear || (currentFilters.year || '');
    try{
        history.pushState({ mmhNav: 1 }, '', filterUrl({ year: y, subject: s }));
    }catch(e){}
    if (typeof setDeepFilter === 'function'){
        setDeepFilter('subject', s); /* engine re-renders + syncs URL/session */
    }
    var mt = document.getElementById('mockTitle');
    if (mt) mt.textContent = s;
    showScreen('screenMocks', 1);
    document.title = s + ' Mocks — Mock Matrix Hub';
};

/* Back arrow — steps up the drill: mocks → subjects → year.
   Script-defined target, but when the current history entry is one WE pushed
   (marker mmhNav) it pops just that entry so the DEVICE back button keeps the
   same step-through workflow. On a direct/deep link (no marker) it steps the
   screens in place — never closing the tab or bouncing, so the Subjects ↔
   Year loop can never happen. */
window.hubBack = function(){
    var st = (window.history && window.history.state) || null;
    if (st && st.mmhNav){
        try{ history.back(); return; }catch(e){ /* fall through to in-place step */ }
    }
    if (isScreenActive('screenMocks')){
        currentFilters.topic = '';
        currentFilters.subtopic = '';
        currentFilters.subject = '';
        try{ saveFilters(); }catch(e){}
        showScreen('screenSubjects', -1);
        document.title = hubYear + ' Subjects — Mock Matrix Hub';
    } else if (isScreenActive('screenSubjects')){
        currentFilters.year = '';
        currentFilters.subject = '';
        currentFilters.topic = '';
        currentFilters.subtopic = '';
        try{ saveFilters(); }catch(e){}
        hubFromDeeper = true; /* so the year-page back arrow knows where to return */
        updateYearBack();
        showScreen('screenYear', -1);
        document.title = ROOT_TITLE;
    }
};

/* Year-page back arrow — returns to the page the user came from:
   · any earlier history entry → pop it (also covers the app WebView, where
     document.referrer is often empty)
   · stepped back here from subjects/mocks → go back to subjects
   · arrived from another page on the site (referrer)  → browser back  */
function updateYearBack(){
    var b = document.getElementById('backFromYear');
    if (!b) return;
    b.style.display = ''; // always visible — this page has a defined parent (exams index)
}
window.hubBackFromYear = function(){
    /* Deterministic parent navigation — NEVER history.back(). Always goes to
       the exams index (parent page) however the user arrived, so it can never
       close the tab. */
    try{
        var seg = window.location.pathname.replace(/\/+$/, '').split('/');
        if (seg[seg.length - 1] === 'index.html') seg.pop(); // this page
        seg.pop();                                            // this exam folder
        var parent = seg.join('/') || '/';
        if (parent.charAt(parent.length - 1) !== '/') parent += '/';
        window.location.href = parent + 'index.html';
    }catch(e){
        window.location.href = '../index.html';
    }
};

/* Land on the screen that matches the URL (?filter=…) — used at boot
   (deep links) and on every browser/system back (popstate).
   The URL is the source of truth: engine state is synced to it here. */
window.hubLandFromUrl = function(){
    var p = (typeof _getUrlFilters === 'function') ? _getUrlFilters() : null;
    var d = hubData() && hubData().data;
    var cf = (typeof currentFilters !== 'undefined') ? currentFilters : null;
    if (!d || !cf) return;
    var years = Object.keys(d);
    hubFromDeeper = false; /* any URL landing resets the year-page back context */

    var year = p && p.year ? (_matchCaseInsensitive(years, p.year) || '') : '';
    if (!year) year = (years.length ? years.slice().sort().reverse()[0] : '');

    if (p){
        /* URL-driven: make the engine's state match the URL drill */
        if (cf.year !== year){ cf.year = year; cf.subject = ''; cf.topic = ''; cf.subtopic = ''; }
        hubYear = year;
        if (year) buildSubjectCards(year);

        if (p.subject && d[year]){
            var subj = _matchCaseInsensitive(Object.keys(d[year]), p.subject) || '';
            if (subj){
                cf.subject = subj;
                cf.topic = p.topic || '';
                cf.subtopic = p.subtopic || '';
                /* one render, exactly what setDeepFilter does internally */
                saveFilters();
                setupFilters(years);
                renderMocks();
            }
        }
    } else {
        /* No URL filter: keep engine state, just make sure hubYear is sane */
        if (cf.year && d[cf.year]) hubYear = cf.year;
        else hubYear = year;
    }

    var mt = document.getElementById('mockTitle');
    if (p && p.subject){
        if (mt) mt.textContent = p.subject;
        showScreen('screenMocks', 0);
        document.title = p.subject + ' Mocks — Mock Matrix Hub';
    } else if (p && p.year){
        showScreen('screenSubjects', 0);
        document.title = p.year + ' Subjects — Mock Matrix Hub';
    } else {
        hubFromDeeper = false; /* fresh landing on the year screen */
        updateYearBack();
        showScreen('screenYear', 0);
        document.title = ROOT_TITLE;
    }
};

/* The engine's key-search can jump straight to another subject/topic/
   subtopic — after it lands, keep the hub's title + year in sync. */
function wrapSearchJump(){
    var orig = window._selectSearchResult;
    if (typeof orig !== 'function' || orig.__mmhWrapped) return;
    var w = function(y, s, t, st){
        orig(y, s, t, st);
        if (s){
            if (y && hubData() && hubData().data[y]) buildSubjectCards(hubYear = y);
            var mt = document.getElementById('mockTitle');
            if (mt) mt.textContent = s;
            document.title = s + ' Mocks — Mock Matrix Hub';
        }
        hubFromDeeper = false;
        updateYearBack();
    };
    w.__mmhWrapped = true;
    window._selectSearchResult = w;
}

/* Boot the flow (called after initExamEngine resolves, so currentFilters
   already reflects: URL deep link > saved session > defaults) */
function initHubNav(){
    var d = hubData() && hubData().data;
    if (!d) return;
    var years = Object.keys(d);

    var yc = document.getElementById('yearCards');
    if (yc){
        yc.innerHTML = years.map(function(y){
            return '<button type="button" class="nav-card" onclick="hubNavYear(\'' + y + '\')">' +
                '<span class="nc-ico blue">' + ICO_NAV.calendar + '</span>' +
                '<span class="nc-body"><span class="nc-title">' + y + '</span>' +
                '<span class="nc-meta">' + Object.keys(d[y]).length + ' subjects · ' + countItems(d[y]) + ' mocks</span></span>' +
                '<span class="nc-chev">' + ICO_NAV.chev + '</span>' +
            '</button>';
        }).join('');
    }

    var cf = (typeof currentFilters !== 'undefined') ? currentFilters : { year: years[0] };
    hubYear = cf.year || years[0];
    buildSubjectCards(hubYear);
    var mt = document.getElementById('mockTitle');
    if (mt && cf.subject) mt.textContent = cf.subject;

    var bm = document.getElementById('backFromMocks');
    if (bm) bm.onclick = hubBack;
    var bs = document.getElementById('backFromSubjects');
    if (bs) bs.onclick = hubBack;
    var by = document.getElementById('backFromYear');
    if (by) by.onclick = window.hubBackFromYear;
    updateYearBack();

    wrapSearchJump(); /* must run after the engine script has parsed */

    var tbtns = document.querySelectorAll('.theme-btn');
    Array.prototype.forEach.call(tbtns || [], function(b){
        b.onclick = function(){ toggleTheme(); };
    });

    window.addEventListener('popstate', function(){ hubLandFromUrl(); });
    hubLandFromUrl();
}
window.initHubNav = initHubNav;

/* debug/test hooks (unused in production) */
window.__mmh_debug = {
    hubNavYear: window.hubNavYear, hubNavSubject: window.hubNavSubject,
    hubBack: window.hubBack, hubLandFromUrl: window.hubLandFromUrl,
    hubBackFromYear: window.hubBackFromYear
};

})();
