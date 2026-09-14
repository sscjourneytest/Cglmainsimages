// ============================================================
// Mock Matrix Hub — Saved Questions Page Logic
// ============================================================

let SAVED_DATA_RAW = {};      // raw firebase tree (subject-nested + any legacy leaves)
let QUESTION_LIST = [];       // flattened: [{key, quiz_id, question_data, saved_at, subject, legacy}]
let FILTERED_LIST = [];       // after subject-chip filtering
let currentFocusIdx = 0;
let currentLang = localStorage.getItem("quiz_lang") || "en";
let USER_EMAIL_KEY = "";

// Canonical subject taxonomy — same list used by the "Save Question" modal elsewhere.
const SUBJECTS = ["REASONING", "MATH", "GK", "ENGLISH", "HINDI", "MISCELLANEOUS"];

// Normalizes any subject string (from Firebase, from a <select>, from the
// legacy auto-detect rules) into one of the canonical SUBJECTS values above.
// This is the single choke point every subject string must pass through —
// it's what keeps the filter chips, the move-to <select>, and the Firebase
// node name from ever disagreeing again. Also strips characters that are
// illegal in Firebase RTDB keys (. # $ [ ] /) and folds GS/General
// Awareness/General Studies variants into GK.
function normalizeSubject(s) {
    if (!s) return "MISCELLANEOUS";
    let u = String(s).trim().toUpperCase().replace(/[.#$\[\]\/]/g, "");
    if (u === "GS" || u === "GENERALSTUDIES" || u === "GENERALAWARENESS") u = "GK";
    if (u === "MATHS" || u === "MATHEMATICS") u = "MATH"; // alias — save modal sends "MATHS"
    return SUBJECTS.includes(u) ? u : "MISCELLANEOUS";
}

let REATTEMPT_MODE = localStorage.getItem('mmh_saved_reattempt') === '1';
let activeSubjectFilter = "ALL";

if (!firebase.apps.length) { firebase.initializeApp(FIREBASE_PROJECTS.common); }
const savedDb = firebase.database();

// ------------------------------------------------------------
// Auth gate (unchanged behavior from before)
// ------------------------------------------------------------
async function loadSavedQuestionsWithAuth() {
    if (localStorage.getItem('mmh_theme') === 'dark') {
        document.body.classList.add('dark-mode');
    }
    if (typeof getLocalProfile !== 'function') {
        setTimeout(loadSavedQuestionsWithAuth, 100);
        return;
    }
    const profile = getLocalProfile();
    if (!profile || (profile.username === "User" && !profile.id)) {
        window.location.replace("/login.html");
        return;
    }
    USER_EMAIL_KEY = profile.username;

    // Restore toggle state in the UI (Reattempt only — Palette has no toggle
    // anymore, it's always available in Focus mode, same as the quiz template)
    const reattemptEl = document.getElementById('reattemptToggle');
    if (reattemptEl) reattemptEl.checked = REATTEMPT_MODE;

    loadSavedQuestions();
}
window.addEventListener('DOMContentLoaded', loadSavedQuestionsWithAuth);

// ------------------------------------------------------------
// Header back button — same pattern as the quiz template
// ------------------------------------------------------------
function goBack() {
    if (window.history.length > 1) window.history.back();
    else window.location.href = "/index.html";
}

// ------------------------------------------------------------
// Subject auto-detection for legacy (un-subjected) saved questions.
// Only ever called for items that don't already have a subject node —
// items already sitting under a subject bucket are never re-classified.
// ------------------------------------------------------------
function detectSubjectFromRules(quizId, qId) {
    const idL = (quizId || "").toLowerCase();
    const idx = parseInt(String(qId).slice(1), 10); // strip leading digit, same as image-URL logic

    // Single-subject exams named directly in the quiz ID (e.g. SSC-SUB-25-MATH)
    if (idL.includes("ssc-sub")) {
        if (idL.includes("math")) return "MATH";
        if (idL.includes("eng")) return "ENGLISH";
        if (idL.includes("reason")) return "REASONING";
        if (idL.includes("hindi")) return "HINDI";
        if (idL.includes("gk") || idL.includes("awareness") || idL.includes("gs")) return "GK";
        return "MISCELLANEOUS";
    }

    // Section-range based exams (position within the exam determines subject).
    // Index = strip the first digit from the left of the question ID, parse
    // the remainder (e.g. "50005" -> "0005" -> 5) — same convention already
    // used for the image-URL lookup and the "No:" display elsewhere.
    if (!isNaN(idx)) {
        if (idL.includes("cgl") || idL.includes("chsl") || idL.includes("cpo") || idL.includes("selection-post")) {
            if (idx >= 1 && idx <= 25) return "REASONING";
            if (idx >= 26 && idx <= 50) return "GK";
            if (idx >= 51 && idx <= 75) return "MATH";
            if (idx >= 76 && idx <= 100) return "ENGLISH";
        }
        if (idL.includes("gd")) {
            if (idx >= 1 && idx <= 20) return "REASONING";
            if (idx >= 21 && idx <= 40) return "GK";
            if (idx >= 41 && idx <= 60) return "MATH";
            if (idx >= 61 && idx <= 80) return "HINDI";
        }
        if (idL.includes("mts")) {
            if (idx >= 1 && idx <= 20) return "MATH";
            if (idx >= 21 && idx <= 40) return "REASONING";
            if (idx >= 41 && idx <= 65) return "GK";
            if (idx >= 66 && idx <= 90) return "ENGLISH";
        }
        if (idL.includes("steno")) {
            if (idx >= 1 && idx <= 50) return "REASONING";
            if (idx >= 51 && idx <= 100) return "GK";
            if (idx >= 101 && idx <= 200) return "ENGLISH";
        }
    }

    return "MISCELLANEOUS";
}

// ------------------------------------------------------------
// Flatten the raw Firebase tree. Two shapes possible under
// saved_questions/{user}/:
//   1) {subjectName}/{key} -> {quiz_id, question_data, saved_at}   (new, subject-nested)
//   2) {key} -> {quiz_id, question_data, saved_at}                 (legacy, no subject level)
// A node is "legacy" if it directly has a question_data field
// instead of being a bucket of further keys.
// ------------------------------------------------------------
function parseRawTree(raw) {
    const result = [];
    for (const topKey in raw) {
        const topVal = raw[topKey];
        if (!topVal || typeof topVal !== 'object') continue;

        if (topVal.question_data) {
            // Legacy leaf — no subject node yet
            const subject = normalizeSubject(detectSubjectFromRules(topVal.quiz_id, topVal.question_data.id));
            result.push({
                key: topKey,
                quiz_id: topVal.quiz_id,
                question_data: topVal.question_data,
                saved_at: topVal.saved_at || 0,
                subject,
                legacy: true
            });
        } else {
            // Subject bucket — topKey IS the actual Firebase key (may not match
            // canonical SUBJECTS spelling, e.g. "MATHS" instead of "MATH").
            // subject = normalized value, used for display/filtering.
            // rawSubject = the real key, used for building delete/move paths —
            // deleting/moving by the normalized value silently fails whenever
            // the two disagree, which is what caused items to "come back".
            const subjectName = normalizeSubject(topKey);
            for (const qKey in topVal) {
                const qVal = topVal[qKey];
                if (!qVal || !qVal.question_data) continue;
                result.push({
                    key: qKey,
                    quiz_id: qVal.quiz_id,
                    question_data: qVal.question_data,
                    saved_at: qVal.saved_at || 0,
                    subject: subjectName,
                    rawSubject: topKey,
                    legacy: false
                });
            }
        }
    }
    return result.sort((a, b) => b.saved_at - a.saved_at);
}

// One-time background migration: move legacy (un-subjected) questions
// into their auto-detected subject bucket. Runs silently after the
// page has already rendered — never blocks the UI.
async function migrateLegacyItems() {
    const legacyItems = QUESTION_LIST.filter(i => i.legacy);
    for (const item of legacyItems) {
        const payload = { quiz_id: item.quiz_id, question_data: item.question_data, saved_at: item.saved_at };
        const newPath = `saved_questions/${USER_EMAIL_KEY}/${item.subject}/${item.key}`;
        const oldPath = `saved_questions/${USER_EMAIL_KEY}/${item.key}`;
        try {
            await savedDb.ref(newPath).set(payload);
            await savedDb.ref(oldPath).remove();
            item.legacy = false; // now correctly filed under its subject node
        } catch (e) {
            // Leave as legacy — will retry on next page load
        }
    }
}

async function loadSavedQuestions() {
    const snap = await savedDb.ref(`saved_questions/${USER_EMAIL_KEY}`).once('value');
    SAVED_DATA_RAW = snap.val() || {};
    QUESTION_LIST = parseRawTree(SAVED_DATA_RAW);
    processData();
    migrateLegacyItems(); // fire-and-forget
}

function processData() {
    const loader = document.getElementById('loader');
    if (loader) loader.style.display = 'none';
    renderSubjectChips();
    applyFilters();
}

// ------------------------------------------------------------
// Subject filter chips (below header) — only shows subjects that
// actually have at least one saved question.
// ------------------------------------------------------------
function renderSubjectChips() {
    const present = new Set(QUESTION_LIST.map(i => i.subject));
    const order = ["ALL", ...SUBJECTS.filter(s => present.has(s))];
    const row = document.getElementById('subjectFilterRow');
    row.innerHTML = order.map(s =>
        `<button class="subject-chip ${activeSubjectFilter === s ? 'active' : ''}" onclick="setSubjectFilter('${s}')">${s}</button>`
    ).join('');
}

function setSubjectFilter(s) {
    activeSubjectFilter = s;
    renderSubjectChips();
    applyFilters();
}

function applyFilters() {
    let list = QUESTION_LIST;
    if (activeSubjectFilter !== 'ALL') list = list.filter(i => i.subject === activeSubjectFilter);
    FILTERED_LIST = list;

    const isFocus = document.getElementById('focusView').style.display === 'block';
    if (isFocus) {
        if (currentFocusIdx >= FILTERED_LIST.length) currentFocusIdx = Math.max(0, FILTERED_LIST.length - 1);
        renderFocusMode();
    } else {
        renderListView();
    }
}

// ------------------------------------------------------------
// Shared helpers (language, bold-highlight, image URLs) — unchanged logic
// ------------------------------------------------------------
const applyBoldHighlight = (html) => html ? html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') : "";

const getLangText = (obj) => {
    if (!obj) return "";
    const decodeHTML = (h) => { const t = document.createElement("textarea"); t.innerHTML = h; return t.value; };
    let raw = (typeof obj === "string") ? obj : (currentLang === "bilingual") ?
        ((obj.en || "") + (obj.en && obj.hi ? "<hr style='border:none; border-top:1px dashed #ccc; margin:10px 0;'>" : "") + (obj.hi || "")) :
        (obj[currentLang] || obj["en"] || "");
    return decodeHTML(raw);
};

function getDynamicUrl(quizId, qId, imgNum) {
    let cleanQuizId = quizId;
    const lowerQuizId = quizId.toLowerCase();

    const suffixes = [
        "-mathandreasoning", "-englishandgk", "-generalawareness",
        "-maths", "-reasoning", "-english", "-gk", "-math",
        "-section1", "-section2", "-section3"
    ];

    for (const s of suffixes) {
        if (lowerQuizId.endsWith(s)) {
            cleanQuizId = quizId.substring(0, quizId.length - s.length);
            break;
        }
    }

    cleanQuizId = cleanQuizId.replace(/-part-\d+$/i, "");

    const idL = lowerQuizId;
    let path = "misc";

    if (idL.includes("cgl")) path = "ssc/cgl";
    else if (idL.includes("chsl")) path = "ssc/chsl";
    else if (idL.includes("cpo")) path = "ssc/cpo";
    else if (idL.includes("mts")) path = "ssc/mts";
    else if (idL.includes("steno")) path = "ssc/steno";
    else if (idL.includes("ntpcg")) path = "rrb/ntpcg";
    else if (idL.includes("imps")) path = "imps";
    else if (idL.includes("selection-post")) path = "ssc/phase";
    else if (idL.includes("gd")) path = "ssc/gd";
    else if (idL.includes("ssc-sub-25")) path = "ssc-sub/2025";

    const cleanIdx = parseInt(String(qId).slice(1));

    return `https://raw.githubusercontent.com/mockmatrixhub/mmhimg/main/${path}/${cleanQuizId}/q-${cleanIdx}-image${imgNum}.jpg`;
}

function renderImg(url, quizId, qId, num, isOpt = false) {
    const dyn = getDynamicUrl(quizId, qId, num);
    const cls = isOpt ? "opt-img" : "q-img";
    if (url && url.trim() !== "") return `<img src="${url}" class="${cls}" onerror="this.style.display='none'">`;
    return `<img src="${dyn}" class="${cls}" style="display:none;" onload="this.style.display='block'" onerror="this.style.display='none'">`;
}

// ------------------------------------------------------------
// Options rendering — supports Reattempt Mode (hide answer until tapped).
// Text div comes FIRST, radio-circle div SECOND — matches the CSS grid
// (1fr 44px) that puts the circle on the right side of the row.
// ------------------------------------------------------------
function renderOptions(item) {
    const q = item.question_data;
    let html = "";
    for (let i = 1; i <= 5; i++) {
        if (!q[`option_${i}`]) continue;
        const isCor = String(q.answer) === String(i);
        const correctAttr = isCor ? 'data-correct="1"' : '';
        const showCorrectNow = isCor && !REATTEMPT_MODE;
        const clickAttr = REATTEMPT_MODE ? `onclick="mmhSelectOption(event, ${isCor})"` : '';
        html += `
            <div class="opt ${showCorrectNow ? 'correct' : ''}" ${correctAttr} ${clickAttr}>
                <div class="custom-radio"></div>
                <div class="opt-text">${applyBoldHighlight(getLangText(q[`option_${i}`]))}${renderImg(q[`option_image_${i}`], item.quiz_id, q.id, i + 1, true)}</div>
            </div>`;
    }
    return html;
}

function mmhSelectOption(ev, isCorrect) {
    const optDiv = ev.currentTarget;
    const card = optDiv.closest('.q-card');
    if (!card || card.dataset.answered === '1') return;
    card.dataset.answered = '1';

    card.querySelectorAll('.opt').forEach(o => {
        if (o.getAttribute('data-correct') === '1') o.classList.add('correct');
    });
    if (!isCorrect) optDiv.classList.add('wrong-pick');

    const exp = card.querySelector('.explanation');
    if (exp) { exp.style.display = 'block'; renderMath(exp); }
    const hint = card.querySelector('.reattempt-hint');
    if (hint) hint.style.display = 'none';
}

// ------------------------------------------------------------
// Card header (q-bar): quiz id + qno on row 1, Move-to select + Remove on row 2
// (stacks to 2 rows automatically on small screens via CSS). Move-to is a
// native <select> — same style/behavior as the language selector — instead
// of a button that opened a separate modal.
// ------------------------------------------------------------
function buildQBar(item, indexLabel) {
    const q = item.question_data;
    const qNoDisplay = String(q.id).slice(1).replace(/^0+/, '');
    const moveOptions = SUBJECTS.map(s =>
        `<option value="${s}" ${s === item.subject ? 'selected' : ''}>${s}</option>`
    ).join('');
    return `
        <div class="q-bar">
            <div class="q-bar-row1">
                <span class="q-bar-quiz"><i class="fas fa-book"></i> ${item.quiz_id}</span>
                <span class="q-bar-no">${indexLabel || ('No: ' + qNoDisplay)}</span>
            </div>
            <div class="q-bar-row2">
                <div class="q-bar-actions">
                    <select class="move-select" onchange="moveToSection('${item.key}', this.value)">${moveOptions}</select>
                    <button class="q-bar-btn remove" onclick="confirmUnsave('${item.key}')"><i class="fas fa-trash"></i> Remove</button>
                </div>
            </div>
        </div>`;
}

function buildQuestionCardHTML(item, indexLabel) {
    const q = item.question_data;
    return `
        ${buildQBar(item, indexLabel)}
        <div class="qtext">${applyBoldHighlight(getLangText(q.question).replace(/(\s|<br\s*\/?>)+$/gi, ''))}${renderImg(q.question_image, item.quiz_id, q.id, 1)}</div>
        <div class="options-engine">${renderOptions(item)}</div>
        <div class="explanation" style="${REATTEMPT_MODE ? 'display:none;' : ''}"><strong>SOLUTION:</strong><br><div class="sol-text">${applyBoldHighlight(getLangText(q.solution_text))}</div>${renderImg(q.solution_image, item.quiz_id, q.id, 6)}</div>
        ${REATTEMPT_MODE ? '<div class="reattempt-hint">Tap an option to check the answer</div>' : ''}
    `;
}

// ------------------------------------------------------------
// List Mode — full question loads directly, no preview/collapse
// ------------------------------------------------------------
function renderListView() {
    const list = FILTERED_LIST;
    const container = document.getElementById('listView');
    container.innerHTML = "";
    document.getElementById('emptyState').style.display = list.length === 0 ? 'block' : 'none';

    list.forEach((item) => {
        const card = document.createElement('div');
        card.className = 'q-card';
        card.dataset.key = item.key;
        card.innerHTML = buildQuestionCardHTML(item);
        container.appendChild(card);
        observer.observe(card);
        normalizeMathForQuiz(card);
    });
}

function renderMath(target) {
    if (window.MathJax && MathJax.typesetPromise) {
        MathJax.typesetClear([target]);
        MathJax.typesetPromise([target]).catch(() => {});
    }
}

// Shared string-level transform — used both on the live container's innerHTML
// and on the PDF body string before it's ever written into the print doc.
// Folds $$...$$ display-math delimiters down to inline \( ... \) so MathJax
// never renders a centered block (which is what caused the extra gaps).
function normalizeMathString(html) {
    return html
        .replace(/(\S)\s*\$\$(.+?)\$\$\s*(\S)/g, '$1 \\($2\\) $3')
        .replace(/\$\$(.+?)\$\$/g, '\\($1\\)');
}

function normalizeMathForQuiz(container) {
    if (!container) return;
    container.innerHTML = normalizeMathString(container.innerHTML);
}

const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            renderMath(entry.target);
            observer.unobserve(entry.target);
        }
    });
});

