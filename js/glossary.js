/**
 * Glossary Tooltip + Difficulty Rating + Q&A Panel System
 *
 * Loads:
 *   - book/_shared/glossary.json       → term tooltips
 *   - book/_shared/difficulty-ratings.json → chapter difficulty badges
 *   - book/_shared/qa-part*.json        → per-chapter Q&A
 *
 * Exposes: window.GlossarySystem.annotate(container, chapterFile)
 */
(function () {
  'use strict';

  let glossaryTerms = [];       // from glossary.json
  let difficultyMap = {};       // chapter path fragment → rating object
  let qaIndex = {};             // chapter key → array of Q&A pairs
  let loaded = false;

  // ── Data Loading ──────────────────────────────────────────

  async function init() {
    if (loaded) return;
    try {
      const [glossRes, diffRes] = await Promise.all([
        fetch('book/_shared/glossary.json').then(r => r.ok ? r.json() : { terms: [] }),
        fetch('book/_shared/difficulty-ratings.json').then(r => r.ok ? r.json() : { ratings: [] }),
      ]);
      glossaryTerms = (glossRes.terms || glossRes || []);
      // Build difficulty map: use chapter field as key
      (diffRes.ratings || []).forEach(r => {
        difficultyMap[r.chapter] = r;
      });

      // Load Q&A files (best-effort, don't block on missing files)
      const qaFiles = [
        'book/_shared/qa-part0-1.json',
        'book/_shared/qa-part2-arch.json',
        'book/_shared/qa-part2-qa.json',
        'book/_shared/qa-part3.json',
        'book/_shared/qa-part4-5.json',
      ];
      const qaResults = await Promise.allSettled(
        qaFiles.map(f => fetch(f).then(r => r.ok ? r.json() : []))
      );
      qaResults.forEach(result => {
        if (result.status === 'fulfilled' && Array.isArray(result.value)) {
          result.value.forEach(ch => {
            const key = ch.chapter; // e.g. "Q01", "01_代码地图", "01_权限系统完全解析"
            qaIndex[key] = { title: ch.title, qa: ch.qa || ch.qa_pairs || [] };
          });
        }
      });

      loaded = true;
    } catch (e) {
      console.warn('[GlossarySystem] init failed:', e);
    }
  }

  // ── Term Annotation ───────────────────────────────────────

  /**
   * Annotates the first occurrence of each glossary term in the container.
   * Skips terms inside <code>, <pre>, <a>, headings, and already-annotated spans.
   */
  function annotateTerms(container) {
    if (!glossaryTerms.length) return;

    // Build a sorted list (longer terms first to avoid partial matches)
    const sorted = [...glossaryTerms].sort((a, b) => {
      const aLen = Math.max(a.term.length, ...(a.aka || []).map(s => s.length));
      const bLen = Math.max(b.term.length, ...(b.aka || []).map(s => s.length));
      return bLen - aLen;
    });

    const annotated = new Set();

    sorted.forEach(entry => {
      if (annotated.has(entry.term)) return;

      // All names for this term (main + aka)
      const names = [entry.term, ...(entry.aka || [])];
      // Escape regex special chars
      const patterns = names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      const regex = new RegExp('(' + patterns.join('|') + ')', 'g');

      const walker = document.createTreeWalker(
        container,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode(node) {
            const parent = node.parentElement;
            if (!parent) return NodeFilter.FILTER_REJECT;
            const tag = parent.tagName;
            // Skip code, pre, links, headings, already annotated
            if (['CODE', 'PRE', 'A', 'H1', 'H2', 'H3', 'H4'].includes(tag)) return NodeFilter.FILTER_REJECT;
            if (parent.classList.contains('glossary-term')) return NodeFilter.FILTER_REJECT;
            if (parent.closest('pre') || parent.closest('code') || parent.closest('.glossary-term')) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
          },
        }
      );

      let found = false;
      const textNodes = [];
      while (walker.nextNode()) textNodes.push(walker.currentNode);

      for (const textNode of textNodes) {
        if (found) break;
        const match = regex.exec(textNode.textContent);
        if (!match) { regex.lastIndex = 0; continue; }

        // Split text node and insert annotated span
        const before = textNode.textContent.substring(0, match.index);
        const matchText = match[1];
        const after = textNode.textContent.substring(match.index + matchText.length);

        const span = document.createElement('span');
        span.className = 'glossary-term';
        span.textContent = matchText;
        span.dataset.term = entry.term;
        span.dataset.definition = entry.definition;
        if (entry.analogy) span.dataset.analogy = entry.analogy;

        const parent = textNode.parentNode;
        if (before) parent.insertBefore(document.createTextNode(before), textNode);
        parent.insertBefore(span, textNode);
        if (after) parent.insertBefore(document.createTextNode(after), textNode);
        parent.removeChild(textNode);

        annotated.add(entry.term);
        found = true;
        regex.lastIndex = 0;
      }
      regex.lastIndex = 0;
    });
  }

  // ── Tooltip ───────────────────────────────────────────────

  let tooltipEl = null;

  function ensureTooltip() {
    if (tooltipEl) return;
    tooltipEl = document.createElement('div');
    tooltipEl.className = 'glossary-tooltip';
    tooltipEl.style.display = 'none';
    document.body.appendChild(tooltipEl);
  }

  function showTooltip(e) {
    const target = e.target.closest('.glossary-term');
    if (!target) return;
    ensureTooltip();

    const term = target.dataset.term;
    const def = target.dataset.definition;
    const analogy = target.dataset.analogy;

    tooltipEl.innerHTML = `
      <div class="glossary-tooltip-title">${escapeHTML(term)}</div>
      <div class="glossary-tooltip-def">${escapeHTML(def)}</div>
      ${analogy ? `<div class="glossary-tooltip-analogy">💡 ${escapeHTML(analogy)}</div>` : ''}
    `;
    tooltipEl.style.display = 'block';

    // Position
    const rect = target.getBoundingClientRect();
    const tipRect = tooltipEl.getBoundingClientRect();
    let left = rect.left + (rect.width / 2) - (tipRect.width / 2);
    let top = rect.top - tipRect.height - 8;

    // Keep within viewport
    if (left < 8) left = 8;
    if (left + tipRect.width > window.innerWidth - 8) left = window.innerWidth - tipRect.width - 8;
    if (top < 8) {
      top = rect.bottom + 8; // show below
    }

    tooltipEl.style.left = left + 'px';
    tooltipEl.style.top = top + window.scrollY + 'px';
  }

  function hideTooltip() {
    if (tooltipEl) tooltipEl.style.display = 'none';
  }

  // Global event delegation for tooltips
  document.addEventListener('mouseenter', function (e) {
    if (e.target.classList && e.target.classList.contains('glossary-term')) showTooltip(e);
  }, true);
  document.addEventListener('mouseleave', function (e) {
    if (e.target.classList && e.target.classList.contains('glossary-term')) hideTooltip();
  }, true);

  // ── Difficulty Badge ──────────────────────────────────────

  /**
   * Maps a BOOK_STRUCTURE file path to a difficulty-ratings.json chapter key.
   * e.g. "part3_子系统完全解析/01_权限系统完全解析.md" → "part3/01_权限系统"
   */
  function fileToDifficultyKey(filePath) {
    if (!filePath) return null;
    // Try direct match patterns
    // difficulty-ratings.json uses paths like "part0/00_序章", "part3/01_权限系统"
    // BOOK_STRUCTURE uses paths like "part0_序章/00_序章.md", "part3_子系统完全解析/01_权限系统完全解析.md"

    // Strategy: extract the part number and chapter number/name, try matching
    const m = filePath.match(/part(\d+)_[^/]+\/(\d+)_(.+?)(?:完全解析)?\.md$/);
    if (m) {
      const partNum = m[1];
      const chNum = m[2];
      const chName = m[3].replace(/\.md$/, '');
      // Try variations
      const candidates = [
        `part${partNum}/${chNum}_${chName}`,
        `part${partNum}/${chNum}_${m[3]}`,
      ];
      for (const c of candidates) {
        if (difficultyMap[c]) return c;
      }
      // Fuzzy: match by part number and chapter number
      for (const key of Object.keys(difficultyMap)) {
        if (key.startsWith(`part${partNum}/`) && key.includes(`${chNum}_`)) return key;
      }
    }

    // For 记忆系统 etc. without numbered prefix
    const m2 = filePath.match(/part(\d+)_[^/]+\/(.+?)(?:完全解析)?\.md$/);
    if (m2) {
      const partNum = m2[1];
      const name = m2[2];
      for (const key of Object.keys(difficultyMap)) {
        if (key.startsWith(`part${partNum}/`) && key.includes(name)) return key;
      }
    }

    return null;
  }

  function renderDifficultyBadge(container, filePath) {
    const key = fileToDifficultyKey(filePath);
    if (!key || !difficultyMap[key]) return;

    const rating = difficultyMap[key];
    const stars = rating.difficulty;
    const friendly = rating.friendly;
    const note = rating.notes || '';

    // Find the first h1 in the container
    const h1 = container.querySelector('h1');
    if (!h1) return;
    // Don't add duplicate badges
    if (h1.querySelector('.difficulty-badge')) return;

    const badge = document.createElement('span');
    badge.className = 'difficulty-badge';
    const starStr = '★'.repeat(Math.floor(stars)) + (stars % 1 >= 0.5 ? '½' : '');
    const emptyStr = '☆'.repeat(5 - Math.ceil(stars));
    // i18n：难度徽章文案按 locale 切换
    const isEn = (function(){ try { return (localStorage.getItem('cc-locale')||'zh')==='en'; } catch(e){ return false; } })();
    const friendlyMap = {
      '极高': 'Very High', '中高': 'High-Medium', '中低': 'Medium-Low',
      '高': 'High', '中': 'Medium', '低': 'Low',
      '入门': 'Beginner', '进阶': 'Intermediate', '深入': 'Deep', '专家': 'Expert'
    };
    const friendlyLabel = isEn ? (friendlyMap[friendly] || friendly) : friendly;
    const labelSuffix = isEn ? ' readability' : '友好度';
    const titleText = isEn ? `Difficulty ${stars}/5` : `阅读难度 ${stars}/5`;
    // 英文模式下不显示 note（note 字段是中文），避免在英文 UI 里混入中文
    const noteSuffix = (!isEn && note) ? ' — ' + escapeHTML(note) : '';
    badge.innerHTML = `<span class="difficulty-stars" title="${titleText}${noteSuffix}">${starStr}${emptyStr}</span><span class="difficulty-label">${escapeHTML(friendlyLabel)}${labelSuffix}</span>`;
    h1.appendChild(badge);
  }

  // ── Q&A Panel ─────────────────────────────────────────────

  /**
   * Maps a BOOK_STRUCTURE file path to Q&A index keys.
   * Handles multiple key formats across QA files:
   *   "Q01", "part0/00_序章", "part2_arch/01_代码地图", "part4-01", "01_权限系统完全解析"
   */
  function fileToQAKey(filePath) {
    if (!filePath) return null;

    // Q-chapters: "part2_好奇心驱动的深度问答/Q01_..." → "Q01"
    const qMatch = filePath.match(/(Q\d+)/);
    if (qMatch && qaIndex[qMatch[1]]) return qMatch[1];

    // Extract folder part number and filename
    const pathMatch = filePath.match(/part(\d+)_[^/]+\/(.+)\.md$/);
    if (!pathMatch) return null;

    const folderNum = pathMatch[1]; // "0", "2", "3", "4", "5"
    const fileName = pathMatch[2];  // "01_代码地图", "01_权限系统完全解析"
    const chNum = (fileName.match(/^(\d+)_/) || [])[1]; // "01"

    // Try exact filename match (for Part3 subsystems)
    if (qaIndex[fileName]) return fileName;

    // Try without 完全解析 suffix
    const stripped = fileName.replace(/完全解析$/, '').replace(/_$/, '');
    if (qaIndex[stripped]) return stripped;

    // Try "partN/filename" format (for Part0-1: "part0/00_序章")
    const pathKey = `part${folderNum}/${stripped}`;
    if (qaIndex[pathKey]) return pathKey;
    const pathKey2 = `part${folderNum}/${fileName}`;
    if (qaIndex[pathKey2]) return pathKey2;

    // Try "part2_arch/filename" format (for Part2 architecture)
    if (folderNum === '2') {
      const archKey = `part2_arch/${stripped}`;
      if (qaIndex[archKey]) return archKey;
    }

    // Try "partN-NN" format (for Part4-5: "part4-01")
    if (chNum) {
      const dashKey = `part${folderNum}-${chNum}`;
      if (qaIndex[dashKey]) return dashKey;
    }

    // Fuzzy: match any key containing the chapter number from same part
    if (chNum) {
      for (const key of Object.keys(qaIndex)) {
        if (key.includes(chNum + '_') && (key.includes('part' + folderNum) || !key.includes('part'))) {
          return key;
        }
      }
    }

    return null;
  }

  function renderQAPanel(container, filePath) {
    const key = fileToQAKey(filePath);
    if (!key || !qaIndex[key] || !qaIndex[key].qa.length) return;

    // Don't add duplicate panels
    if (container.querySelector('.qa-panel')) return;

    const qa = qaIndex[key];
    const isEn = (function(){ try { return (localStorage.getItem('cc-locale')||'zh')==='en'; } catch(e){ return false; } })();
    const levelLabels = isEn
      ? { concept: 'Basics', extend: 'Going Deeper', critical: 'Critical Lens' }
      : { concept: '基础理解', extend: '延伸思考', critical: '批判反思' };
    const levelIcons = { concept: '📗', extend: '📘', critical: '📕' };
    const qaPanelTitle = isEn ? `Discussion Questions · ${qa.qa.length}` : `思考题 · ${qa.qa.length} 道`;
    const diffLabel = isEn ? 'Difficulty' : '难度';

    let html = `
      <div class="qa-panel">
        <div class="qa-panel-header" role="button" tabindex="0">
          <span class="qa-panel-icon">💬</span>
          <span class="qa-panel-title">${qaPanelTitle}</span>
          <span class="qa-panel-toggle">▶</span>
        </div>
        <div class="qa-panel-body" style="display:none">
    `;

    qa.qa.forEach((item, i) => {
      const level = item.level || 'concept';
      const icon = levelIcons[level] || '📗';
      const label = levelLabels[level] || level;
      const diff = item.difficulty ? `<span class="qa-difficulty">${diffLabel} ${'●'.repeat(item.difficulty)}${'○'.repeat(5 - item.difficulty)}</span>` : '';

      // i18n：优先英文字段 (兼容 qEn / questionEn / question_en 等命名)
      const qText = isEn
        ? (item.qEn || item.questionEn || item.question_en || item.q || item.question || '')
        : (item.q || item.question || '');
      const aText = isEn
        ? (item.aEn || item.answerEn || item.answer_en || item.a || item.answer || '')
        : (item.a || item.answer || '');
      html += `
        <div class="qa-item" data-level="${level}">
          <div class="qa-question" role="button" tabindex="0">
            <span class="qa-level-badge">${icon} ${label}</span>
            ${diff}
            <div class="qa-question-text">${escapeHTML(qText)}</div>
            <span class="qa-expand-icon">▶</span>
          </div>
          <div class="qa-answer" style="display:none">
            ${escapeHTML(aText)}
          </div>
        </div>
      `;
    });

    html += '</div></div>';

    const div = document.createElement('div');
    div.innerHTML = html;
    container.appendChild(div.firstElementChild);

    // Toggle panel body
    const panel = container.querySelector('.qa-panel');
    const header = panel.querySelector('.qa-panel-header');
    const body = panel.querySelector('.qa-panel-body');
    const toggle = panel.querySelector('.qa-panel-toggle');

    header.addEventListener('click', () => {
      const visible = body.style.display !== 'none';
      body.style.display = visible ? 'none' : 'block';
      toggle.textContent = visible ? '▶' : '▼';
      panel.classList.toggle('qa-expanded', !visible);
    });

    // Toggle individual answers
    panel.querySelectorAll('.qa-question').forEach(q => {
      q.addEventListener('click', () => {
        const answer = q.nextElementSibling;
        const icon = q.querySelector('.qa-expand-icon');
        const visible = answer.style.display !== 'none';
        answer.style.display = visible ? 'none' : 'block';
        icon.textContent = visible ? '▶' : '▼';
        q.parentElement.classList.toggle('qa-item-expanded', !visible);
      });
    });
  }

  // ── Utility ───────────────────────────────────────────────

  function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Public API ────────────────────────────────────────────

  /**
   * Main entry point. Called after renderMarkdown() in app.js.
   * @param {HTMLElement} container - the chapter body element
   * @param {string} filePath - the chapter's file path from BOOK_STRUCTURE
   */
  async function annotate(container, filePath) {
    await init();
    annotateTerms(container);
    renderDifficultyBadge(container, filePath);
    renderQAPanel(container, filePath);
  }

  window.GlossarySystem = { annotate, init };
})();
