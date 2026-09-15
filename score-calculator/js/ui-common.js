/* ═══════════════════════════════════════════════════
   MOCK MATRIX HUB · SCORE CALCULATOR — ui-common.js  (RSMUI)
   Shared interactive behaviour used by both ssc-calculator.html
   and rrb-calculator.html:

     • enterResultMode / exitResultMode — swap the input form for
       a compact "Edit URL" bar once a result is showing, and back.
     • initRecentChips — up to 3 "recently checked" chips shown
       when the URL field is focused; tapping one instantly loads
       that cached result.
     • attachResultActions — wires the result card's action
       buttons (New URL / Share / Image / PDF / Review Paper /
       Attempt as Mock).
     • captureCardImage / handleShare / handleImage — high quality
       PNG export of the result card via html2canvas (loaded lazily
       from CDN only when first needed).
═══════════════════════════════════════════════════ */

const RSMUI = (() => {

  // ── Toast ──
  function toast(msg) {
    let el = document.getElementById('rsmToast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'rsmToast';
      el.className = 'rsm-toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('rsm-toast--show');
    clearTimeout(el._rsmTimer);
    el._rsmTimer = setTimeout(() => el.classList.remove('rsm-toast--show'), 2200);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function shortenUrl(url) {
    if (!url) return '';
    return url.length > 46 ? url.slice(0, 28) + '…' + url.slice(-14) : url;
  }

  // ── Result-mode transitions ──
  // ctx = { inputCard, editBar, editBarText, resultsSection, urlInput, chipsContainer }
  function enterResultMode(ctx, url) {
    if (!ctx) return;
    if (ctx.inputCard) ctx.inputCard.classList.add('hidden');
    if (ctx.chipsContainer) ctx.chipsContainer.classList.add('hidden');
    if (ctx.editBar) {
      ctx.editBar.classList.remove('hidden');
      if (ctx.editBarText) ctx.editBarText.textContent = shortenUrl(url);
    }
  }

  // opts.clearUrl: true for "New URL" (empties the field so the user
  // types a fresh one); left false/undefined for "Edit URL" (keeps the
  // current URL in the field so the user can tweak it in place).
  function exitResultMode(ctx, opts = {}) {
    if (!ctx) return;
    if (ctx.resultsSection) {
      ctx.resultsSection.classList.add('hidden');
      ctx.resultsSection.innerHTML = '';
    }
    if (ctx.editBar) ctx.editBar.classList.add('hidden');
    if (ctx.inputCard) {
      ctx.inputCard.classList.remove('hidden');
      ctx.inputCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    if (opts.clearUrl && ctx.urlInput) {
      ctx.urlInput.value = '';
      ctx.urlInput.focus();
    }
  }

  function initEditBar(ctx) {
    if (!ctx || !ctx.editBar) return;
    const editBtn = ctx.editBar.querySelector('[data-action="edit-url"]');
    if (editBtn) editBtn.addEventListener('click', () => exitResultMode(ctx));
  }

  // ── Recent-cache chips ──
  // onPick(url) is called after the field is filled — the caller should
  // trigger its normal fetch flow, which will hit the cache instantly.
  function initRecentChips(ctx, onPick, family = null) {
    const { urlInput, chipsContainer } = ctx || {};
    if (!urlInput || !chipsContainer || typeof RSMCache === 'undefined') return;

    function render() {
      const items = RSMCache.recent(3, family);
      if (!items.length) {
        chipsContainer.innerHTML = '';
        chipsContainer.classList.add('hidden');
        return;
      }
      chipsContainer.innerHTML = `
        <div class="recent-chips__label">Recently checked</div>
        <div class="recent-chips__row">
          ${items.map((it, i) => {
            const label = (it.candidateInfo && (it.candidateInfo.name || it.candidateInfo.rollNo)) || `Result ${i + 1}`;
            const score = (it.totalScore != null && it.maxScore != null) ? `${it.totalScore}/${it.maxScore}` : '';
            return `
              <button type="button" class="recent-chip" data-idx="${i}">
                <span class="recent-chip__name">${escapeHtml(label)}</span>
                ${score ? `<span class="recent-chip__score">${escapeHtml(score)}</span>` : ''}
              </button>`;
          }).join('')}
        </div>`;
      chipsContainer.classList.remove('hidden');

      chipsContainer.querySelectorAll('.recent-chip').forEach(btn => {
        // Prevent input blur from hiding the chip before the click registers.
        btn.addEventListener('mousedown', e => e.preventDefault());
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.getAttribute('data-idx'), 10);
          const item = items[idx];
          if (!item) return;
          urlInput.value = item.url;
          chipsContainer.classList.add('hidden');
          if (typeof onPick === 'function') onPick(item.url, item);
        });
      });
    }

    urlInput.addEventListener('focus', render);
    urlInput.addEventListener('input', () => {
      if (!urlInput.value.trim()) render();
      else chipsContainer.classList.add('hidden');
    });
    document.addEventListener('click', e => {
      if (e.target !== urlInput && !chipsContainer.contains(e.target)) {
        chipsContainer.classList.add('hidden');
      }
    });
  }

  // ── Required-field validation (red border + single toast) ──
  // Accepts an array of form elements (input/select/checkbox). Marks each
  // empty one with a `.field-error` class (checkboxes get the class on
  // their wrapping `.checkbox-wrap` instead, since the native checkbox
  // box can't show a border reliably across platforms), scrolls/focuses
  // the first invalid field, and returns true only if everything is filled.
  function fieldIsEmpty(el) {
    if (!el) return false;
    if (el.type === 'checkbox') return !el.checked;
    return !String(el.value || '').trim();
  }

  function errorTarget(el) {
    if (el.type === 'checkbox') return el.closest('.checkbox-wrap') || el;
    return el;
  }

  function markFieldError(el) {
    if (!el) return;
    errorTarget(el).classList.add('field-error');
  }

  function clearFieldError(el) {
    if (!el) return;
    errorTarget(el).classList.remove('field-error');
  }

  function validateFields(fieldEls) {
    let firstInvalid = null;
    (fieldEls || []).forEach(el => {
      if (!el) return;
      if (fieldIsEmpty(el)) {
        markFieldError(el);
        if (!firstInvalid) firstInvalid = el;
      } else {
        clearFieldError(el);
      }
    });
    if (firstInvalid) {
      firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
      try { firstInvalid.focus({ preventScroll: true }); } catch (e) { firstInvalid.focus(); }
    }
    return !firstInvalid;
  }

  // Clears the red state on a field as soon as the user fixes it, so
  // errors don't linger after the person has actually filled the field.
  function initFieldErrorClearing(fieldEls) {
    (fieldEls || []).forEach(el => {
      if (!el) return;
      const evt = (el.tagName === 'SELECT' || el.type === 'checkbox') ? 'change' : 'input';
      el.addEventListener(evt, () => { if (!fieldIsEmpty(el)) clearFieldError(el); });
    });
  }

  // ── Capacitor native-platform detection ──
  function isNativeApp() {
    try {
      return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
    } catch (e) { return false; }
  }

  function nativePlugin(name) {
    try { return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins[name]) || null; }
    catch (e) { return null; }
  }

  // ── html-to-image (Modern lazy-loaded replacement for html2canvas) ──
  let htmlToImagePromise = null;
  function ensureHtmlToImage() {
    if (window.htmlToImage) return Promise.resolve(window.htmlToImage);
    if (htmlToImagePromise) return htmlToImagePromise;
    htmlToImagePromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html-to-image/1.11.11/html-to-image.min.js';
      s.onload = () => resolve(window.htmlToImage);
      s.onerror = () => reject(new Error('html-to-image load failed'));
      document.head.appendChild(s);
    });
    return htmlToImagePromise;
  }
   

  // Draws a "MOCK MATRIX HUB" watermark onto a captured canvas: a
  // diagonal repeating tile across the whole card (light, unobtrusive)
  // plus one solid brand line pinned to the bottom edge — the exported
  // image should be identifiable as coming from the app even if it's
  // forwarded around outside it.
  
  // ── Clean, high-resolution scorecard export ──────────────────────────────
  // Instead of screenshotting the live mobile DOM (fragile, cramped, and
  // dependent on whatever styles the app page happened to have), we build a
  // DEDICATED, cleanly designed export card from the same data, render it
  // offscreen, rasterize it at 3x for crisp text, then discard it. The live
  // result card is never touched or restyled.
  const EXPORT_W = 1080;

  function exportColors(isDark) {
    return {
      bg: isDark ? '#101a2e' : '#ffffff',
      ink: isDark ? '#eaf0fb' : '#0b1220',
      muted: isDark ? '#94a3b8' : '#5b6472',
      rule: isDark ? 'rgba(148,163,184,.20)' : 'rgba(11,18,32,.10)',
      soft: isDark ? 'rgba(148,163,184,.10)' : 'rgba(61,90,254,.06)',
      brand: isDark ? '#6d81ff' : '#3d5afe',
      brandDeep: isDark ? '#5468f0' : '#2b44d8',
      pass: isDark ? '#34d399' : '#0ea371',
      fail: isDark ? '#fb7185' : '#dc2643',
      bonus: isDark ? '#fbbf24' : '#b45309'
    };
  }

  function fmt(n) {
    if (typeof n === 'number') return Number.isInteger(n) ? String(n) : n.toFixed(2);
    return String(n);
  }

  // Waits for every <img> inside the node to finish loading; broken images
  // are removed so html-to-image never encounters (and fails on) a dead img.
  function settleImages(root) {
    const imgs = Array.from(root.querySelectorAll('img'));
    return Promise.all(imgs.map(img => new Promise((resolve) => {
      if (img.complete && img.naturalWidth > 0) return resolve();
      let settled = false;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        if (!ok && img.parentNode) img.parentNode.removeChild(img);
        resolve();
      };
      img.onload = () => finish(true);
      img.onerror = () => finish(false);
      setTimeout(() => finish(img.complete && img.naturalWidth > 0), 2500);
    })));
  }

  // Builds the export card node (offscreen). Branding is TEXT ONLY:
  // "MOCK MATRIX HUB" — nothing else, ever. The logo image is used only as
  // a subtle watermark BEHIND the text.
  function buildExportCard(cardEl, isDark) {
    const C = exportColors(isDark);
    const r = (cardEl && cardEl._rsmResult) || null;

    const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,'Noto Sans',sans-serif";

    const wrap = document.createElement('div');
    wrap.style.cssText =
      'position:fixed;left:-20000px;top:0;width:' + EXPORT_W + 'px;' +
      'background:' + C.bg + ';color:' + C.ink + ';font-family:' + FONT + ';' +
      'overflow:hidden;';

    // ── Watermark — BEHIND all content, clearly visible but subtle ──
    // Deliberately TEXT ONLY (no logo image): the /logo.png file carried
    // the old "Rank Score Master" branding, which was showing up in the
    // exported images. This guarantees the card always says only
    // "MOCK MATRIX HUB".
    const wm = document.createElement('div');
    wm.setAttribute('aria-hidden', 'true');
    wm.style.cssText =
      'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-24deg);' +
      'font-size:120px;font-weight:800;letter-spacing:.16em;white-space:nowrap;' +
      'color:' + C.brand + ';opacity:0.07;pointer-events:none;z-index:0;' +
      'font-family:' + FONT + ';';
    wm.textContent = 'MOCK MATRIX HUB';
    wrap.appendChild(wm);

    // ── Data extraction ──
    const headerText = (cardEl.querySelector('.result-card__header') || {}).textContent || '';
    const examTitle = (r && r.candidateInfo && r.candidateInfo.exam)
      ? r.candidateInfo.exam : String(headerText).trim();

    let detailRows = [];
    if (r && r.candidateInfo) {
      [['name', 'Candidate Name'], ['rollNo', 'Roll Number'], ['registrationNo', 'Registration No'],
       ['community', 'Community'], ['centre', 'Venue Name'], ['date', 'Exam Date'], ['shift', 'Exam Time']]
        .forEach(p => { if (r.candidateInfo[p[0]]) detailRows.push([p[1], r.candidateInfo[p[0]]]); });
    } else {
      Array.from(cardEl.querySelectorAll('.detail-table tr')).forEach(tr => {
        const tds = tr.querySelectorAll('td');
        if (tds.length >= 2 && tds[0].textContent.trim() && tds[1].textContent.trim()) {
          detailRows.push([tds[0].textContent.trim(), tds[1].textContent.trim()]);
        }
      });
    }

    let hasBonus = false, sectionRows = [], overallRows = [];
    if (r && r.sections && r.sections.length) {
      hasBonus = (r.totalBonus > 0) || r.sections.some(s => s.bonus > 0);
      sectionRows = r.sections.map(s => ({
        name: s.name, total: s.total, c: s.correct, w: s.wrong, b: s.bonus,
        score: s.score, q: !!s.isQualifying
      }));
      if (r.qualifyingTotal != null) {
        overallRows.push({ label: 'Total (for Rank)', total: r.totalQ, c: r.totalCorrect, w: r.totalWrong, b: r.totalBonus, score: r.totalScore });
        overallRows.push({
          label: 'Total (All Sections)',
          total: r.totalQ + r.qualifyingQ,
          c: r.totalCorrect + r.qualifyingCorrect,
          w: r.totalWrong + r.qualifyingWrong,
          b: r.totalBonus + r.qualifyingBonus,
          score: +(r.totalScore + r.qualifyingTotal).toFixed(2)
        });
      } else {
        overallRows.push({ label: 'Overall', total: r.totalQ, c: r.totalCorrect, w: r.totalWrong, b: r.totalBonus, score: r.totalScore });
      }
    }

    const scoreVal = r ? r.totalScore : null;
    const scoreMax = r ? r.maxScore : null;
    const pct = r ? r.pct : null;

    // Rank cards — read whatever rank/percentile data is already rendered.
    const rankCards = Array.from(cardEl.querySelectorAll('.rank-card'))
      .filter(c => !c.classList.contains('rank-card--loading'))
      .map(c => ({
        label: (c.querySelector('.rank-card__label') || {}).textContent || '',
        value: (c.querySelector('.rank-card__value') || {}).textContent || '',
        pct: (c.querySelector('.rank-card__pct') || {}).textContent || ''
      }))
      .filter(x => x.label && x.value);

    // ── HTML assembly (all inline styles — no dependency on page CSS) ──
    let detailHTML = '';
    if (detailRows.length) {
      detailHTML = `
      <div style="border:1px solid ${C.rule};border-radius:20px;overflow:hidden;margin-top:34px;">
        <div style="background:${C.soft};padding:15px 26px;font-size:19px;font-weight:800;color:${C.ink};letter-spacing:.02em;">CANDIDATE DETAILS</div>
        <div style="padding:6px 26px;">
          ${detailRows.map((row, i) => `
          <div style="display:flex;align-items:baseline;padding:13px 0;${i < detailRows.length - 1 ? 'border-bottom:1px solid ' + C.rule + ';' : ''}font-size:21px;line-height:1.35;">
            <div style="flex:0 0 300px;color:${C.muted};font-weight:600;">${escapeHtml(row[0])}</div>
            <div style="flex:1;color:${C.ink};font-weight:700;word-break:break-word;">${escapeHtml(row[1])}</div>
          </div>`).join('')}
        </div>
      </div>`;
    }

    const headCells = [
      '<th style="text-align:left;padding:13px 24px;font-weight:700;">Section</th>',
      '<th style="text-align:center;padding:13px 10px;font-weight:700;">Total</th>',
      '<th style="text-align:center;padding:13px 10px;font-weight:700;color:' + C.pass + ';">Right</th>',
      '<th style="text-align:center;padding:13px 10px;font-weight:700;color:' + C.fail + ';">Wrong</th>'
    ];
    if (hasBonus) headCells.push('<th style="text-align:center;padding:13px 10px;font-weight:700;color:' + C.bonus + ';">Bonus</th>');
    headCells.push('<th style="text-align:right;padding:13px 24px;font-weight:700;">Marks</th>');

    const bodyRows = sectionRows.map(s => `
      <tr style="border-bottom:1px solid ${C.rule};">
        <td style="padding:12px 24px;color:${C.ink};font-weight:600;text-align:left;font-size:21px;">${escapeHtml(s.name)}${s.q ? ' <span style="color:' + C.fail + ';font-weight:800;">(Q)</span>' : ''}</td>
        <td style="padding:12px 8px;text-align:center;color:${C.ink};font-size:21px;">${fmt(s.total)}</td>
        <td style="padding:12px 8px;text-align:center;color:${C.pass};font-weight:700;font-size:21px;">${fmt(s.c)}</td>
        <td style="padding:12px 8px;text-align:center;color:${C.fail};font-weight:700;font-size:21px;">${fmt(s.w)}</td>
        ${hasBonus ? `<td style="padding:12px 8px;text-align:center;color:${C.bonus};font-weight:700;font-size:21px;">${fmt(s.b)}</td>` : ''}
        <td style="padding:12px 24px;text-align:right;color:${C.brand};font-weight:800;font-size:21px;">${fmt(s.score)}</td>
      </tr>`).join('');

    const overallHTML = overallRows.map(o => `
      <tr style="background:${C.soft};border-top:2px solid ${C.brand};">
        <td style="padding:14px 24px;color:${C.ink};font-weight:800;text-align:left;font-size:21px;">${escapeHtml(o.label)}</td>
        <td style="padding:14px 8px;text-align:center;color:${C.ink};font-weight:800;font-size:21px;">${fmt(o.total)}</td>
        <td style="padding:14px 8px;text-align:center;color:${C.pass};font-weight:800;font-size:21px;">${fmt(o.c)}</td>
        <td style="padding:14px 8px;text-align:center;color:${C.fail};font-weight:800;font-size:21px;">${fmt(o.w)}</td>
        ${hasBonus ? `<td style="padding:14px 8px;text-align:center;color:${C.bonus};font-weight:800;font-size:21px;">${fmt(o.b)}</td>` : ''}
        <td style="padding:14px 24px;text-align:right;color:${C.brand};font-weight:800;font-size:22px;">${fmt(o.score)}</td>
      </tr>`).join('');

    let marksHTML = '';
    if (sectionRows.length || overallRows.length) {
      marksHTML = `
      <div style="border:1px solid ${C.rule};border-radius:20px;overflow:hidden;margin-top:34px;">
        <div style="background:${C.soft};padding:15px 26px;font-size:19px;font-weight:800;color:${C.ink};letter-spacing:.02em;">SECTION-WISE MARKS</div>
        <table style="width:100%;border-collapse:collapse;">
          <thead><tr style="background:${C.soft};color:${C.muted};font-size:16px;letter-spacing:.04em;text-transform:uppercase;">
            ${headCells.join('')}
          </tr></thead>
          <tbody>${bodyRows}${overallHTML}</tbody>
        </table>
      </div>`;
    }

    let rankHTML = '';
    if (rankCards.length) {
      const cols = rankCards.length >= 4 ? 4 : rankCards.length;
      rankHTML = `
      <div style="border:1px solid ${C.rule};border-radius:20px;overflow:hidden;margin-top:34px;">
        <div style="background:${C.soft};padding:15px 26px;font-size:19px;font-weight:800;color:${C.ink};letter-spacing:.02em;">RANK &amp; ANALYSIS</div>
        <div style="padding:22px;display:grid;grid-template-columns:repeat(${cols},1fr);gap:14px;">
          ${rankCards.map(rc => `
          <div style="border:1px solid ${C.rule};border-radius:14px;background:${C.soft};padding:18px 16px;text-align:center;">
            <div style="font-size:15px;color:${C.muted};font-weight:700;letter-spacing:.02em;">${escapeHtml(rc.label)}</div>
            <div style="font-size:28px;font-weight:800;color:${C.brand};margin-top:6px;line-height:1.1;">${escapeHtml(rc.value)}</div>
            ${rc.pct ? `<div style="font-size:15px;color:${C.muted};margin-top:5px;">${escapeHtml(rc.pct)}</div>` : ''}
          </div>`).join('')}
        </div>
      </div>`;
    }

    let scoreHTML = '';
    if (scoreVal != null) {
      scoreHTML = `
      <div style="margin-top:34px;background:${C.soft};border:1px solid ${C.rule};border-radius:20px;padding:30px 40px;text-align:center;">
        <div style="font-size:17px;letter-spacing:.22em;font-weight:800;color:${C.muted};">YOUR SCORE</div>
        <div style="margin-top:6px;font-size:86px;font-weight:800;color:${C.brand};line-height:1.05;">${fmt(scoreVal)}${scoreMax != null ? '<span style="font-size:32px;color:' + C.muted + ';font-weight:600;"> / ' + fmt(scoreMax) + '</span>' : ''}</div>
        ${pct ? `<div style="margin-top:8px;font-size:26px;font-weight:800;color:${C.pass};">${escapeHtml(pct)}%</div>` : ''}
      </div>`;
    }

    const content = document.createElement('div');
    content.style.cssText = 'position:relative;z-index:2;padding:58px 56px 46px;';
    content.innerHTML = `
      <div style="text-align:center;">
        <div style="letter-spacing:.30em;font-weight:800;font-size:21px;color:${C.brand};">MOCK MATRIX HUB</div>
        <div style="font-size:58px;font-weight:800;color:${C.ink};margin-top:8px;letter-spacing:-.01em;line-height:1.05;">SCORE CARD</div>
        <div style="height:4px;width:120px;background:linear-gradient(90deg,${C.brand},${C.brandDeep});border-radius:99px;margin:22px auto 0;"></div>
        ${examTitle ? `<div style="display:inline-block;margin-top:22px;padding:10px 28px;border-radius:999px;background:${C.soft};color:${C.brandDeep};font-size:23px;font-weight:700;border:1px solid ${C.rule};max-width:92%;">${escapeHtml(examTitle)}</div>` : ''}
      </div>
      ${scoreHTML}
      ${detailHTML}
      ${marksHTML}
      ${rankHTML}`;
    wrap.appendChild(content);

    // ── Footer brand bar (full width) ──
    const footer = document.createElement('div');
    footer.style.cssText =
      'position:relative;z-index:2;margin-top:44px;' +
      'background:linear-gradient(90deg,' + C.brand + ',' + C.brandDeep + ');' +
      'color:#ffffff;text-align:center;padding:26px 20px;' +
      'font-size:21px;font-weight:800;letter-spacing:.08em;';
    footer.textContent = 'MOCK MATRIX HUB  ·  mockmatrixhub.in';
    wrap.appendChild(footer);

    return wrap;
  }

  async function captureCardImage(cardEl) {
    const htmlToImage = await ensureHtmlToImage();
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';

    const exportNode = buildExportCard(cardEl, isDark);
    document.body.appendChild(exportNode);

    try {
      await settleImages(exportNode);
      const canvas = await htmlToImage.toCanvas(exportNode, {
        pixelRatio: 3,
        backgroundColor: exportColors(isDark).bg,
        width: EXPORT_W,
        style: { transform: 'none' }
      });
      return canvas;
    } finally {
      if (exportNode.parentNode) exportNode.parentNode.removeChild(exportNode);
    }
  }


  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function fileNameFor(meta, suffix) {
    const fam = (meta && meta.family) ? meta.family : 'exam';
    return `scorecard-${fam}-${suffix}-${Date.now()}.png`;
  }

  function canvasToBase64(canvas) {
    // Strip the "data:image/png;base64," prefix — native Filesystem
    // writes want the raw base64 payload only.
    const dataUrl = canvas.toDataURL('image/png', 1.0);
    return dataUrl.split(',')[1];
  }

  function canvasToBlob(canvas) {
    return new Promise(resolve => canvas.toBlob(b => resolve(b), 'image/png', 1.0));
  }

  // Writes the canvas into the app's cache dir via the Capacitor
  // Filesystem plugin and returns a file:// / content:// URI that other
  // native plugins (Share, Media) can consume. Used only inside the
  // packaged app — browsers use the Blob/download path instead.
  async function writeCanvasToNativeCache(canvas, fileName) {
    const Filesystem = nativePlugin('Filesystem');
    if (!Filesystem) throw new Error('Filesystem plugin not available');
    const base64Data = canvasToBase64(canvas);
    await Filesystem.writeFile({
      path: fileName,
      data: base64Data,
      directory: 'CACHE',
      recursive: true
    });
    const uriResult = await Filesystem.getUri({ path: fileName, directory: 'CACHE' });
    return uriResult.uri;
  }

  // Returns the device's Android major version from the WebView's
  // user-agent string (e.g. "Android 13"), or null if not Android.
  function androidApiLevel() {
    const m = (navigator.userAgent || '').match(/Android\s+(\d+)(?:\.(\d+))?/i);
    return m ? parseInt(m[1], 10) : null;
  }

  // ── Gallery / storage permission flow (native only) ─────────────────────
  // Runs BEFORE saving an image to the gallery. The rules match Android's
  // actual permission model:
  //   · Android 10 (API 29) and above — saving to the gallery goes through
  //     MediaStore, which needs NO permission at all → 'granted', no prompt.
  //   · Android 9 (API 28) and below — WRITE_EXTERNAL_STORAGE is genuinely
  //     required, so we check/request it via the Filesystem plugin.
  //   · iOS — Media.savePhoto() triggers its own add-only photo prompt.
  // Returns 'granted' | 'denied' | 'unavailable' (unknown → try saving
  // anyway and let the save attempt itself surface any real error).
  async function ensureStoragePermission() {
    const platform = (window.Capacitor && window.Capacitor.getPlatform)
      ? window.Capacitor.getPlatform() : 'web';
    if (platform !== 'android') return 'granted';

    const api = androidApiLevel();
    if (api === null) return 'unavailable';     // can't tell version — just try saving
    if (api >= 10) return 'granted';            // MediaStore path — no permission needed

    // Android 9 and below — WRITE_EXTERNAL_STORAGE is required.
    const Filesystem = nativePlugin('Filesystem');
    if (!Filesystem || typeof Filesystem.checkPermissions !== 'function') return 'unavailable';

    let perms = null;
    try { perms = await Filesystem.checkPermissions(); } catch (e) { return 'unavailable'; }
    if (!perms) return 'unavailable';

    const state = perms.publicStorage;
    if (state === 'granted') return 'granted';
    if (state === 'denied') return 'denied';

    // 'prompt' | 'prompt-with-rationale' | anything else → request.
    let req = null;
    try { req = await Filesystem.requestPermissions(); } catch (e) { return 'unavailable'; }
    if (!req) return 'unavailable';
    if (req.publicStorage === 'granted') return 'granted';
    if (req.publicStorage === 'denied') return 'denied';
    return 'unavailable';
  }

  // ── Save the canvas PNG to the device's public files ──
  // Android: tries the public Downloads/Documents area first (works up to
  // Android 9 with WRITE_EXTERNAL_STORAGE), then falls back to the app's
  // own Documents dir on Android 10+ (still on-device, still no dialog,
  // just not in the public folder). iOS: Files app. Returns the directory
  // that was actually used so the caller can say where it landed.
  async function saveCanvasToFiles(canvas, fileName) {
    const Filesystem = nativePlugin('Filesystem');
    if (!Filesystem || typeof Filesystem.writeFile !== 'function') {
      throw new Error('Filesystem plugin not available');
    }
    const base64Data = canvasToBase64(canvas);
    const platform = (window.Capacitor && window.Capacitor.getPlatform)
      ? window.Capacitor.getPlatform() : 'web';
    if (platform === 'android') {
      try {
        await Filesystem.writeFile({ path: fileName, data: base64Data, directory: 'EXTERNAL_STORAGE', recursive: true });
        return 'EXTERNAL_STORAGE';
      } catch (e) {
        await Filesystem.writeFile({ path: fileName, data: base64Data, directory: 'DOCUMENTS', recursive: true });
        return 'DOCUMENTS';
      }
    }
    await Filesystem.writeFile({ path: fileName, data: base64Data, directory: 'DOCUMENTS', recursive: true });
    return 'DOCUMENTS';
  }

  // ── Resolve a real, existing album directory for Media.savePhoto ──
  // Media.savePhoto rejects with "Album identifier does not exist" unless
  // `albumIdentifier` points at an EXISTING directory. On Android we:
  //   1) reuse an existing gallery album (preferring Pictures/DCIM/Camera), or
  //   2) create a dedicated "Mock Matrix Hub" album inside the app's media
  //      root if the device has no albums yet.
  // Returns a directory path, or null if nothing usable could be resolved.
  async function resolveGalleryAlbum(Media) {
    if (typeof Media.getAlbums !== 'function') return null;

    let rootPath = null;
    if (typeof Media.getAlbumsPath === 'function') {
      try {
        const root = await Media.getAlbumsPath();
        rootPath = root && root.path;
      } catch (e) { /* ignore */ }
    }

    // 1) Existing album? Prefer a common photos folder.
    try {
      const res = await Media.getAlbums();
      const albums = (res && res.albums) || [];
      const pref = albums.find(a => /pictures|dcim|camera/i.test(a.name || '')) || albums[0];
      if (pref && pref.identifier) return pref.identifier;
    } catch (e) { /* ignore — try creating our own below */ }

    // 2) No albums yet — create our own folder inside the app media root.
    if (rootPath) {
      const albumName = 'Mock Matrix Hub';
      try { await Media.createAlbum({ name: albumName }); } catch (e) { /* may already exist */ }
      return rootPath + '/' + albumName;
    }
    return null;
  }

  // ── Return path for the review / mock pages ──────────────────────────────
  // review.html and test.html are opened from the calculator. Their back
  // buttons must return to the calculator page (with its family/exam query
  // string intact) instead of re-entering a page whose sessionStorage
  // handoff was already consumed. Stored once here, READ (not deleted) by
  // review.js / test.js so it survives their handoff cleanup.
  function rememberReturnTo() {
    try {
      sessionStorage.setItem('rsm-return-to', 'calculator.html' + (window.location.search || ''));
    } catch (e) { /* storage unavailable — back buttons fall back gracefully */ }
  }

  async function handleShare(cardEl, meta) {
    try {
      toast('Preparing image…');
      const canvas = await captureCardImage(cardEl);
      const fileName = fileNameFor(meta, 'share');

      if (isNativeApp()) {
        // ── 1) Native share sheet. No storage permission is needed here:
        //    the PNG is written to the app's own cache and shared through
        //    the system FileProvider. ──
        try {
          const fileUri = await writeCanvasToNativeCache(canvas, fileName);
          const Share = nativePlugin('Share');
          if (Share && typeof Share.share === 'function') {
            await Share.share({
              title: 'My Score Card',
              text: 'My score card from Mock Matrix Hub',
              files: [fileUri],
              dialogTitle: 'Share your scorecard'
            });
            return;
          }
        } catch (e) {
          // Share plugin missing, or no app could handle the share —
          // fall through to the file-save fallback below.
        }

        // ── 2) Share unavailable → save the image to the device's files
        //    so the user still ends up with their scorecard. ──
        try {
          await saveCanvasToFiles(canvas, fileName);
          toast('Share not available — scorecard saved to your device files');
          return;
        } catch (e) {
          // fall through to web share/download below
        }
      }

      const blob = await canvasToBlob(canvas);
      if (!blob) { toast('Could not create image'); return; }
      try {
        const file = new File([blob], fileName, { type: 'image/png' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: 'My Score Card' });
          return;
        }
      } catch (e) {
        // fall through to download
      }
      downloadBlob(blob, fileName);
      toast('Sharing not supported here — image saved instead');
    } catch (e) {
      console.error('[MMH] share failed:', e);
      toast('Could not create image — try again');
    }
  }

  async function handleImage(cardEl, meta) {
    try {
      toast('Saving high-quality image…');

      // ── Storage permission — the SAME "check then request" pattern the
      //    notification flow uses (Filesystem.checkPermissions /
      //    requestPermissions). It only prompts where Android actually
      //    requires it: Android 9 (API 28) and below need WRITE_EXTERNAL_STORAGE.
      //    Android 10+ saves via the MediaStore path, which needs NO
      //    permission, so no dialog appears there — exactly like WhatsApp /
      //    other modern apps that save to the gallery silently. ──
      if (isNativeApp()) {
        const perm = await ensureStoragePermission();
        if (perm === 'denied') {
          toast('Storage permission is denied. Enable it in app settings to save images.');
          return;
        }
      }

      const canvas = await captureCardImage(cardEl);
      const fileName = fileNameFor(meta, 'image');
      const platform = (window.Capacitor && window.Capacitor.getPlatform)
        ? window.Capacitor.getPlatform() : 'web';

      if (isNativeApp()) {
        // ── 1) Preferred: save straight into the photo gallery via the
        //    Media plugin (no dialog). On Android this REQUIRES
        //    `albumIdentifier` to be an existing directory — resolveGalleryAlbum()
        //    below finds a real album (Pictures/DCIM) or creates a
        //    "Mock Matrix Hub" album so the save always has a valid target. ──
        const Media = nativePlugin('Media');
        if (Media && typeof Media.savePhoto === 'function') {
          try {
            const dataUrl = canvas.toDataURL('image/png', 1.0);
            let albumIdentifier = null;
            if (platform === 'android') {
              albumIdentifier = await resolveGalleryAlbum(Media);
              if (!albumIdentifier) throw new Error('no album available');
            }
            const baseName = String(fileName).replace(/\.png$/i, '');
            await Media.savePhoto({ path: dataUrl, albumIdentifier, fileName: baseName });
            toast('Saved to gallery');
            return;
          } catch (e) {
            console.error('[MMH] gallery save failed:', e);
          }
        }

        // ── 2) Fallback: write the PNG straight to the device — public
        //    Downloads on older Android, the Files app on iOS, or the app's
        //    own storage on Android 10+. Still no dialog. This must NOT fall
        //    back to the Share sheet first, otherwise "Save image" and
        //    "Share" would behave identically. ──
        try {
          const dir = await saveCanvasToFiles(canvas, fileName);
          toast(dir === 'EXTERNAL_STORAGE' ? 'Image saved to Downloads' : 'Image saved to device storage');
          return;
        } catch (e) {
          console.error('[MMH] files save failed:', e);
        }

        // ── 3) Last resort ONLY (gallery AND files both unavailable):
        //    system share sheet where the user can tap "Save image". ──
        try {
          const fileUri = await writeCanvasToNativeCache(canvas, fileName);
          const Share = nativePlugin('Share');
          if (Share && typeof Share.share === 'function') {
            await Share.share({ title: 'Save Score Card', files: [fileUri] });
            toast('Choose "Save image" in the share sheet to add it to your gallery');
            return;
          }
        } catch (e) {
          console.error('[MMH] share-sheet fallback failed:', e);
        }
      }

      const blob = await canvasToBlob(canvas);
      if (!blob) { toast('Could not create image'); return; }
      downloadBlob(blob, fileName);
      toast('Image saved');
    } catch (e) {
      console.error('[MMH] image save failed:', e);
      toast('Could not create image — try again');
    }
  }

  // ── Review Paper handoff ──
  // Builds the richer review JSON (full question/option text + image
  // URLs, not just the qno+status score-engine.js needs) fresh, on
  // demand, from the SAME raw HTML `parts` already sitting in memory on
  // the result card (cardEl._rsmPdfData.parts — the same stash
  // pdf-download.js reads). Nothing here is written to RSMCache/
  // localStorage: the JSON is handed to review.html through
  // sessionStorage under one short-lived key that review.js deletes the
  // instant it reads it (and again on unload), so no generated review
  // data is ever left sitting in app storage once the person navigates
  // back — exactly the "don't keep it cached, only keep it while the
  // page is open" behaviour that was asked for.
  const REVIEW_HANDOFF_KEY = 'rsm-review-handoff';

  function openReviewPaper(cardEl, meta) {
    if (typeof RSMReviewBuilder === 'undefined') {
      toast('Review module failed to load — refresh and try again');
      return;
    }
    const pdfData = cardEl && cardEl._rsmPdfData;
    const parts = pdfData && pdfData.parts;
    const family = (meta && meta.family) || (pdfData && pdfData.family);
    const url = (meta && meta.url) || (pdfData && pdfData.url);

    if (!parts || !family) {
      toast('Please recalculate this result once, then try Review Paper again');
      return;
    }

    try {
      const reviewJson = RSMReviewBuilder.build(family, parts, url);
      if (!reviewJson || !reviewJson.sections || !reviewJson.sections.length) {
        toast('Could not build a review paper from this result');
        return;
      }
      sessionStorage.setItem(REVIEW_HANDOFF_KEY, JSON.stringify(reviewJson));
      rememberReturnTo();
      window.location.href = 'review.html';
    } catch (e) {
      toast('Could not open Review Paper — try again');
    }
  }

  // ── Attempt as Mock Test handoff ──
  // Same idea as openReviewPaper() just above: builds a fresh JSON on
  // demand from the SAME raw HTML `parts` already sitting in memory on
  // the result card, hands it to test.html through sessionStorage under
  // its own short-lived key, and navigates there. The one real
  // difference is the JSON itself — RSMReviewBuilder.buildBlank() strips
  // away the ORIGINAL candidate's chosen answers/status (this browser's
  // person is about to attempt the paper fresh, not read someone else's
  // result), keeping only the question/option/correct-answer content.
  // examId is recovered from RSMCache the same way buildRankCtx() in
  // score-engine.js already does, purely to look up the right timer
  // config and marking scheme — nothing here talks to score-engine.js.
  const TEST_HANDOFF_KEY = 'rsm-test-handoff';

  function openAttemptMock(cardEl, meta) {
    if (typeof RSMReviewBuilder === 'undefined' || !RSMReviewBuilder.buildBlank) {
      toast('Mock test module failed to load — refresh and try again');
      return;
    }
    const pdfData = cardEl && cardEl._rsmPdfData;
    const parts = pdfData && pdfData.parts;
    const family = (meta && meta.family) || (pdfData && pdfData.family);
    const url = (meta && meta.url) || (pdfData && pdfData.url);

    if (!parts || !family) {
      toast('Please recalculate this result once, then try Attempt as Mock again');
      return;
    }

    const formFields = (typeof RSMCache !== 'undefined' && RSMCache.getFormFields && url)
      ? (RSMCache.getFormFields(url) || {})
      : {};

    try {
      const blank = RSMReviewBuilder.buildBlank(family, parts, url);
      if (!blank || !blank.sections || !blank.sections.length) {
        toast('Could not build a mock test from this result');
        return;
      }
      sessionStorage.setItem(TEST_HANDOFF_KEY, JSON.stringify({
        blank,
        family,
        examId: formFields.examId || null
      }));
      rememberReturnTo();
      window.location.href = 'test.html';
    } catch (e) {
      toast('Could not start the mock test — try again');
    }
  }

  // ── Action buttons on the result card ──
  function attachResultActions(cardEl, ctx, meta) {
    if (!cardEl) return;
    cardEl.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.getAttribute('data-action');
        switch (action) {
          case 'new-url':
            exitResultMode(ctx, { clearUrl: true });
            break;
          case 'share':
            handleShare(cardEl, meta);
            break;
          case 'image':
            handleImage(cardEl, meta);
            break;
          case 'pdf':
            if (typeof RSMPdfDownload !== 'undefined') {
              RSMPdfDownload.handlePdfClick(btn, cardEl._rsmPdfData);
            } else {
              toast('PDF module failed to load — refresh and try again');
            }
            break;
          case 'review-paper':
            openReviewPaper(cardEl, meta);
            break;
          case 'attempt-mock':
            openAttemptMock(cardEl, meta);
            break;
        }
      });
    });
  }

  return {
    toast,
    enterResultMode,
    exitResultMode,
    initEditBar,
    initRecentChips,
    attachResultActions,
    captureCardImage,
    handleShare,
    handleImage,
    validateFields,
    initFieldErrorClearing,
    markFieldError,
    clearFieldError,
    isNativeApp
  };
})();