// ------------------------------------------------------------
// Focus Mode — one question at a time, with the Palette navigator.
// Palette has no on/off toggle anymore — it's always available whenever
// Focus mode is active, same as the live quiz template: a green FAB that
// opens a right-side slide-in panel on mobile, and an always-visible
// right sidebar on desktop.
// ------------------------------------------------------------
function switchMode(m) {
    document.getElementById('listModeBtn').classList.toggle('active', m === 'list');
    document.getElementById('focusModeBtn').classList.toggle('active', m === 'focus');
    document.getElementById('listView').style.display = m === 'list' ? 'block' : 'none';
    document.getElementById('focusView').style.display = m === 'focus' ? 'block' : 'none';
    document.getElementById('focusNav').style.display = m === 'focus' ? 'flex' : 'none';
    updatePaletteVisibility();
    if (m === 'focus') {
        currentFocusIdx = 0;
        renderFocusMode();
    }
}

function updatePaletteVisibility() {
    const isFocus = document.getElementById('focusView').style.display === 'block';
    const wrap = document.getElementById('paletteWrap');
    const fab = document.getElementById('paletteFab');
    const backdrop = document.getElementById('paletteBackdrop');
    wrap.classList.toggle('enabled', isFocus);
    fab.classList.toggle('enabled', isFocus);
    if (!isFocus) {
        wrap.classList.remove('open');
        if (backdrop) backdrop.classList.remove('open');
    }
}

