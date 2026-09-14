/* ── Adaptive appbar — verbatim port of the MMH home page shrink method
   (home-engine.js: APPBAR_FIT_LEVELS + fitAppbar + listeners). The header
   BOX never changes size; inner items step down .appbar-fit-1…5 until the
   COMPLETE brand text fits; .appbar-wrap is the absolute last resort. ══ */
// ── Adaptive appbar ─────────────────────────────────────────────────────────
// The header carries a lot (menu, brand, theme, bell, auth chip). On tight
// widths the brand name / tagline must NEVER show an ellipsis — fitAppbar()
// walks a shrink ladder (smaller font AND lighter weight, .appbar-fit-1…5)
// until the COMPLETE text fits, shrinking the header icons alongside
// (.appbar-compact). Roomy screens: nothing applied, header as designed.
const APPBAR_FIT_LEVELS = 5;
function fitAppbar() {
    const bar = document.querySelector('.appbar');
    const title = bar && bar.querySelector('.brand-title');
    const sub = bar && bar.querySelector('.brand-sub');
    if (!bar || !title) return;
    bar.classList.remove('appbar-compact', 'appbar-wrap');
    for (let i = 1; i <= APPBAR_FIT_LEVELS; i++) bar.classList.remove('appbar-fit-' + i);

    const stripped = () =>
        title.scrollWidth > title.clientWidth + 1 ||
        !!(sub && sub.scrollWidth > sub.clientWidth + 1);

    let lvl = 0;
    while (stripped() && lvl < APPBAR_FIT_LEVELS) {
        lvl++;
        bar.classList.add('appbar-fit-' + lvl);   // font size + weight step down
        bar.classList.add('appbar-compact');      // icons shrink too → more room
    }
    if (stripped()) bar.classList.add('appbar-wrap');   // last resort: wrap, never "…"
}
window.fitAppbar = fitAppbar;

let _appbarFitT = null;
window.addEventListener('resize', () => {
    clearTimeout(_appbarFitT);
    _appbarFitT = setTimeout(fitAppbar, 150);
});
window.addEventListener('load', fitAppbar);

document.addEventListener('DOMContentLoaded', () => {
    fitAppbar();
    setTimeout(fitAppbar, 500);      // after badges / chips settle
});
