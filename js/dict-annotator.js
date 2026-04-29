/**
 * Dictionary Annotator — 章节内 term 自动标注 + tooltip + modal
 *
 * Phase D 任务：
 *   - 渲染 markdown 后扫描 #chapter-body 内文本节点
 *   - 用单个 union RegExp（按 term 长度倒序）一次性匹配所有词典 term
 *   - 给匹配处包 <span class="dict-term" data-term-id="...">
 *   - hover 0.3s 显示轻量 tooltip；click 弹完整 modal
 *   - 顶栏开关 toggle 控制是否启用（localStorage cc-dict-highlight）
 *
 * 性能目标：500 term × 章节 ≤ 100ms（用 console.time 测）
 *
 * 数据源：复用 dictionary.js 已加载的 entries（如未加载则自己 fetch）
 * 词典生词本 key：cc-dict-wordbook（与 dictionary.js 共用，保持单一事实来源）
 *
 * 暴露：window.DictAnnotator.annotate(container)
 *      window.DictAnnotator.refresh() — 重新读取开关并 re-annotate 当前 chapter-body
 *      window.DictAnnotator.isEnabled()
 */
(function () {
  'use strict';

  const HIGHLIGHT_KEY = 'cc-dict-highlight';   // on / off
  const WORDBOOK_KEY = 'cc-dict-wordbook';      // 与 dictionary.js 共用

  // 内部状态
  let entries = [];
  let entryById = Object.create(null);
  let loaded = false;
  let loadingPromise = null;

  // 编译后的扫描结构（按 locale 缓存）
  const compileCache = Object.create(null);

  // ===== i18n helpers =====
  function isEn() {
    try { return (localStorage.getItem('cc-locale') || 'zh') === 'en'; }
    catch (e) { return false; }
  }
  function L() { return isEn() ? UI.en : UI.zh; }
  const UI = {
    zh: {
      add_wordbook: '⭐ 加入生词本',
      added_wordbook: '★ 已加入',
      remove_wordbook: '☆ 已加入（点击移除）',
      jump_chapter: '↗ 跳转章节',
      see_also: '相关',
      close: '关闭',
      definition: '定义',
      plain_explanation: '通俗理解',
      first_appearance: '首次出现',
      category: '类别',
      priority: '优先级',
      tip_more: '点击查看完整释义'
    },
    en: {
      add_wordbook: '⭐ Add to Wordbook',
      added_wordbook: '★ Added',
      remove_wordbook: '☆ Added (click to remove)',
      jump_chapter: '↗ Open Chapter',
      see_also: 'See also',
      close: 'Close',
      definition: 'Definition',
      plain_explanation: 'Plain Explanation',
      first_appearance: 'First appears',
      category: 'Category',
      priority: 'Priority',
      tip_more: 'Click for full entry'
    }
  };

  // ===== Wordbook =====
  function getWordbook() {
    try { return JSON.parse(localStorage.getItem(WORDBOOK_KEY) || '[]'); }
    catch (e) { return []; }
  }
  function isInWordbook(id) {
    const wb = getWordbook();
    return wb.indexOf(id) >= 0;
  }
  function toggleWordbook(id) {
    const list = getWordbook();
    const idx = list.indexOf(id);
    if (idx >= 0) list.splice(idx, 1);
    else list.push(id);
    try { localStorage.setItem(WORDBOOK_KEY, JSON.stringify(list)); } catch (e) {}
    return list.indexOf(id) >= 0;
  }

  // ===== Highlight toggle =====
  function isEnabled() {
    try {
      const v = localStorage.getItem(HIGHLIGHT_KEY);
      // 默认 ON
      return v !== 'off';
    } catch (e) { return true; }
  }
  function setEnabled(on) {
    try { localStorage.setItem(HIGHLIGHT_KEY, on ? 'on' : 'off'); } catch (e) {}
  }

  // ===== Data load =====
  async function loadEntries() {
    if (loaded) return entries;
    if (loadingPromise) return loadingPromise;
    loadingPromise = (async () => {
      try {
        const r = await fetch('book/_shared/dictionary.json');
        const data = await r.json();
        entries = Array.isArray(data) ? data : [];
        // 索引
        entries.forEach(e => { if (e.id) entryById[e.id] = e; });
        loaded = true;
      } catch (e) {
        console.warn('[DictAnnotator] dictionary.json 加载失败', e);
        entries = [];
      }
      return entries;
    })();
    return loadingPromise;
  }

  // ===== 编译扫描结构 =====
  // 思路：把所有 term 拼成一个大 alternation regex，按长度倒序保证最长匹配优先。
  // 中文不支持 \b 词边界（因为 CJK 不算 \w），但词典里的 term 多数自带分隔（空格 /
  // 中文分词在文本里本来就靠位置）；为了避免误伤"一段长串里挑出短词"，对纯英文
  // term 加 \b 边界，对含 CJK 的 term 不加边界（按字面匹配）。
  // 这样 500 term 一次扫一个 textNode 是 O(n) per node，总 O(N text)。
  function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  function isPureAscii(s) {
    return /^[\x20-\x7E]+$/.test(s);
  }
  // 一些 term 太短（≤1 字）容易撞，跳过。
  function isMatchableTerm(s) {
    if (!s) return false;
    if (s.length < 2) return false;
    return true;
  }

  function compileForLocale(en) {
    const cacheKey = en ? 'en' : 'zh';
    if (compileCache[cacheKey]) return compileCache[cacheKey];

    // 收集"用作匹配的字符串 → entry"映射（每个 entry 可贡献 term_zh + term_en）
    const items = [];
    entries.forEach(e => {
      const candidates = [];
      // 主显示语言优先；同时把另一语言也作为可匹配项（提高命中率）
      if (en) {
        if (e.term_en && isMatchableTerm(e.term_en)) candidates.push(e.term_en);
        if (e.term_zh && isMatchableTerm(e.term_zh)) candidates.push(e.term_zh);
      } else {
        if (e.term_zh && isMatchableTerm(e.term_zh)) candidates.push(e.term_zh);
        if (e.term_en && isMatchableTerm(e.term_en)) candidates.push(e.term_en);
      }
      candidates.forEach(c => items.push({ str: c, id: e.id }));
    });

    // 去重（同一 string 优先保留先出现的，对应当前 locale 的 primary term）
    const seen = Object.create(null);
    const unique = [];
    items.forEach(it => {
      if (!seen[it.str]) { seen[it.str] = it; unique.push(it); }
    });

    // 按长度倒序，长 term 先匹配避免被短 term 抢
    unique.sort((a, b) => b.str.length - a.str.length);

    // 拆成 ascii / cjk 两组：ascii 用 \b 边界，cjk 直接拼接
    const asciiParts = [];
    const cjkParts = [];
    const idMap = Object.create(null); // matched string → id
    unique.forEach(it => {
      idMap[it.str] = it.id;
      if (isPureAscii(it.str)) asciiParts.push(escapeRegex(it.str));
      else cjkParts.push(escapeRegex(it.str));
    });

    // 单一大 regex（用 alternation；JS engine 内部已优化 trie）
    // 注意：捕获组用一个 group；ascii 用 \b 包裹避免命中 substring
    let parts = [];
    if (asciiParts.length) parts.push('\\b(?:' + asciiParts.join('|') + ')\\b');
    if (cjkParts.length) parts.push('(?:' + cjkParts.join('|') + ')');
    const finalRe = parts.length ? new RegExp('(' + parts.join('|') + ')', 'g') : null;

    const compiled = { regex: finalRe, idMap: idMap, count: unique.length };
    compileCache[cacheKey] = compiled;
    return compiled;
  }

  // ===== 标注核心 =====
  function annotateContainer(container) {
    if (!container) return { matched: 0, ms: 0 };
    if (!loaded || !entries.length) return { matched: 0, ms: 0 };
    if (!isEnabled()) return { matched: 0, ms: 0 };

    const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const compiled = compileForLocale(isEn());
    if (!compiled.regex) return { matched: 0, ms: 0 };

    const re = compiled.regex;
    const idMap = compiled.idMap;

    // 1. 收集所有可处理的 textNode（一次 walk）
    const walker = document.createTreeWalker(
      container,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          const tag = parent.tagName;
          // 跳过：代码、链接、标题、已标注 span、已存在 glossary-term
          if (tag === 'CODE' || tag === 'PRE' || tag === 'A' ||
              tag === 'H1' || tag === 'H2' || tag === 'H3' || tag === 'H4' ||
              tag === 'SCRIPT' || tag === 'STYLE') return NodeFilter.FILTER_REJECT;
          if (parent.classList && (
                parent.classList.contains('dict-term') ||
                parent.classList.contains('glossary-term') ||
                parent.classList.contains('chapter-section-item')
              )) return NodeFilter.FILTER_REJECT;
          // 父节点链上有 pre / code 也跳
          if (parent.closest('pre, code, .dict-term, .glossary-term, #chapter-section-nav')) {
            return NodeFilter.FILTER_REJECT;
          }
          // 空 / 纯空白
          if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);

    // 2. 对每个 textNode 跑 union regex；匹配到则切片重建
    let matched = 0;
    for (const node of textNodes) {
      const text = node.nodeValue;
      re.lastIndex = 0;
      // 先快速 test 一下，免得无匹配也走 split 重建
      if (!re.test(text)) continue;
      re.lastIndex = 0;

      const frag = document.createDocumentFragment();
      let lastIdx = 0;
      let m;
      while ((m = re.exec(text)) !== null) {
        const start = m.index;
        const matchedStr = m[1];
        const id = idMap[matchedStr];
        if (start > lastIdx) {
          frag.appendChild(document.createTextNode(text.substring(lastIdx, start)));
        }
        const span = document.createElement('span');
        span.className = 'dict-term';
        span.dataset.termId = id || '';
        span.textContent = matchedStr;
        frag.appendChild(span);
        lastIdx = start + matchedStr.length;
        matched++;
        // 防止零宽匹配死循环
        if (m.index === re.lastIndex) re.lastIndex++;
      }
      if (lastIdx < text.length) {
        frag.appendChild(document.createTextNode(text.substring(lastIdx)));
      }
      const parent = node.parentNode;
      if (parent) parent.replaceChild(frag, node);
    }

    const t1 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const ms = Math.round((t1 - t0) * 100) / 100;
    return { matched, ms };
  }

  // 公共 entry：fetch dict 后再 annotate
  async function annotate(container) {
    await loadEntries();
    const stats = annotateContainer(container);
    if (stats.matched > 0 || stats.ms > 0) {
      try { console.log('[DictAnnotator]', stats.matched, 'terms 标注 ·', stats.ms, 'ms'); } catch (e) {}
    }
    return stats;
  }

  // 移除当前已标注的 span（开关关闭时调用）
  function removeAnnotations(container) {
    if (!container) return;
    container.querySelectorAll('.dict-term').forEach(span => {
      const text = document.createTextNode(span.textContent);
      const parent = span.parentNode;
      if (parent) {
        parent.replaceChild(text, span);
      }
    });
    // 合并相邻 textNode
    container.normalize && container.normalize();
  }

  // ===== Tooltip =====
  let tooltipEl = null;
  let tooltipTimer = null;
  let tooltipForId = null;

  function ensureTooltip() {
    if (tooltipEl) return tooltipEl;
    tooltipEl = document.createElement('div');
    tooltipEl.className = 'dict-tooltip';
    tooltipEl.style.display = 'none';
    document.body.appendChild(tooltipEl);
    // 防止 hover 在 tooltip 上时立刻隐藏
    tooltipEl.addEventListener('mouseenter', () => { if (tooltipTimer) { clearTimeout(tooltipTimer); tooltipTimer = null; } });
    tooltipEl.addEventListener('mouseleave', hideTooltip);
    return tooltipEl;
  }

  function buildTooltipHTML(entry) {
    const en = isEn();
    const lab = L();
    const term1 = en ? (entry.term_en || entry.term_zh) : (entry.term_zh || entry.term_en);
    const term2 = en ? (entry.term_zh || '') : (entry.term_en || '');
    const def = en ? (entry.definition_en || entry.definition_zh) : (entry.definition_zh || entry.definition_en);
    const plain = en ? (entry.plain_explanation_en || entry.plain_explanation_zh) : (entry.plain_explanation_zh || entry.plain_explanation_en);
    const shortDef = def && def.length > 100 ? def.slice(0, 96) + '…' : def;
    return [
      '<div class="dict-tip-head">',
      '  <span class="dict-tip-term">' + escapeHtml(term1 || '') + '</span>',
      term2 ? '  <span class="dict-tip-term-alt">' + escapeHtml(term2) + '</span>' : '',
      '</div>',
      shortDef ? '<div class="dict-tip-def">' + escapeHtml(shortDef) + '</div>' : '',
      plain ? '<div class="dict-tip-plain">' + escapeHtml(plain) + '</div>' : '',
      '<div class="dict-tip-foot">' + escapeHtml(lab.tip_more) + '</div>'
    ].join('');
  }

  function showTooltipFor(target) {
    const id = target.dataset.termId;
    if (!id) return;
    const entry = entryById[id];
    if (!entry) return;
    ensureTooltip();
    tooltipForId = id;
    tooltipEl.innerHTML = buildTooltipHTML(entry);
    tooltipEl.style.display = 'block';
    // 位置：术语下方 + 跟随
    positionTooltip(target);
  }

  function positionTooltip(target) {
    if (!tooltipEl) return;
    const rect = target.getBoundingClientRect();
    const tipRect = tooltipEl.getBoundingClientRect();
    let left = rect.left + (rect.width / 2) - (tipRect.width / 2);
    let top = rect.bottom + 8;
    if (left < 8) left = 8;
    if (left + tipRect.width > window.innerWidth - 8) left = window.innerWidth - tipRect.width - 8;
    // 如果下方放不下放上方
    if (top + tipRect.height > window.innerHeight - 8) {
      top = rect.top - tipRect.height - 8;
    }
    tooltipEl.style.left = left + 'px';
    tooltipEl.style.top = (top + window.scrollY) + 'px';
  }

  function hideTooltip() {
    if (tooltipEl) {
      tooltipEl.style.display = 'none';
      tooltipForId = null;
    }
  }

  function scheduleShowTooltip(target) {
    if (tooltipTimer) clearTimeout(tooltipTimer);
    tooltipTimer = setTimeout(() => {
      if (target && target.isConnected) showTooltipFor(target);
    }, 300);
  }

  function scheduleHideTooltip() {
    if (tooltipTimer) clearTimeout(tooltipTimer);
    tooltipTimer = setTimeout(hideTooltip, 150);
  }

  // ===== Modal =====
  let modalEl = null;
  let modalKeyHandler = null;

  function ensureModal() {
    if (modalEl) return modalEl;
    modalEl = document.createElement('div');
    modalEl.className = 'dict-modal hidden';
    modalEl.innerHTML = '<div class="dict-modal-backdrop"></div><div class="dict-modal-card" role="dialog" aria-modal="true"><button class="dict-modal-close" aria-label="close">&times;</button><div class="dict-modal-body"></div></div>';
    document.body.appendChild(modalEl);
    modalEl.querySelector('.dict-modal-backdrop').addEventListener('click', closeModal);
    modalEl.querySelector('.dict-modal-close').addEventListener('click', closeModal);
    return modalEl;
  }

  function findChapterIdByFile(filePath) {
    if (!filePath || !window.BOOK_STRUCTURE) return null;
    for (const part of window.BOOK_STRUCTURE) {
      for (const ch of part.chapters) {
        if (ch.file === filePath) return ch.id;
      }
    }
    const basename = filePath.split('/').pop();
    for (const part of window.BOOK_STRUCTURE) {
      for (const ch of part.chapters) {
        if (ch.file && ch.file.split('/').pop() === basename) return ch.id;
      }
    }
    return null;
  }

  function buildModalHTML(entry) {
    const en = isEn();
    const lab = L();
    const term1 = en ? (entry.term_en || entry.term_zh) : (entry.term_zh || entry.term_en);
    const term2 = en ? (entry.term_zh || '') : (entry.term_en || '');
    const def = en ? (entry.definition_en || entry.definition_zh) : (entry.definition_zh || entry.definition_en);
    const plain = en ? (entry.plain_explanation_en || entry.plain_explanation_zh) : (entry.plain_explanation_zh || entry.plain_explanation_en);
    const inWB = isInWordbook(entry.id);

    const fa = entry.first_appearance || {};
    const chId = findChapterIdByFile(fa.chapter);
    const jumpBtn = (fa.chapter || chId)
      ? '<button class="dict-modal-jump" data-chapter="' + escapeHtml(chId || '') + '" data-file="' + escapeHtml(fa.chapter || '') + '">' + escapeHtml(lab.jump_chapter) + '</button>'
      : '';

    // see_also
    let seeAlsoHTML = '';
    if (Array.isArray(entry.see_also) && entry.see_also.length) {
      const links = entry.see_also.map(rid => {
        const ref = entryById[rid];
        if (!ref) return '';
        const t = en ? (ref.term_en || ref.term_zh) : (ref.term_zh || ref.term_en);
        return '<button class="dict-modal-related" data-id="' + escapeHtml(rid) + '">' + escapeHtml(t || rid) + '</button>';
      }).filter(Boolean).join(' ');
      if (links) seeAlsoHTML = '<div class="dict-modal-section"><div class="dict-modal-label">' + escapeHtml(lab.see_also) + '</div><div class="dict-modal-related-list">' + links + '</div></div>';
    }

    return [
      '<div class="dict-modal-head">',
      '  <div class="dict-modal-titles">',
      '    <h3 class="dict-modal-term">' + escapeHtml(term1 || '') + '</h3>',
      term2 ? '    <div class="dict-modal-term-alt">' + escapeHtml(term2) + '</div>' : '',
      '  </div>',
      '</div>',
      def ? ('<div class="dict-modal-section"><div class="dict-modal-label">' + escapeHtml(lab.definition) + '</div><p class="dict-modal-def">' + escapeHtml(def) + '</p></div>') : '',
      plain ? ('<div class="dict-modal-section"><div class="dict-modal-label">' + escapeHtml(lab.plain_explanation) + '</div><div class="dict-modal-plain">' + escapeHtml(plain) + '</div></div>') : '',
      seeAlsoHTML,
      '<div class="dict-modal-actions">',
      '  <button class="dict-modal-fav ' + (inWB ? 'added' : '') + '" data-id="' + escapeHtml(entry.id) + '">' + escapeHtml(inWB ? lab.added_wordbook : lab.add_wordbook) + '</button>',
      jumpBtn,
      '</div>'
    ].join('');
  }

  function openModal(id) {
    const entry = entryById[id];
    if (!entry) return;
    ensureModal();
    const body = modalEl.querySelector('.dict-modal-body');
    body.innerHTML = buildModalHTML(entry);
    modalEl.classList.remove('hidden');
    requestAnimationFrame(() => modalEl.classList.add('visible'));

    // 收藏按钮
    const favBtn = body.querySelector('.dict-modal-fav');
    if (favBtn) {
      favBtn.addEventListener('click', () => {
        const added = toggleWordbook(favBtn.dataset.id);
        favBtn.classList.toggle('added', added);
        favBtn.textContent = added ? L().added_wordbook : L().add_wordbook;
        // 通知 dictionary view 同步徽章计数
        if (window.Dictionary && typeof window.Dictionary.refreshWordbookBadge === 'function') {
          window.Dictionary.refreshWordbookBadge();
        }
      });
    }
    // 跳转
    const jumpBtn = body.querySelector('.dict-modal-jump');
    if (jumpBtn) {
      jumpBtn.addEventListener('click', () => {
        const chId = jumpBtn.dataset.chapter;
        if (chId && window.__appShowView && window.__appLoadChapterById) {
          closeModal();
          window.__appShowView('reader');
          window.__appLoadChapterById(chId);
        }
      });
    }
    // 相关词
    body.querySelectorAll('.dict-modal-related').forEach(b => {
      b.addEventListener('click', () => {
        const rid = b.dataset.id;
        if (rid && entryById[rid]) {
          openModal(rid);
        }
      });
    });

    // ESC 关闭
    if (!modalKeyHandler) {
      modalKeyHandler = (e) => { if (e.key === 'Escape') closeModal(); };
      document.addEventListener('keydown', modalKeyHandler);
    }
  }

  function closeModal() {
    if (!modalEl) return;
    modalEl.classList.remove('visible');
    setTimeout(() => modalEl.classList.add('hidden'), 180);
    if (modalKeyHandler) {
      document.removeEventListener('keydown', modalKeyHandler);
      modalKeyHandler = null;
    }
  }

  // ===== 全局事件代理 =====
  function isMobile() {
    return window.matchMedia && window.matchMedia('(max-width: 600px)').matches;
  }

  function bindGlobalEvents() {
    // hover：mouseenter 0.3s 后显示 tooltip
    document.addEventListener('mouseover', (e) => {
      if (isMobile()) return;
      const t = e.target.closest && e.target.closest('.dict-term');
      if (!t) return;
      // 已经在为此 term 显示 tooltip 不重启
      if (tooltipForId === t.dataset.termId && tooltipEl && tooltipEl.style.display === 'block') return;
      scheduleShowTooltip(t);
    });
    document.addEventListener('mouseout', (e) => {
      if (isMobile()) return;
      const t = e.target.closest && e.target.closest('.dict-term');
      if (!t) return;
      // 移到了 tooltip 上不隐藏
      const to = e.relatedTarget;
      if (to && tooltipEl && (tooltipEl === to || tooltipEl.contains(to))) return;
      scheduleHideTooltip();
    });

    // 点击：打开 modal
    document.addEventListener('click', (e) => {
      const t = e.target.closest && e.target.closest('.dict-term');
      if (!t) return;
      // 在移动端 click 也兼任 tooltip
      e.preventDefault();
      hideTooltip();
      const id = t.dataset.termId;
      if (id) openModal(id);
    });

    // 滚动 / 切视图：隐藏 tooltip
    window.addEventListener('scroll', () => { if (tooltipEl && tooltipEl.style.display === 'block') hideTooltip(); }, true);
  }

  // ===== Toggle UI =====
  function injectToggle() {
    // 找主题切换器 — 把 toggle 放在它前面（在语言切换器和主题切换器之间）
    const themeSwitcher = document.querySelector('.cc-theme-switcher');
    if (!themeSwitcher) {
      // theme switcher 还没注入，再延迟重试（最多 5 次 = ~600ms）
      injectToggle._retry = (injectToggle._retry || 0) + 1;
      if (injectToggle._retry < 8) {
        setTimeout(injectToggle, 100);
      } else {
        console.warn('[DictAnnotator] cc-theme-switcher not found after retries; toggle not injected');
      }
      return;
    }
    if (document.querySelector('.cc-dict-highlight-toggle')) return;
    const en = isEn();
    const titleOn = en ? 'Term highlighting: on' : '术语高亮：开';
    const titleOff = en ? 'Term highlighting: off' : '术语高亮：关';
    const aria = en ? 'Toggle term highlighting' : '术语高亮开关';
    const wrap = document.createElement('button');
    wrap.className = 'cc-dict-highlight-toggle';
    wrap.setAttribute('aria-label', aria);
    wrap.innerHTML = '<span class="cc-dict-highlight-icon">📖</span>';
    wrap.title = isEnabled() ? titleOn : titleOff;
    if (isEnabled()) wrap.classList.add('active');
    wrap.addEventListener('click', () => {
      const next = !isEnabled();
      setEnabled(next);
      wrap.classList.toggle('active', next);
      wrap.title = next ? titleOn : titleOff;
      // 重新处理当前 chapter-body
      const body = document.getElementById('chapter-body');
      if (body) {
        if (next) {
          annotate(body);
        } else {
          removeAnnotations(body);
          hideTooltip();
        }
      }
    });
    themeSwitcher.parentNode.insertBefore(wrap, themeSwitcher);
  }

  // ===== util =====
  function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ===== boot =====
  function boot() {
    // 预加载 dictionary（不阻塞）
    loadEntries();
    bindGlobalEvents();
    // toggle 注入：等主题切换器先注入
    setTimeout(injectToggle, 80);
    // 语言切换时重建 toggle 文案 + 清空 compile cache
    window.addEventListener('cc-locale-change', () => {
      Object.keys(compileCache).forEach(k => { delete compileCache[k]; });
      const old = document.querySelector('.cc-dict-highlight-toggle');
      if (old && old.parentNode) old.parentNode.removeChild(old);
      setTimeout(injectToggle, 80);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // 暴露
  window.DictAnnotator = {
    annotate: annotate,
    remove: removeAnnotations,
    isEnabled: isEnabled,
    setEnabled: setEnabled,
    openModal: openModal,
    getWordbook: getWordbook,
    toggleWordbook: toggleWordbook,
    loadEntries: loadEntries,
    getEntryById: function (id) { return entryById[id] || null; },
    getEntries: function () { return entries.slice(); }
  };
})();