function togglePaletteSheet() {
    const open = document.getElementById('paletteWrap').classList.toggle('open');
    const backdrop = document.getElementById('paletteBackdrop');
    if (backdrop) backdrop.classList.toggle('open', open);
}

function closePaletteSheet() {
    document.getElementById('paletteWrap').classList.remove('open');
    const backdrop = document.getElementById('paletteBackdrop');
    if (backdrop) backdrop.classList.remove('open');
}

function renderFocusMode() {
    const list = FILTERED_LIST;
    const focusContent = document.getElementById('focusContent');
    if (list.length === 0) {
        focusContent.innerHTML = "";
        document.getElementById('paletteGrid').innerHTML = "";
        return;
    }
    if (currentFocusIdx >= list.length) currentFocusIdx = list.length - 1;
    const item = list[currentFocusIdx];

    const card = document.createElement('div');
    card.className = 'q-card';
    card.dataset.key = item.key;
    card.innerHTML = buildQuestionCardHTML(item, `${currentFocusIdx + 1} of ${list.length}`);
    focusContent.innerHTML = "";
    focusContent.appendChild(card);

    normalizeMathForQuiz(focusContent);
    renderMath(focusContent);

    // Palette only ever shows the CURRENTLY FILTERED subject's questions —
    // it reads from the same FILTERED_LIST the card itself came from.
    document.getElementById('paletteGrid').innerHTML = list.map((it, idx) =>
        `<button class="palette-btn ${idx === currentFocusIdx ? 'current' : ''}" onclick="jumpFocus(${idx})">${idx + 1}</button>`
    ).join('');
}

function jumpFocus(idx) {
    currentFocusIdx = idx;
    renderFocusMode();
    closePaletteSheet();
}

function navFocus(d) {
    const list = FILTERED_LIST;
    if (list.length === 0) return;
    currentFocusIdx = (currentFocusIdx + d + list.length) % list.length;
    renderFocusMode();
}

// ------------------------------------------------------------
// Reattempt Mode toggle
// ------------------------------------------------------------
function onReattemptToggle(checked) {
    REATTEMPT_MODE = checked;
    localStorage.setItem('mmh_saved_reattempt', checked ? '1' : '0');
    applyFilters(); // re-render current view under the new mode
}

// ------------------------------------------------------------
// Move to Section — now a direct inline <select> on each card, no modal
// ------------------------------------------------------------
async function moveToSection(key, newSubject) {
    newSubject = normalizeSubject(newSubject);
    const item = QUESTION_LIST.find(i => i.key === key);
    if (!item) return;
    if (item.subject === newSubject) return;

    const payload = { quiz_id: item.quiz_id, question_data: item.question_data, saved_at: item.saved_at };
    const oldPath = item.legacy
        ? `saved_questions/${USER_EMAIL_KEY}/${key}`
        : `saved_questions/${USER_EMAIL_KEY}/${item.rawSubject}/${key}`;
    const newPath = `saved_questions/${USER_EMAIL_KEY}/${newSubject}/${key}`;

    try {
        await savedDb.ref(newPath).set(payload);
        await savedDb.ref(oldPath).remove();
        item.subject = newSubject;
        item.rawSubject = newSubject; // now correctly filed under the canonical key
        item.legacy = false;
        showToast(`Moved to ${newSubject}`);
        renderSubjectChips();
        applyFilters();
    } catch (e) {
        alert("Move failed. Check internet connection.");
    }
}

// ------------------------------------------------------------
// Remove from saved
// ------------------------------------------------------------
async function confirmUnsave(key) {
    const item = QUESTION_LIST.find(i => i.key === key);
    if (!item) return;
    if (!confirm("Remove this question from your saved library?")) return;

    try {
        const refPath = item.legacy
            ? `saved_questions/${USER_EMAIL_KEY}/${key}`
            : `saved_questions/${USER_EMAIL_KEY}/${item.rawSubject}/${key}`;
        await savedDb.ref(refPath).remove();

        QUESTION_LIST = QUESTION_LIST.filter(i => i.key !== key);
        showToast("Unsaved Successfully");

        renderSubjectChips();
        applyFilters();
    } catch (err) {
        alert("Action failed. Check internet connection.");
    }
}

function showToast(msg) {
    const toast = document.createElement("div");
    toast.className = "save-toast";
    toast.innerText = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2000);
}

function changeGlobalLang(val) {
    currentLang = val;
    localStorage.setItem("quiz_lang", val);
    applyFilters();
}

// ============================================================
// Save as PDF (Windows Print) — reuses renderImg/getLangText/
// applyBoldHighlight exactly as the live page does, so images and
// math render identically to what the user already sees on-screen.
// ============================================================
let pdfSelectedSubjects = new Set(["ALL"]);

function openPdfModal() {
    if (QUESTION_LIST.length === 0) { showToast("No saved questions to export"); return; }
    pdfSelectedSubjects = new Set(["ALL"]);
    renderPdfSubjectList();
    document.getElementById('pdfModal').classList.add('open');
    document.getElementById('pdfModalBackdrop').classList.add('open');
}

function closePdfModal() {
    document.getElementById('pdfModal').classList.remove('open');
    document.getElementById('pdfModalBackdrop').classList.remove('open');
}

function renderPdfSubjectList() {
    const present = SUBJECTS.filter(s => QUESTION_LIST.some(i => i.subject === s));
    const order = ["ALL", ...present];
    const wrap = document.getElementById('pdfSubjectList');
    wrap.innerHTML = order.map(s => {
        const checked = pdfSelectedSubjects.has(s);
        return `<label class="pdf-subject-chk ${checked ? 'checked' : ''}">
            <input type="checkbox" value="${s}" ${checked ? 'checked' : ''} onchange="onPdfSubjectToggle('${s}', this.checked)">
            ${s === 'ALL' ? 'All Subjects' : s}
        </label>`;
    }).join('');
}

// ALL is mutually exclusive with individual subjects. Set can never end
// up empty — unchecking the last thing always falls back to ALL.
function onPdfSubjectToggle(subj, isChecked) {
    if (subj === 'ALL') {
        pdfSelectedSubjects = isChecked ? new Set(["ALL"]) : new Set();
    } else {
        pdfSelectedSubjects.delete('ALL');
        if (isChecked) pdfSelectedSubjects.add(subj);
        else pdfSelectedSubjects.delete(subj);
    }
    if (pdfSelectedSubjects.size === 0) pdfSelectedSubjects.add('ALL');
    renderPdfSubjectList();
}

function getPdfSelectedItems() {
    if (pdfSelectedSubjects.has('ALL')) return QUESTION_LIST.slice();
    return QUESTION_LIST.filter(i => pdfSelectedSubjects.has(i.subject));
}

// markCorrect=false (Without-Solution mode) prints plain options with no
// highlight — the correct one is stated separately via "Answer: (x)".
function renderPdfOptions(item, markCorrect) {
    const q = item.question_data;
    const letters = ['A', 'B', 'C', 'D', 'E'];
    let html = "";
    for (let i = 1; i <= 5; i++) {
        if (!q[`option_${i}`]) continue;
        const isCor = markCorrect && String(q.answer) === String(i);
        html += `
            <div class="pdf-opt ${isCor ? 'pdf-correct' : ''}">
                <span class="pdf-opt-label">(${letters[i - 1]})</span>
                <span class="pdf-opt-text">${applyBoldHighlight(getLangText(q[`option_${i}`]))}${renderImg(q[`option_image_${i}`], item.quiz_id, q.id, i + 1, true)}</span>
            </div>`;
    }
    return html;
}

// withSolution=true  -> shows SOLUTION block (if present) AND the Answer line
// withSolution=false -> shows plain options only, plus the Answer line
// The Answer line is now ALWAYS printed, regardless of mode.
function buildPdfQuestionHTML(item, no, withSolution) {
    const q = item.question_data;
    const qtext = applyBoldHighlight(getLangText(q.question).replace(/(\s|<br\s*\/?>)+$/gi, ''));
    let html = `<div class="pdf-q">
        <div class="pdf-qtext"><span class="pdf-qno">Q${no}.</span> ${qtext}${renderImg(q.question_image, item.quiz_id, q.id, 1)}</div>
        <div class="pdf-options">${renderPdfOptions(item, withSolution)}</div>`;

    if (withSolution) {
        const solText = getLangText(q.solution_text);
        if (solText && solText.trim() !== "") {
            html += `<div class="pdf-explanation"><strong>SOLUTION:</strong><br>${applyBoldHighlight(solText)}${renderImg(q.solution_image, item.quiz_id, q.id, 6)}</div>`;
        }
    }

    // Answer line — always shown now, in both With-Solution and Only-Answers modes
    const letters = ['a', 'b', 'c', 'd', 'e'];
    const letter = letters[parseInt(q.answer, 10) - 1] || q.answer;
    html += `<div class="pdf-answer-only"><strong>Answer:</strong> (${letter})</div>`;

    html += `</div>`;
    return html;
}

function buildPdfDocumentBody(items, withSolution) {
    let body = "";
    const subjectsInOrder = SUBJECTS.filter(s => items.some(i => i.subject === s));
    subjectsInOrder.forEach(subj => {
        const subjItems = items.filter(i => i.subject === subj);
        body += `<h2 class="pdf-subject-heading">${subj}</h2>`;
        subjItems.forEach((item, idx) => { body += buildPdfQuestionHTML(item, idx + 1, withSolution); });
    });
    return body;
}

// Builds one small tiled SVG (as a data URI) containing the diagonal text repeats
// plus the logo, and used as a normal `background-image` on the page container.
// This avoids `position: fixed` + opacity/transform overlays, which is what was
// forcing Chrome's print pipeline to rasterize whole pages into large images.
async function buildWatermarkBackground() {
    let logoTag = '';
    try {
        const resp = await fetch('/logo.png');
        if (resp.ok) {
            const blob = await resp.blob();
            const base64 = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
            logoTag = `<image href="${base64}" x="125" y="125" width="90" height="90" opacity="0.10"/>`;
        }
    } catch (e) {
        // Logo not reachable — the text watermark alone still covers the requirement
    }

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="340" height="340">
      <g transform="rotate(-30 170 170)" font-family="Arial, sans-serif" font-weight="800" font-size="19" fill="#2563eb" fill-opacity="0.09">
        <text x="0" y="70">MOCK MATRIX HUB</text>
        <text x="0" y="270">MOCK MATRIX HUB</text>
      </g>
      ${logoTag}
    </svg>`;
    return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
}

async function generatePdf() {
    const items = getPdfSelectedItems();
    if (items.length === 0) { showToast("No questions in the selected subject"); return; }
    const withSolution = document.querySelector('input[name="pdfSolMode"]:checked').value === 'with';

    // Open the tab synchronously, inside the click gesture — pop-up blockers require
    // this. The logo fetch below is async, so we write to this handle once it's ready.
    const pdfWin = window.open('', '_blank');
    if (!pdfWin) { alert("Please allow pop-ups to generate the PDF."); return; }
    pdfWin.document.write('<p style="font-family:sans-serif;padding:40px;color:#666;">Preparing your PDF…</p>');

    const watermarkBg = await buildWatermarkBackground();
    // Fold $$...$$ down to inline \( ... \) BEFORE the string is ever written into
    // the print document — this is what stops MathJax from rendering the block
    // (centered, extra-margin) form that was causing the visible gaps.
    const bodyHTML = normalizeMathString(buildPdfDocumentBody(items, withSolution));
    const dateStr = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

    const doc = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=1024">
<title>Mock Matrix Hub - Saved Questions</title>
<script>
window.MathJax = {
  tex: { inlineMath: [['\\\\(', '\\\\)']], displayMath: [['$$', '$$'], ['\\\\[', '\\\\]']], processEscapes: true },
  chtml: { mtextInheritFont: true, displayAlign: 'left', linebreaks: { allow: true, width: 'container', overflow: 'linebreak' } },
  options: { skipHtmlTags: ['script', 'style', 'textarea', 'pre'] },
  startup: {
    ready: () => {
      MathJax.startup.defaultReady();
      MathJax.startup.promise.then(() => { window.__mmhMathDone = true; window.__mmhTryPrint && window.__mmhTryPrint(); });
    }
  }
};
<\/script>
<script src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js" defer><\/script>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #111; margin: 0; background: #e5e7eb; }
  .pdf-page-wrap {
    max-width: 900px; margin: 12px auto; background-color: #fff; padding: 14px 16px;
    background-image: url('${watermarkBg}'); background-repeat: repeat;
  }
  .pdf-header { display: flex; align-items: center; justify-content: space-between; border-bottom: 2px solid #2563eb; padding-bottom: 5px; margin-bottom: 8px; }
  .pdf-header-title { font-size: 15px; font-weight: 800; color: #111; }
  .pdf-header-title span { color: #2563eb; }
  .pdf-header-date { font-size: 10px; color: #666; font-weight: 600; }

  /* Two-column layout with a vertical divider between columns, like a printed answer sheet */
  .pdf-columns { column-count: 2; column-gap: 16px; column-rule: 1px solid #d0d0d0; column-fill: auto; }

  .pdf-subject-heading {
    column-span: all; font-size: 12px; font-weight: 800; color: #fff; background: #2563eb;
    padding: 3px 9px; border-radius: 3px; margin: 8px 0 6px;
  }
  .pdf-subject-heading:first-of-type { margin-top: 0; }

  /* Content is allowed to flow across columns/pages — no forced avoid, no big empty gaps.
     Opaque white background + z-index so the tiled watermark behind the page wrap
     stays hidden underneath question text/images instead of showing through them. */
  .pdf-q { margin-bottom: 6px; padding-bottom: 6px; border-bottom: 1px dashed #ddd; background: #fff; position: relative; z-index: 1; }
  .pdf-qtext { font-size: 11px; line-height: 1.32; font-weight: 600; margin-bottom: 3px; }
  .pdf-qno { color: #2563eb; font-weight: 800; }
  .pdf-options { margin: 2px 0 3px 1px; }
  /* A single option row is kept intact — this is a tiny block, so it never causes a visible gap */
  .pdf-opt { display: flex; gap: 5px; font-size: 10.5px; line-height: 1.28; padding: 1.5px 3px; break-inside: avoid; border-radius: 3px; }
  .pdf-opt-label { font-weight: 700; flex-shrink: 0; }
  /* Correct option: same light-green background the live page uses — no colored text, no box/quote look */
  .pdf-opt.pdf-correct { background: #dcfce7; }
  /* Plain running text, same size/weight family as the question — not a quoted/boxed callout */
  .pdf-explanation { margin-top: 3px; font-size: 11px; line-height: 1.32; }
  .pdf-answer-only { font-size: 11px; font-weight: 700; margin-top: 2px; }
  .pdf-q img { max-width: 150px; max-height: 130px; display: block; margin: 3px 0; object-fit: contain; background: #fff; }

  /* Same MathJax wrap rules as the live page — equations stay inside the (narrower) column, never overflow */
  mjx-container { max-width: 100% !important; overflow: visible !important; }
  mjx-container, mjx-math, mjx-mtext { word-break: normal !important; overflow-wrap: normal !important; }
  mjx-container[display="true"] { display: block !important; max-width: 100% !important; }
  mjx-math { white-space: normal !important; }
  .pdf-qtext, .pdf-opt-text, .pdf-explanation { overflow-wrap: break-word !important; word-break: normal !important; }

  @media print {
    @page { size: A4; margin: 9mm 8mm; }
    body { background: #fff; }
    .pdf-page-wrap { max-width: none; margin: 0; padding: 0; }
  }
</style>
</head>
<body>
  <div class="pdf-page-wrap">
    <div class="pdf-header">
      <div class="pdf-header-title">Mock Matrix Hub <span>| Saved Questions</span></div>
      <div class="pdf-header-date">${dateStr}</div>
    </div>
    <div class="pdf-columns">
      ${bodyHTML}
    </div>
  </div>
  <script>
    window.__mmhMathDone = false;
    window.__mmhImgsDone = false;
    window.__mmhPrinted = false;
    window.__mmhTryPrint = function() {
      if (window.__mmhMathDone && window.__mmhImgsDone && !window.__mmhPrinted) {
        window.__mmhPrinted = true;
        setTimeout(() => {
            if (window.mmhToast && window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) {
                window.mmhToast('Print layouts open in a browser — use Share from the page instead');
            } else { window.print(); }
        }, 200);
      }
    };
    window.addEventListener('load', function() {
      const imgs = Array.from(document.images);
      let remaining = imgs.length;
      if (remaining === 0) window.__mmhImgsDone = true;
      imgs.forEach(img => {
        if (img.complete) { remaining--; if (remaining <= 0) { window.__mmhImgsDone = true; window.__mmhTryPrint(); } }
        else {
          img.addEventListener('load', () => { remaining--; if (remaining <= 0) { window.__mmhImgsDone = true; window.__mmhTryPrint(); } });
          img.addEventListener('error', () => { remaining--; if (remaining <= 0) { window.__mmhImgsDone = true; window.__mmhTryPrint(); } });
        }
      });
      setTimeout(() => { window.__mmhMathDone = true; window.__mmhImgsDone = true; window.__mmhTryPrint(); }, 6000);
      window.__mmhTryPrint();
    });
  <\/script>
</body>
</html>`;

    pdfWin.document.open();
    pdfWin.document.write(doc);
    pdfWin.document.close();
    closePdfModal();
}

