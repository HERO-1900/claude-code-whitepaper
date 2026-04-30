/**
 * Dictionary — 词典
 * 374 条术语词典：分类筛选 + 优先级筛选 + 排序 + A-Z 拼音/字母索引 + 搜索
 * 数据源：book/_shared/dictionary.json
 */
(function () {
  'use strict';

  // ===== State =====
  let entries = [];
  let loaded = false;
  let activeCategory = 'all';
  let activePriority = 'all';
  let activeSort = 'alpha';
  let searchQuery = '';
  let searchScope = 'all';   // 'all' | 'term' | 'definition'
  let searchTimer = null;
  // Phase E：当前 sub-view（main 词典 / wordbook 生词本）
  let activeSubView = 'main';
  let wbSearchQuery = '';
  let wbSearchTimer = null;
  let wbMastered = {};   // {id: true}（localStorage 持久化）

  // ===== i18n helpers =====
  function isEn() {
    try { return (localStorage.getItem('cc-locale') || 'zh') === 'en'; }
    catch (e) { return false; }
  }

  // 类别 中英 label
  const CAT_LABELS_ZH = {
    core_mechanism: '核心机制',
    tool: '工具',
    subsystem: '子系统',
    prompt_pattern: 'Prompt 模式',
    engineering_method: '工程方法',
    protocol: '协议',
    data_concept: '数据概念',
    infra: '基础设施',
    industry_term: '行业术语',
    domain_lang: '领域语言',
    security: '安全'
  };
  const CAT_LABELS_EN = {
    core_mechanism: 'Core Mechanism',
    tool: 'Tool',
    subsystem: 'Subsystem',
    prompt_pattern: 'Prompt Pattern',
    engineering_method: 'Engineering',
    protocol: 'Protocol',
    data_concept: 'Data Concept',
    infra: 'Infrastructure',
    industry_term: 'Industry Term',
    domain_lang: 'Domain Lang',
    security: 'Security'
  };
  const CAT_COLORS = {
    core_mechanism: '#c77d2e',     // 暖橙
    tool: '#4d96ff',               // 蓝
    subsystem: '#9b59b6',          // 紫
    prompt_pattern: '#ff8a5c',     // 粉橙
    engineering_method: '#6bcb77', // 绿
    protocol: '#4dc4d9',           // 青
    data_concept: '#ffd93d',       // 金
    infra: '#8d96a3',              // 灰
    industry_term: '#e57373',      // 红
    domain_lang: '#a78bfa',        // 紫罗兰
    security: '#ff6b6b'            // 红
  };
  const PRIORITY_LABELS_ZH = { 1: 'P1 必学', 2: 'P2 进阶', 3: 'P3 细分' };
  const PRIORITY_LABELS_EN = { 1: 'P1 Essential', 2: 'P2 Advanced', 3: 'P3 Specialized' };

  function CAT_LABELS() { return isEn() ? CAT_LABELS_EN : CAT_LABELS_ZH; }
  function PRIO_LABELS() { return isEn() ? PRIORITY_LABELS_EN : PRIORITY_LABELS_ZH; }

  const UI = {
    zh: {
      filter_all: '全部',
      jump_chapter: '↗ 跳转章节',
      add_wordbook: '⭐ 加入生词本',
      added_wordbook: '★ 已加入',
      first_appearance: '首次出现',
      see_also: '相关',
      mention_count: '出现 {n} 次',
      symbol_label: '#',
      number_label: '0-9',
      // Phase E
      wb_btn: '⭐ 我的生词本',
      wb_back: '← 返回词典',
      wb_title: '⭐ 我的生词本',
      wb_subtitle: '收藏的术语都在这里——可以打印 / 导出 CSV / 导出 Markdown 复习。',
      wb_empty: '生词本是空的。在词典里点击「⭐ 加入生词本」，或在阅读器里点击高亮术语后从弹窗收藏。',
      wb_search_ph: '🔍 搜索生词本...',
      wb_remove: '移除',
      wb_master: '✅ 已掌握',
      wb_master_active: '☑ 已掌握',
      wb_select_all: '全选',
      wb_remove_all: '全部移除',
      wb_export_csv: '导出 CSV',
      wb_export_md: '导出 Markdown',
      wb_print: '打印',
      wb_added_at: '加入于',
      wb_count_unit: '条',
      wb_confirm_clear: '确认清空生词本？这一步无法撤销。',
      wb_cat_label: '类别',
      wb_def_label: '定义',
      wb_plain_label: '通俗',
      wb_filter_all: '全部',
      wb_filter_pending: '待复习',
      wb_filter_mastered: '已掌握',
      wb_review: '📅 复习模式'
    },
    en: {
      filter_all: 'All',
      jump_chapter: '↗ Open Chapter',
      add_wordbook: '⭐ Add to Wordbook',
      added_wordbook: '★ Added',
      first_appearance: 'First appears',
      see_also: 'See also',
      mention_count: '{n} mentions',
      symbol_label: '#',
      number_label: '0-9',
      wb_btn: '⭐ My Wordbook',
      wb_back: '← Back to Dictionary',
      wb_title: '⭐ My Wordbook',
      wb_subtitle: 'Your saved terms — print, export to CSV / Markdown for review.',
      wb_empty: 'Wordbook is empty. Click "⭐ Add to Wordbook" in the dictionary, or save from the term popup in the reader.',
      wb_search_ph: '🔍 Search wordbook...',
      wb_remove: 'Remove',
      wb_master: '✅ Master',
      wb_master_active: '☑ Mastered',
      wb_select_all: 'Select All',
      wb_remove_all: 'Remove All',
      wb_export_csv: 'Export CSV',
      wb_export_md: 'Export Markdown',
      wb_print: 'Print',
      wb_added_at: 'Added',
      wb_count_unit: 'entries',
      wb_confirm_clear: 'Clear the wordbook? This cannot be undone.',
      wb_cat_label: 'Category',
      wb_def_label: 'Definition',
      wb_plain_label: 'Plain',
      wb_filter_all: 'All',
      wb_filter_pending: 'Pending',
      wb_filter_mastered: 'Mastered',
      wb_review: '📅 Review Mode'
    }
  };
  function L() { return isEn() ? UI.en : UI.zh; }

  // ===== Pinyin first-letter for Chinese A-Z index =====
  // 简化版本：覆盖常见汉字首字母。基于 Unicode 区块的近似映射。
  // 不需要 100% 精确——索引只是导航辅助，错位个别字可接受。
  const PINYIN_RANGES = [
    ['a', 0x3041, 0x4E00], // 占位（让首个 binary search 工作）
  ];
  // 简单字符 → 拼音首字母映射（高频汉字示例 + fallback）
  const HANZI_HEAD = (function () {
    // 通过 GB2312 区位的近似法：用一组阈值字符。
    // 资料：https://github.com/sxei/pinyinjs 简化版思路
    // 这里只做 A-Z 大类粗分（足够索引导航用）
    const arr = [
      ['A', '\u554a'], ['B', '\u829d'], ['C', '\u5693'], ['D', '\u5491'],
      ['E', '\u59b8'], ['F', '\u53d1'], ['G', '\u592e'], ['H', '\u54c8'],
      ['J', '\u51fb'], ['K', '\u5494'], ['L', '\u5783'], ['M', '\u5638'],
      ['N', '\u62ff'], ['O', '\u6b27'], ['P', '\u5991'], ['Q', '\u4e03'],
      ['R', '\u7136'], ['S', '\u4ee8'], ['T', '\u4ed6'], ['W', '\u5c72'],
      ['X', '\u5915'], ['Y', '\u4e2b'], ['Z', '\u5e00']
    ];
    return arr;
  })();

  function pinyinHead(ch) {
    if (!ch) return '#';
    const c = ch.charAt(0);
    const code = c.charCodeAt(0);
    // 数字
    if (code >= 0x30 && code <= 0x39) return '0-9';
    // 英文字母
    if (code >= 0x41 && code <= 0x5A) return c.toUpperCase();
    if (code >= 0x61 && code <= 0x7A) return c.toUpperCase();
    // 汉字范围（CJK Unified Ideographs）
    if (code >= 0x4E00 && code <= 0x9FFF) {
      // 用阈值法找到首字母
      let head = 'Z';
      for (let i = HANZI_HEAD.length - 1; i >= 0; i--) {
        if (c.localeCompare(HANZI_HEAD[i][1], 'zh-Hans-CN') >= 0) {
          head = HANZI_HEAD[i][0];
          break;
        }
      }
      return head;
    }
    // 其他符号
    return '#';
  }

  function entryHead(entry) {
    if (isEn()) {
      const t = (entry.term_en || '').replace(/^[^A-Za-z0-9]+/, '');
      const c = t.charAt(0);
      if (!c) return '#';
      const code = c.charCodeAt(0);
      if (code >= 0x30 && code <= 0x39) return '0-9';
      if (/[A-Za-z]/.test(c)) return c.toUpperCase();
      return '#';
    }
    // 中文模式：去掉前导符号
    const t = (entry.term_zh || '').replace(/^[\/\u002F\s]+/, '');
    return pinyinHead(t);
  }

  // ===== Wordbook (LocalStorage) =====
  // 兼容两种格式：
  //   旧格式 ["id1", "id2"]（仅 id 列表）
  //   新格式 [{id, addedAt}, ...]（带时间戳）
  // 内部统一返回 [{id, addedAt}]，回写时也用新格式（首次写入旧数据自动迁移）
  const WORDBOOK_KEY = 'cc-dict-wordbook';
  const MASTERED_KEY = 'cc-dict-mastered';
  const SRS_KEY = 'cc-dict-srs';   // B7 · SRS 复习状态

  function getWordbookRaw() {
    try { return JSON.parse(localStorage.getItem(WORDBOOK_KEY) || '[]'); }
    catch (e) { return []; }
  }
  // 兼容层：把 raw 解析成 [{id, addedAt}]
  function getWordbookEntries() {
    const raw = getWordbookRaw();
    return raw.map(item => {
      if (typeof item === 'string') return { id: item, addedAt: 0 };
      return { id: item.id, addedAt: item.addedAt || 0 };
    });
  }
  // 旧 API：返回 id 列表（兼容卡片视图的 indexOf 检查）
  function getWordbook() {
    return getWordbookEntries().map(e => e.id);
  }
  function setWordbookEntries(arr) {
    try { localStorage.setItem(WORDBOOK_KEY, JSON.stringify(arr)); } catch (e) {}
  }
  function toggleWordbook(id) {
    const list = getWordbookEntries();
    const idx = list.findIndex(e => e.id === id);
    if (idx >= 0) {
      list.splice(idx, 1);
    } else {
      list.push({ id: id, addedAt: Date.now() });
    }
    setWordbookEntries(list);
    return list.findIndex(e => e.id === id) >= 0;
  }

  function getMasteredMap() {
    try { return JSON.parse(localStorage.getItem(MASTERED_KEY) || '{}'); }
    catch (e) { return {}; }
  }
  function setMasteredMap(m) {
    try { localStorage.setItem(MASTERED_KEY, JSON.stringify(m)); } catch (e) {}
  }
  function toggleMastered(id) {
    const m = getMasteredMap();
    if (m[id]) delete m[id];
    else m[id] = Date.now();
    setMasteredMap(m);
    return !!m[id];
  }

  // ===== B7 · SRS（艾宾浩斯简化版 SM-2）=====
  function getSrsMap() {
    try { return JSON.parse(localStorage.getItem(SRS_KEY) || '{}'); }
    catch (e) { return {}; }
  }
  function setSrsMap(m) {
    try { localStorage.setItem(SRS_KEY, JSON.stringify(m)); } catch (e) {}
  }
  // 难度：'again'（忘了 / 重置）/ 'good'（会）/ 'easy'（简单）
  // 返回更新后的 card state
  function srsUpdate(id, grade) {
    const map = getSrsMap();
    const cur = map[id] || { ease: 2.5, interval: 0, reps: 0, lastReview: 0, nextReview: 0 };
    let { ease, interval, reps } = cur;
    if (grade === 'again') {
      reps = 0;
      interval = 0.04;       // ~1 hour
      ease = Math.max(1.3, ease - 0.2);
    } else if (grade === 'good') {
      reps += 1;
      interval = reps === 1 ? 1 : reps === 2 ? 3 : Math.round((interval || 1) * ease);
    } else if (grade === 'easy') {
      reps += 1;
      interval = Math.round((interval || 1) * ease * 1.3);
      ease = Math.min(3.0, ease + 0.15);
    }
    const now = Date.now();
    const next = { ease, interval, reps, lastReview: now, nextReview: now + interval * 86400000 };
    map[id] = next;
    setSrsMap(map);
    return next;
  }
  // 返回到期需复习的 entry id 列表（生词本范围内）
  function getDueIds() {
    const wb = getWordbookEntries();
    const srs = getSrsMap();
    const now = Date.now();
    return wb.filter(w => {
      const c = srs[w.id];
      if (!c) return true;             // 从未复习过 → 到期
      return c.nextReview <= now;
    }).map(w => w.id);
  }

  // ===== Chapter mapping =====
  // 兼容多种 first_appearance 格式（v2 增强 2026-04-30）：
  //   1) 完整路径 'part2_xxx/06_xxx.md' → 直接匹配 ch.file
  //   2) 短代号 'ch11' / 'ch07' → 匹配 chapter number
  //   3) 章节关键词如 '20_PromptCache' → 模糊匹配 ch.file 或 ch.title
  //   4) entry 也可基于 system_section 字段做兜底
  function findChapterIdByFile(filePath, entry) {
    if (!window.BOOK_STRUCTURE) return null;
    if (filePath) {
      // 1. 精确路径匹配
      for (const part of window.BOOK_STRUCTURE) {
        for (const ch of part.chapters) {
          if (ch.file === filePath) return ch.id;
        }
      }
      // 2. basename 匹配（不同 part 重命名时）
      const basename = filePath.split('/').pop();
      for (const part of window.BOOK_STRUCTURE) {
        for (const ch of part.chapters) {
          if (ch.file && ch.file.split('/').pop() === basename) return ch.id;
        }
      }
      // 3. 短代号 'ch11' / 'ch07' → 匹配第 N 章（part2 / part3）
      const chMatch = filePath.match(/^ch(\d+)$/i);
      if (chMatch) {
        const num = parseInt(chMatch[1], 10).toString().padStart(2, '0');
        // 优先 part3 子系统 (id p4-{n}) 再 part2 (id p2-{n})
        for (const part of window.BOOK_STRUCTURE) {
          for (const ch of part.chapters) {
            if (ch.file && new RegExp(`/${num}_`).test(ch.file)) return ch.id;
          }
        }
      }
      // 4. 关键词模糊匹配（如 '20_PromptCache' / 'Sandbox' / '权限'）
      const keyword = filePath.replace(/\.md$/, '').replace(/^.*\//, '').toLowerCase();
      for (const part of window.BOOK_STRUCTURE) {
        for (const ch of part.chapters) {
          if (!ch.file) continue;
          const chLower = ch.file.toLowerCase();
          const titleLower = (ch.title || '').toLowerCase();
          if (chLower.includes(keyword) || titleLower.includes(keyword)) return ch.id;
        }
      }
    }
    // 5. entry.system_section 兜底
    const sys = entry && (entry.system_section || '');
    if (sys) {
      // 比如 '20_PromptCache可观测性'
      for (const part of window.BOOK_STRUCTURE) {
        for (const ch of part.chapters) {
          if (!ch.file) continue;
          if (ch.file.includes(sys) || (ch.title || '').includes(sys.replace(/^\d+_/, ''))) return ch.id;
        }
      }
    }
    return null;
  }

  // ===== Init =====
  async function init() {
    if (loaded) return;
    try {
      const r = await fetch('book/_shared/dictionary.json');
      entries = await r.json();
      loaded = true;
    } catch (e) {
      console.warn('[Dictionary] 加载失败', e);
      entries = [];
    }
  }

  // ===== Filter / Sort =====
  function applyFilters() {
    let list = entries.slice();
    if (activeCategory !== 'all') {
      list = list.filter(e => e.category === activeCategory);
    }
    if (activePriority !== 'all') {
      list = list.filter(e => String(e.priority) === String(activePriority));
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      // 计算每条 entry 的匹配分（用于相关度排序），同时根据 scope 过滤
      list.forEach(e => {
        const tZ = (e.term_zh || '').toLowerCase();
        const tE = (e.term_en || '').toLowerCase();
        const dZ = (e.definition_zh || '').toLowerCase();
        const dE = (e.definition_en || '').toLowerCase();
        const pZ = (e.plain_explanation_zh || '').toLowerCase();
        const pE = (e.plain_explanation_en || '').toLowerCase();
        let score = 0;
        // term 完全等于 → 1000；以 q 开头 → 500；包含 → 200
        if (tZ === q || tE === q) score = 1000;
        else if (tZ.startsWith(q) || tE.startsWith(q)) score = 500;
        else if (tZ.includes(q) || tE.includes(q)) score = 200;
        // definition 含 → 50；plain 含 → 30
        const inDef = dZ.includes(q) || dE.includes(q);
        const inPlain = pZ.includes(q) || pE.includes(q);
        if (inDef) score += 50;
        if (inPlain) score += 30;
        e.__searchScore = score;
        e.__inTerm = score >= 200;
        e.__inDef = inDef || inPlain;
      });
      list = list.filter(e => {
        if (searchScope === 'term') return e.__inTerm;
        // 修复：仅释义 = 在释义/通俗里命中 但词条不命中（互斥语义，三档真正不同）
        if (searchScope === 'definition') return e.__inDef && !e.__inTerm;
        return e.__searchScore > 0;  // all
      });
    }
    // 有搜索时优先按相关度排序（覆盖 activeSort），命中 term 的排在前面
    if (searchQuery) {
      list.sort((a, b) => (b.__searchScore || 0) - (a.__searchScore || 0));
      return list;
    }
    // 排序
    if (activeSort === 'alpha') {
      const en = isEn();
      list.sort((a, b) => {
        const sa = en ? (a.term_en || a.term_zh || '') : (a.term_zh || a.term_en || '');
        const sb = en ? (b.term_en || b.term_zh || '') : (b.term_zh || b.term_en || '');
        return sa.localeCompare(sb, en ? 'en' : 'zh-Hans-CN');
      });
    } else if (activeSort === 'section') {
      list.sort((a, b) => (a.system_section || '').localeCompare(b.system_section || '', 'zh-Hans-CN'));
    } else if (activeSort === 'priority') {
      list.sort((a, b) => (a.priority || 99) - (b.priority || 99));
    } else if (activeSort === 'mention') {
      list.sort((a, b) => (b.mention_count || 0) - (a.mention_count || 0));
    }
    return list;
  }

  // ===== B10 · Concept map（焦点 + 二级关联）=====
  function showConceptMap(focalId) {
    const en = isEn();
    const focal = entries.find(e => e.id === focalId);
    if (!focal) return;
    // 一级邻居
    const lvl1 = (focal.see_also || []).filter(id => entries.find(e => e.id === id && !e._suppressed));
    // 二级邻居（去重 + 排除自身和一级）
    const lvl2Set = new Set();
    lvl1.forEach(id => {
      const e = entries.find(x => x.id === id);
      if (!e || !e.see_also) return;
      e.see_also.forEach(id2 => {
        if (id2 === focalId) return;
        if (lvl1.indexOf(id2) >= 0) return;
        if (!entries.find(x => x.id === id2 && !x._suppressed)) return;
        lvl2Set.add(id2);
      });
    });
    const lvl2 = Array.from(lvl2Set).slice(0, 12);  // 最多 12 个二级，避免视觉拥挤

    // 移除已存在
    let overlay = document.getElementById('dict-graph-overlay');
    if (overlay) overlay.remove();
    overlay = document.createElement('div');
    overlay.id = 'dict-graph-overlay';
    overlay.className = 'dict-graph-overlay';

    // 重设计：放弃圆圈 SVG → 改用纯 HTML/CSS 卡片层级布局，避免文字溢出 + 提升可读性
    const focalLabel = en ? (focal.term_en || focal.term_zh) : (focal.term_zh || focal.term_en);
    const focalDef = en ? (focal.definition_en || focal.definition_zh) : (focal.definition_zh || focal.definition_en);

    const lvl1Cards = lvl1.map(id => {
      const e = entries.find(x => x.id === id);
      const lab = e ? (en ? (e.term_en || e.term_zh) : (e.term_zh || e.term_en)) : id;
      const def = e ? (en ? (e.definition_en || e.definition_zh) : (e.definition_zh || e.definition_en)) : '';
      const def0 = def ? (def.length > 60 ? def.slice(0, 58) + '…' : def) : '';
      return `<div class="dict-graph-card lvl1" data-id="${escapeHtml(id)}">
        <div class="dict-graph-card-term">${escapeHtml(lab || id)}</div>
        ${def0 ? `<div class="dict-graph-card-def">${escapeHtml(def0)}</div>` : ''}
      </div>`;
    }).join('');

    const lvl2Cards = lvl2.map(id => {
      const e = entries.find(x => x.id === id);
      const lab = e ? (en ? (e.term_en || e.term_zh) : (e.term_zh || e.term_en)) : id;
      return `<a class="dict-graph-chip lvl2" data-id="${escapeHtml(id)}" href="#dict-${escapeHtml(id)}">${escapeHtml(lab || id)}</a>`;
    }).join('');

    const headerLab = en ? `Related Concepts` : `关系图`;
    const hint = en
      ? 'Click direct links to refocus · ESC to close'
      : '点击直接关联可重新聚焦 · ESC 关闭';

    overlay.innerHTML = `
      <div class="dict-graph-modal-v2">
        <div class="dict-graph-head">
          <h3>${escapeHtml(headerLab)}</h3>
          <button class="dict-graph-close" aria-label="close">✕</button>
        </div>
        <div class="dict-graph-focal">
          <div class="dict-graph-focal-label">${escapeHtml(en ? 'Focus' : '当前词条')}</div>
          <div class="dict-graph-focal-term">${escapeHtml(focalLabel || focalId)}</div>
          ${focalDef ? `<div class="dict-graph-focal-def">${escapeHtml(focalDef.length > 120 ? focalDef.slice(0, 118) + '…' : focalDef)}</div>` : ''}
        </div>
        ${lvl1Cards ? `
          <div class="dict-graph-section">
            <div class="dict-graph-section-head">
              <span class="dict-graph-bullet bullet-lvl1"></span>
              <span class="dict-graph-section-title">${escapeHtml(en ? 'Direct (1st level)' : '直接关联（一级）')}</span>
              <span class="dict-graph-section-count">${lvl1.length}</span>
            </div>
            <div class="dict-graph-cards">${lvl1Cards}</div>
          </div>` : `<p class="dict-graph-empty">${escapeHtml(en ? 'No direct relations.' : '暂无直接关联词条。')}</p>`}
        ${lvl2Cards ? `
          <div class="dict-graph-section">
            <div class="dict-graph-section-head">
              <span class="dict-graph-bullet bullet-lvl2"></span>
              <span class="dict-graph-section-title">${escapeHtml(en ? 'Indirect (2nd level)' : '间接关联（二级）')}</span>
              <span class="dict-graph-section-count">${lvl2.length}</span>
            </div>
            <div class="dict-graph-chips">${lvl2Cards}</div>
          </div>` : ''}
        <p class="dict-graph-hint">${escapeHtml(hint)}</p>
      </div>
    `;
    document.body.appendChild(overlay);

    function close() { overlay.remove(); document.removeEventListener('keydown', onKey); }
    function onKey(ev) { if (ev.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('.dict-graph-close').addEventListener('click', close);

    // 点 lvl1 card → 重新聚焦 + 不关闭模态
    overlay.querySelectorAll('.dict-graph-card.lvl1').forEach(g => {
      g.addEventListener('click', () => {
        const newId = g.dataset.id;
        if (newId && newId !== focalId) {
          close();
          showConceptMap(newId);
        }
      });
    });
    // 点 lvl2 chip → 关闭 + 跳词典 deep-link
    overlay.querySelectorAll('.dict-graph-chip.lvl2').forEach(g => {
      g.addEventListener('click', () => { close(); /* href 默认行为继续 */ });
    });
  }

  // ===== B9 helpers · 复制链接 + toast =====
  function fallbackCopy(text) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    } catch (e) {}
  }
  function showDictToast(msg) {
    let t = document.getElementById('dict-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'dict-toast';
      t.className = 'dict-toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('visible');
    if (showDictToast.tmr) clearTimeout(showDictToast.tmr);
    showDictToast.tmr = setTimeout(() => { t.classList.remove('visible'); }, 1200);
  }

  // ===== Render =====
  function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function renderFilters() {
    const en = isEn();
    const labels = CAT_LABELS();
    const prioLabels = PRIO_LABELS();

    // 类别 chips
    const catContainer = document.getElementById('dict-cat-filters');
    if (catContainer) {
      // 计算每类数量
      const counts = { all: entries.length };
      entries.forEach(e => { counts[e.category] = (counts[e.category] || 0) + 1; });
      const catKeys = Object.keys(labels).filter(k => counts[k]); // 只显示有数据的类别
      const allLabel = L().filter_all;
      catContainer.innerHTML = `<button class="dict-chip ${activeCategory === 'all' ? 'active' : ''}" data-cat="all">${allLabel} <span class="dict-chip-count">${counts.all}</span></button>` +
        catKeys.map(k => {
          const color = CAT_COLORS[k] || '#888';
          return `<button class="dict-chip ${activeCategory === k ? 'active' : ''}" data-cat="${k}" style="--chip-color:${color};">${escapeHtml(labels[k] || k)} <span class="dict-chip-count">${counts[k] || 0}</span></button>`;
        }).join('');
      catContainer.querySelectorAll('.dict-chip').forEach(btn => {
        btn.addEventListener('click', () => {
          activeCategory = btn.dataset.cat;
          renderFilters();
          renderList();
        });
      });
    }

    // 优先级 select（v2: 不再用 chip 而是 select 与 sort 同行）
    const prioSelect = document.getElementById('dict-prio-select');
    if (prioSelect) {
      // 同步当前值
      if (prioSelect.value !== String(activePriority)) prioSelect.value = String(activePriority);
      // 更新 option 标签上的计数（如果不需要可去掉这步）
      const pcounts = { all: entries.length, 1: 0, 2: 0, 3: 0 };
      entries.forEach(e => { pcounts[e.priority] = (pcounts[e.priority] || 0) + 1; });
      // 不缓存 baseLab：i18n.apply 之后 textContent 已是当前语言，直接 strip 末尾计数
      // 修复 EN 模式 select 还是中文（旧 dataset.label 缓存了 ZH 文案）
      Array.from(prioSelect.options).forEach(opt => {
        const v = opt.value;
        const baseLab = opt.textContent.replace(/\s*\(\d+\)\s*$/, '');
        const n = v === 'all' ? pcounts.all : (pcounts[v] || 0);
        opt.textContent = baseLab + ' (' + n + ')';
      });
    }
  }

  function renderIndex(filtered) {
    const indexEl = document.getElementById('dict-index');
    if (!indexEl) return;
    // 按当前结果集统计每个 head
    const heads = {};
    filtered.forEach(e => {
      const h = entryHead(e);
      heads[h] = (heads[h] || 0) + 1;
    });
    // 字母全集（A-Z + 0-9 + #）
    const ALL = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z','0-9','#'];
    indexEl.innerHTML = ALL.map(letter => {
      const has = heads[letter];
      return `<button class="dict-index-letter ${has ? '' : 'disabled'}" data-letter="${letter}" ${has ? '' : 'disabled'}>${letter === '0-9' ? '0-9' : (letter === '#' ? '#' : letter)}</button>`;
    }).join('');
    indexEl.querySelectorAll('.dict-index-letter').forEach(btn => {
      btn.addEventListener('click', () => {
        const letter = btn.dataset.letter;
        const target = document.querySelector('.dict-section[data-letter="' + CSS.escape(letter) + '"]');
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    });
  }

  // B10 · see_also chips + 关系图按钮
  function renderSeeAlsoChips(entry) {
    const see = (entry.see_also || []).filter(id => entries.find(e => e.id === id && !e._suppressed));
    if (!see.length) return '';
    const en = isEn();
    const label = en ? '🔗 Related' : '🔗 关联';
    const chips = see.slice(0, 6).map(id => {
      const e = entries.find(x => x.id === id);
      const txt = e ? (en ? (e.term_en || e.term_zh) : (e.term_zh || e.term_en)) : id;
      return `<a class="dict-seealso-chip" href="#dict-${escapeHtml(id)}" data-dict-id="${escapeHtml(id)}">${escapeHtml(txt || id)}</a>`;
    }).join('');
    const more = see.length > 6 ? `<span class="dict-seealso-more">+${see.length - 6}</span>` : '';
    const graphBtn = `<button class="dict-graph-btn" data-id="${escapeHtml(entry.id)}" title="${en ? 'Show concept map' : '展开关系图'}">🕸️ ${escapeHtml(en ? 'Map' : '关系图')}</button>`;
    return `<div class="dict-seealso"><span class="dict-seealso-label">${label}</span><div class="dict-seealso-chips">${chips}${more}${graphBtn}</div></div>`;
  }

  function renderCard(entry) {
    const en = isEn();
    const lab = L();
    const cat = entry.category;
    const catLabel = (CAT_LABELS()[cat] || cat);
    const catColor = CAT_COLORS[cat] || '#888';
    const prio = entry.priority || 2;
    const prioLabel = (PRIO_LABELS()[prio] || ('P' + prio));
    const term1 = en ? (entry.term_en || entry.term_zh) : (entry.term_zh || entry.term_en);
    const term2 = en ? (entry.term_zh || '') : (entry.term_en || '');
    const def = en ? (entry.definition_en || entry.definition_zh) : (entry.definition_zh || entry.definition_en);
    const plain = en ? (entry.plain_explanation_en || entry.plain_explanation_zh) : (entry.plain_explanation_zh || entry.plain_explanation_en);
    const wordbook = getWordbook();
    const inWordbook = wordbook.indexOf(entry.id) >= 0;

    // 跳转章节（兼容 first_appearance 是字符串或对象）
    let faChapter = '';
    const fa = entry.first_appearance;
    if (typeof fa === 'string') faChapter = fa;
    else if (fa && typeof fa === 'object') faChapter = fa.chapter || '';
    const chId = findChapterIdByFile(faChapter, entry);
    const chHTML = chId
      ? `<button class="dict-jump" data-chapter="${escapeHtml(chId)}" title="跳转到章节">${lab.jump_chapter}</button>`
      : '';

    const suppressed = !!entry._suppressed;
    const copyTitle = en ? 'Copy link' : '复制链接';
    return `<article class="dict-card${suppressed ? ' dict-card-suppressed' : ''}" data-id="${escapeHtml(entry.id)}" id="dict-${escapeHtml(entry.id)}">
      <header class="dict-card-head">
        <div class="dict-card-titles">
          <div class="dict-term-primary">${escapeHtml(term1 || '')}</div>
          ${term2 ? `<div class="dict-term-secondary">${escapeHtml(term2)}</div>` : ''}
        </div>
        <div class="dict-card-badges">
          <span class="dict-badge dict-cat-badge" style="--chip-color:${catColor};">${escapeHtml(catLabel)}</span>
          <span class="dict-badge dict-prio-badge prio-${prio}">${escapeHtml(prioLabel)}</span>
          ${entry.mention_count ? `<span class="dict-badge dict-count-badge" title="${escapeHtml(lab.mention_count.replace('{n}', entry.mention_count))}">×${entry.mention_count}</span>` : ''}
          ${suppressed ? `<span class="dict-badge dict-supp-badge" title="正文中未直接出现该字面术语，作概念条目保留">概念条</span>` : ''}
        </div>
      </header>

      ${def ? `<p class="dict-def">${escapeHtml(def)}</p>` : ''}
      ${plain ? `<div class="dict-plain">${escapeHtml(plain)}</div>` : ''}
      ${renderSeeAlsoChips(entry)}

      <footer class="dict-card-foot">
        <div class="dict-card-foot-left">
          ${chHTML}
        </div>
        <div class="dict-card-foot-right">
          <button class="dict-link-btn" data-id="${escapeHtml(entry.id)}" title="${escapeHtml(en ? 'Copy share link' : '复制此词条的分享链接')}" aria-label="${escapeHtml(copyTitle)}">🔗 ${escapeHtml(copyTitle)}</button>
          <button class="dict-fav ${inWordbook ? 'added' : ''}" data-id="${escapeHtml(entry.id)}">
            ${inWordbook ? lab.added_wordbook : lab.add_wordbook}
          </button>
        </div>
      </footer>
    </article>`;
  }

  function renderList() {
    const list = applyFilters();
    const listEl = document.getElementById('dict-list');
    const emptyEl = document.getElementById('dict-empty');
    const shownEl = document.getElementById('dict-shown-count');
    const totalEl = document.getElementById('dict-total-count');
    if (totalEl) totalEl.textContent = entries.length;
    if (shownEl) shownEl.textContent = list.length;
    if (!listEl) return;

    if (list.length === 0) {
      listEl.innerHTML = '';
      if (emptyEl) emptyEl.classList.remove('hidden');
      renderIndex([]);
      return;
    } else {
      if (emptyEl) emptyEl.classList.add('hidden');
    }

    // 分组（按 head 或排序结果分段）
    if (activeSort === 'alpha') {
      const groups = {};
      const order = [];
      list.forEach(e => {
        const h = entryHead(e);
        if (!groups[h]) { groups[h] = []; order.push(h); }
        groups[h].push(e);
      });
      const sortedHeads = order.sort((a, b) => {
        // 先字母后数字后符号
        const norm = x => x === '0-9' ? '\uff00' : (x === '#' ? '\uff01' : x);
        return norm(a).localeCompare(norm(b));
      });
      listEl.innerHTML = sortedHeads.map(h => {
        return `<section class="dict-section" data-letter="${escapeHtml(h)}">
          <h2 class="dict-section-head">${escapeHtml(h)} <span class="dict-section-count">${groups[h].length}</span></h2>
          <div class="dict-section-grid">${groups[h].map(renderCard).join('')}</div>
        </section>`;
      }).join('');
    } else {
      listEl.innerHTML = `<div class="dict-section-grid">${list.map(renderCard).join('')}</div>`;
    }

    renderIndex(list);

    // wire up 关系图按钮（B10）
    listEl.querySelectorAll('.dict-graph-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const id = btn.dataset.id;
        if (id) showConceptMap(id);
      });
    });

    // wire up 复制链接（B9 deep-link）
    listEl.querySelectorAll('.dict-link-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        if (!id) return;
        const url = (location.origin === 'https://insidecc.dev' || location.protocol === 'https:')
          ? (location.origin + '/#dict-' + id)
          : ('https://insidecc.dev/#dict-' + id);
        const onCopied = () => {
          showDictToast(isEn() ? 'Link copied ✓' : '链接已复制 ✓');
        };
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(url).then(onCopied).catch(() => {
              fallbackCopy(url); onCopied();
            });
          } else {
            fallbackCopy(url); onCopied();
          }
        } catch (err) {
          fallbackCopy(url); onCopied();
        }
      });
    });

    // wire up jump chapter
    listEl.querySelectorAll('.dict-jump').forEach(btn => {
      btn.addEventListener('click', () => {
        const chId = btn.dataset.chapter;
        if (chId && window.__appShowView && window.__appLoadChapterById) {
          window.__appShowView('reader');
          window.__appLoadChapterById(chId);
        } else {
          // 没匹配到对应 chapter，给个提示（极少数情况）
          btn.textContent = '⚠ 未找到对应章节';
          setTimeout(() => { btn.textContent = L().jump_chapter; }, 1800);
        }
      });
    });

    // wire up wordbook toggle
    listEl.querySelectorAll('.dict-fav').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const added = toggleWordbook(id);
        btn.classList.toggle('added', added);
        btn.textContent = added ? L().added_wordbook : L().add_wordbook;
        // 即时刷新顶部生词本徽章计数（用户反馈需要立刻跳动）
        refreshWordbookBadge();
        // 通知其他组件（章节内 popup / annotator）— 用 storage 事件 + 自定义事件
        try { window.dispatchEvent(new CustomEvent('cc-wordbook-changed', { detail: { id, added }})); } catch(e){}
      });
    });
  }

  function bindToolbar() {
    const search = document.getElementById('dict-search');
    if (search && !search.__bound) {
      search.__bound = true;
      search.addEventListener('input', () => {
        if (searchTimer) clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
          searchQuery = search.value.trim();
          renderList();
        }, 300);
      });
    }
    const scope = document.getElementById('dict-search-scope');
    if (scope && !scope.__bound) {
      scope.__bound = true;
      scope.addEventListener('change', () => {
        searchScope = scope.value;
        renderList();
      });
    }
    const sort = document.getElementById('dict-sort');
    if (sort && !sort.__bound) {
      sort.__bound = true;
      sort.addEventListener('change', () => {
        activeSort = sort.value;
        renderList();
      });
    }
    // 优先级 select（v2 移到 toolbar 与 sort 同行）
    const prioSel = document.getElementById('dict-prio-select');
    if (prioSel && !prioSel.__bound) {
      prioSel.__bound = true;
      prioSel.addEventListener('change', () => {
        activePriority = prioSel.value;
        renderFilters();
        renderList();
      });
    }
  }

  // ===== Phase E: Wordbook badge + subview =====
  function ensureWordbookBadge() {
    const headerRow = document.querySelector('#dictionary .dict-title-row');
    if (!headerRow) return null;
    let btn = document.getElementById('dict-wordbook-btn');
    if (btn) return btn;
    btn = document.createElement('button');
    btn.id = 'dict-wordbook-btn';
    btn.className = 'dict-wordbook-btn';
    btn.addEventListener('click', () => {
      activeSubView = activeSubView === 'wordbook' ? 'main' : 'wordbook';
      renderSubview();
    });
    headerRow.appendChild(btn);
    return btn;
  }
  function refreshWordbookBadge() {
    const btn = ensureWordbookBadge();
    if (!btn) return;
    const lab = L();
    const count = getWordbookEntries().length;
    const isWB = activeSubView === 'wordbook';
    btn.textContent = isWB ? lab.wb_back : (lab.wb_btn + ' (' + count + ')');
    btn.classList.toggle('active', isWB);
  }

  function renderSubview() {
    const mainView = document.querySelector('#dictionary .dict-toolbar');
    const mainBody = document.querySelector('#dictionary .dict-body');
    let wb = document.getElementById('dict-wordbook-view');
    let rv = document.getElementById('dict-review-view');
    if (activeSubView === 'wordbook' || activeSubView === 'review') {
      if (mainView) mainView.classList.add('hidden');
      if (mainBody) mainBody.classList.add('hidden');
    } else {
      if (mainView) mainView.classList.remove('hidden');
      if (mainBody) mainBody.classList.remove('hidden');
    }
    if (activeSubView === 'wordbook') {
      if (rv) rv.remove();
      if (!wb) {
        wb = document.createElement('div');
        wb.id = 'dict-wordbook-view';
        wb.className = 'dict-wordbook-view';
        const container = document.getElementById('dictionary-container');
        if (container) container.appendChild(wb);
      }
      renderWordbookView(wb);
    } else if (activeSubView === 'review') {
      if (wb) wb.remove();
      if (!rv) {
        rv = document.createElement('div');
        rv.id = 'dict-review-view';
        rv.className = 'dict-review-view';
        const container = document.getElementById('dictionary-container');
        if (container) container.appendChild(rv);
      }
      // B7 v2 修复：每次进入复习都重算 due 队列（防止用户加新词后看不到）
      reviewQueue = null;
      renderReviewView(rv);
    } else {
      if (wb) wb.remove();
      if (rv) rv.remove();
    }
    refreshWordbookBadge();
  }

  // ===== B7 · Review subview =====
  let reviewQueue = null;     // 当前到期 id 列表
  let reviewIdx = 0;
  let reviewRevealed = false;
  let reviewSummary = { again: 0, good: 0, easy: 0, total: 0 };

  function renderReviewView(root) {
    const lab = L();
    const en = isEn();
    if (reviewQueue == null) {
      // 首次进入 → 计算到期队列 + 打乱顺序
      reviewQueue = getDueIds();
      // 简单打乱（避免每次同一顺序）
      for (let i = reviewQueue.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [reviewQueue[i], reviewQueue[j]] = [reviewQueue[j], reviewQueue[i]];
      }
      reviewIdx = 0;
      reviewRevealed = false;
      reviewSummary = { again: 0, good: 0, easy: 0, total: reviewQueue.length };
    }

    const total = reviewSummary.total;
    const back = '<button class="review-back" id="review-back">← ' + escapeHtml(en ? 'Back to Wordbook' : '返回生词本') + '</button>';

    if (total === 0) {
      root.innerHTML =
        back +
        '<div class="review-empty">' +
        '  <div class="review-empty-icon">🎉</div>' +
        '  <h2>' + escapeHtml(en ? 'Nothing due!' : '暂无到期复习') + '</h2>' +
        '  <p>' + escapeHtml(en ? 'All caught up. Add more words or come back later.' : '都背过啦。加新词或稍后再来。') + '</p>' +
        '</div>';
      bindReviewBack(root);
      return;
    }

    if (reviewIdx >= reviewQueue.length) {
      // 全部完成 → summary
      const dist = reviewSummary;
      root.innerHTML =
        back +
        '<div class="review-done">' +
        '  <div class="review-done-icon">✅</div>' +
        '  <h2>' + escapeHtml(en ? 'Session complete' : '本轮完成') + '</h2>' +
        '  <p class="review-done-stats">' +
        '    <span class="review-stat-pill review-stat-again">' + dist.again + ' ' + escapeHtml(en ? 'forgot' : '忘了') + '</span>' +
        '    <span class="review-stat-pill review-stat-good">' + dist.good + ' ' + escapeHtml(en ? 'good' : '会') + '</span>' +
        '    <span class="review-stat-pill review-stat-easy">' + dist.easy + ' ' + escapeHtml(en ? 'easy' : '简单') + '</span>' +
        '  </p>' +
        '  <p class="review-done-tip">' + escapeHtml(en ? 'Next due cards will be scheduled per Ebbinghaus.' : '下一批到期会按艾宾浩斯曲线自动排期。') + '</p>' +
        '  <button class="review-action review-action-primary" id="review-restart">' + escapeHtml(en ? 'Review again' : '再来一轮') + '</button>' +
        '</div>';
      bindReviewBack(root);
      const restart = document.getElementById('review-restart');
      if (restart) restart.addEventListener('click', () => {
        reviewQueue = null;
        renderReviewView(root);
      });
      return;
    }

    const id = reviewQueue[reviewIdx];
    const e = entries.find(x => x.id === id);
    if (!e) {
      // 跳过坏数据
      reviewIdx++;
      renderReviewView(root);
      return;
    }
    const term1 = en ? (e.term_en || e.term_zh) : (e.term_zh || e.term_en);
    const term2 = en ? (e.term_zh || '') : (e.term_en || '');
    const def = en ? (e.definition_en || e.definition_zh) : (e.definition_zh || e.definition_en);
    const plain = en ? (e.plain_explanation_en || e.plain_explanation_zh) : (e.plain_explanation_zh || e.plain_explanation_en);
    const progress = `${reviewIdx + 1} / ${reviewQueue.length}`;

    const front =
      '<div class="review-front">' +
      '  <h2 class="review-term">' + escapeHtml(term1 || '') + '</h2>' +
      (term2 ? '  <div class="review-term-alt">' + escapeHtml(term2) + '</div>' : '') +
      '  <button class="review-action review-action-primary" id="review-reveal">' + escapeHtml(en ? 'Show answer' : '看释义') + '</button>' +
      '</div>';

    const back2 =
      '<div class="review-back-card">' +
      '  <h2 class="review-term">' + escapeHtml(term1 || '') + '</h2>' +
      (term2 ? '  <div class="review-term-alt">' + escapeHtml(term2) + '</div>' : '') +
      '  <hr class="review-sep">' +
      (def ? '  <p class="review-def"><strong>' + escapeHtml(en ? 'Definition' : '定义') + ':</strong> ' + escapeHtml(def) + '</p>' : '') +
      (plain ? '  <p class="review-plain">' + escapeHtml(plain) + '</p>' : '') +
      '  <div class="review-grade-row">' +
      '    <button class="review-grade review-grade-again" data-grade="again">' + escapeHtml(en ? '😵 Forgot' : '😵 忘了') + '</button>' +
      '    <button class="review-grade review-grade-good"  data-grade="good">'  + escapeHtml(en ? '🙂 Good' : '🙂 会')   + '</button>' +
      '    <button class="review-grade review-grade-easy"  data-grade="easy">'  + escapeHtml(en ? '😎 Easy' : '😎 简单') + '</button>' +
      '  </div>' +
      '</div>';

    root.innerHTML =
      back +
      '<div class="review-progress"><span class="review-progress-num">' + progress + '</span></div>' +
      '<div class="review-card">' +
      (reviewRevealed ? back2 : front) +
      '</div>';

    bindReviewBack(root);
    const reveal = document.getElementById('review-reveal');
    if (reveal) reveal.addEventListener('click', () => {
      reviewRevealed = true;
      renderReviewView(root);
    });
    root.querySelectorAll('.review-grade').forEach(btn => {
      btn.addEventListener('click', () => {
        const g = btn.dataset.grade;
        if (!g) return;
        srsUpdate(id, g);
        reviewSummary[g] = (reviewSummary[g] || 0) + 1;
        reviewIdx++;
        reviewRevealed = false;
        renderReviewView(root);
      });
    });
  }

  function bindReviewBack(root) {
    const back = document.getElementById('review-back');
    if (back) back.addEventListener('click', () => {
      reviewQueue = null;
      activeSubView = 'wordbook';
      renderSubview();
    });
  }

  function renderWordbookView(root) {
    const lab = L();
    const en = isEn();
    const wbEntries = getWordbookEntries();
    const mastered = getMasteredMap();
    // 把 id 解析为 entry 对象（保留 addedAt）
    let resolved = wbEntries.map(w => {
      const e = entries.find(x => x.id === w.id);
      return e ? Object.assign({ __addedAt: w.addedAt, __mastered: !!mastered[w.id] }, e) : null;
    }).filter(Boolean);
    // 按 addedAt 倒序
    resolved.sort((a, b) => (b.__addedAt || 0) - (a.__addedAt || 0));
    // 搜索过滤
    if (wbSearchQuery) {
      const q = wbSearchQuery.toLowerCase();
      resolved = resolved.filter(e => {
        return (e.term_zh && e.term_zh.toLowerCase().includes(q)) ||
               (e.term_en && e.term_en.toLowerCase().includes(q)) ||
               (e.definition_zh && e.definition_zh.toLowerCase().includes(q)) ||
               (e.definition_en && e.definition_en.toLowerCase().includes(q)) ||
               (e.plain_explanation_zh && e.plain_explanation_zh.toLowerCase().includes(q)) ||
               (e.plain_explanation_en && e.plain_explanation_en.toLowerCase().includes(q));
      });
    }

    // header
    const headHTML = '' +
      '<div class="vocabulary-header">' +
      '  <div class="vocabulary-title-row">' +
      '    <h2 class="vocabulary-title">' + escapeHtml(lab.wb_title) + ' <span class="vocabulary-count">(' + resolved.length + ' ' + escapeHtml(lab.wb_count_unit) + ')</span></h2>' +
      '  </div>' +
      '  <p class="vocabulary-subtitle">' + escapeHtml(lab.wb_subtitle) + '</p>' +
      '  <div class="vocabulary-toolbar">' +
      '    <input type="search" id="vocab-search" class="vocabulary-search" placeholder="' + escapeHtml(lab.wb_search_ph) + '" value="' + escapeHtml(wbSearchQuery) + '">' +
      '    <div class="vocabulary-actions">' +
      '      <button class="vocabulary-action vocabulary-action-primary" id="vocab-review">' + escapeHtml(lab.wb_review || '📅 复习模式') + ' <span class="vocab-due-badge" id="vocab-due-badge"></span></button>' +
      '      <button class="vocabulary-action" id="vocab-export-csv">' + escapeHtml(lab.wb_export_csv) + '</button>' +
      '      <button class="vocabulary-action" id="vocab-export-md">' + escapeHtml(lab.wb_export_md) + '</button>' +
      '      <button class="vocabulary-action" id="vocab-print">' + escapeHtml(lab.wb_print) + '</button>' +
      '      <button class="vocabulary-action vocabulary-action-danger" id="vocab-clear">' + escapeHtml(lab.wb_remove_all) + '</button>' +
      '    </div>' +
      '  </div>' +
      '</div>';

    if (resolved.length === 0 && !wbSearchQuery) {
      root.innerHTML = headHTML +
        '<div class="vocabulary-empty">' +
        '  <p>' + escapeHtml(lab.wb_empty) + '</p>' +
        '</div>';
    } else {
      // 列表
      const itemsHTML = resolved.map(e => {
        const term1 = en ? (e.term_en || e.term_zh) : (e.term_zh || e.term_en);
        const term2 = en ? (e.term_zh || '') : (e.term_en || '');
        const def = en ? (e.definition_en || e.definition_zh) : (e.definition_zh || e.definition_en);
        const plain = en ? (e.plain_explanation_en || e.plain_explanation_zh) : (e.plain_explanation_zh || e.plain_explanation_en);
        const cat = e.category;
        const catLabel = (CAT_LABELS()[cat] || cat || '');
        const catColor = CAT_COLORS[cat] || '#888';
        let faStr = '';
        const fa = e.first_appearance;
        if (typeof fa === 'string') faStr = fa;
        else if (fa && typeof fa === 'object') faStr = fa.chapter || '';
        const chId = findChapterIdByFile(faStr, e);
        const chLink = chId
          ? '<button class="vocabulary-jump" data-chapter="' + escapeHtml(chId) + '">' + escapeHtml(lab.jump_chapter) + '</button>'
          : '';
        const addedAtTxt = e.__addedAt ? new Date(e.__addedAt).toLocaleDateString(en ? 'en' : 'zh-CN') : '';
        const masteredCls = e.__mastered ? ' vocabulary-item--mastered' : '';
        // B7 v2 · SRS 历史 + 下次到期
        const _srs = (getSrsMap()[e.id] || null);
        let srsBadge = '';
        if (_srs) {
          const dueIn = _srs.nextReview - Date.now();
          const dueDays = Math.round(dueIn / 86400000);
          let dueTxt;
          if (dueIn <= 0) dueTxt = en ? 'due now' : '今天到期';
          else if (dueDays === 0) dueTxt = en ? 'due today' : '今天到期';
          else if (dueDays === 1) dueTxt = en ? '1 day' : '1 天后';
          else if (dueDays < 30) dueTxt = en ? (dueDays + ' days') : (dueDays + ' 天后');
          else dueTxt = en ? (Math.round(dueDays/30) + ' months') : (Math.round(dueDays/30) + ' 月后');
          srsBadge = `<span class="vocabulary-item-srs" title="${en ? 'Reviewed' : '已复习'}: ${_srs.reps} ${en ? 'times' : '次'}">📅 ${dueTxt} · ${_srs.reps}×</span>`;
        } else {
          srsBadge = `<span class="vocabulary-item-srs vocabulary-item-srs-new">${en ? 'never reviewed' : '未复习'}</span>`;
        }

        return '' +
          '<article class="vocabulary-item' + masteredCls + '" data-id="' + escapeHtml(e.id) + '">' +
          '  <header class="vocabulary-item-head">' +
          '    <div class="vocabulary-item-titles">' +
          '      <h3 class="vocabulary-item-term">' + escapeHtml(term1 || '') + '</h3>' +
          (term2 ? '      <div class="vocabulary-item-term-alt">' + escapeHtml(term2) + '</div>' : '') +
          '    </div>' +
          '    <div class="vocabulary-item-meta">' +
          (catLabel ? '      <span class="vocabulary-item-cat" style="--chip-color:' + catColor + ';">' + escapeHtml(catLabel) + '</span>' : '') +
          (addedAtTxt ? '      <span class="vocabulary-item-date">' + escapeHtml(lab.wb_added_at) + ': ' + escapeHtml(addedAtTxt) + '</span>' : '') +
          '    </div>' +
          '  </header>' +
          (def ? '  <p class="vocabulary-item-def"><span class="vocabulary-item-label">' + escapeHtml(lab.wb_def_label) + '：</span>' + escapeHtml(def) + '</p>' : '') +
          (plain ? '  <div class="vocabulary-item-plain">' + escapeHtml(plain) + '</div>' : '') +
          '  <footer class="vocabulary-item-foot">' +
          '    <div class="vocabulary-item-foot-left">' + srsBadge + '</div>' +
          '    <div class="vocabulary-item-foot-right">' +
          chLink +
          '      <button class="vocabulary-master ' + (e.__mastered ? 'active' : '') + '" data-id="' + escapeHtml(e.id) + '">' +
          escapeHtml(e.__mastered ? lab.wb_master_active : lab.wb_master) + '</button>' +
          '      <button class="vocabulary-remove" data-id="' + escapeHtml(e.id) + '">' + escapeHtml(lab.wb_remove) + '</button>' +
          '    </div>' +
          '  </footer>' +
          '</article>';
      }).join('');

      root.innerHTML = headHTML +
        '<div class="vocabulary-list">' + (itemsHTML || '<div class="vocabulary-empty"><p>' + escapeHtml(lab.wb_empty) + '</p></div>') + '</div>';
    }

    // ===== bind =====
    const search = document.getElementById('vocab-search');
    if (search) {
      search.addEventListener('input', () => {
        if (wbSearchTimer) clearTimeout(wbSearchTimer);
        wbSearchTimer = setTimeout(() => {
          wbSearchQuery = search.value.trim();
          renderWordbookView(root);
        }, 250);
      });
    }
    // B7 · 复习按钮
    const reviewBtn = document.getElementById('vocab-review');
    if (reviewBtn) reviewBtn.addEventListener('click', () => {
      activeSubView = 'review';
      renderSubview();
    });
    // 到期数 badge — 显示 "(N due / M total)"
    const badge = document.getElementById('vocab-due-badge');
    if (badge) {
      const due = getDueIds().length;
      const total = getWordbookEntries().length;
      const lbl = isEn() ? `(${due} due / ${total})` : `(${due} 到期 / 共 ${total})`;
      badge.textContent = total > 0 ? lbl : '';
    }

    const csvBtn = document.getElementById('vocab-export-csv');
    if (csvBtn) csvBtn.addEventListener('click', () => exportCSV(resolved));
    const mdBtn = document.getElementById('vocab-export-md');
    if (mdBtn) mdBtn.addEventListener('click', () => exportMarkdown(resolved));
    const printBtn = document.getElementById('vocab-print');
    if (printBtn) printBtn.addEventListener('click', () => {
      document.body.classList.add('vocabulary-printing');
      window.print();
      setTimeout(() => document.body.classList.remove('vocabulary-printing'), 500);
    });
    const clearBtn = document.getElementById('vocab-clear');
    if (clearBtn) clearBtn.addEventListener('click', () => {
      if (confirm(lab.wb_confirm_clear)) {
        setWordbookEntries([]);
        setMasteredMap({});
        renderWordbookView(root);
        refreshWordbookBadge();
      }
    });
    // 列表中按钮
    root.querySelectorAll('.vocabulary-master').forEach(b => {
      b.addEventListener('click', () => {
        toggleMastered(b.dataset.id);
        renderWordbookView(root);
      });
    });
    root.querySelectorAll('.vocabulary-remove').forEach(b => {
      b.addEventListener('click', () => {
        toggleWordbook(b.dataset.id);
        renderWordbookView(root);
        refreshWordbookBadge();
      });
    });
    root.querySelectorAll('.vocabulary-jump').forEach(b => {
      b.addEventListener('click', () => {
        const chId = b.dataset.chapter;
        if (chId && window.__appShowView && window.__appLoadChapterById) {
          window.__appShowView('reader');
          window.__appLoadChapterById(chId);
        }
      });
    });
  }

  // ===== 导出 =====
  function csvEscape(s) {
    if (s == null) return '';
    s = String(s).replace(/"/g, '""');
    return '"' + s + '"';
  }
  function exportCSV(list) {
    const en = isEn();
    const headers = en
      ? ['term_en', 'term_zh', 'category', 'definition', 'plain_explanation', 'first_appearance', 'added_at']
      : ['term_zh', 'term_en', 'category', 'definition_zh', 'plain_explanation_zh', 'first_appearance', 'added_at'];
    const rows = [headers.map(csvEscape).join(',')];
    list.forEach(e => {
      const cat = (CAT_LABELS()[e.category] || e.category || '');
      const fa = e.first_appearance || {};
      const addedAt = e.__addedAt ? new Date(e.__addedAt).toISOString() : '';
      const row = en
        ? [e.term_en || '', e.term_zh || '', cat, e.definition_en || e.definition_zh || '', e.plain_explanation_en || e.plain_explanation_zh || '', fa.chapter || '', addedAt]
        : [e.term_zh || '', e.term_en || '', cat, e.definition_zh || e.definition_en || '', e.plain_explanation_zh || e.plain_explanation_en || '', fa.chapter || '', addedAt];
      rows.push(row.map(csvEscape).join(','));
    });
    // 加 BOM 让 Excel 正确识别 UTF-8 中文
    const blob = new Blob(['\ufeff' + rows.join('\n')], { type: 'text/csv;charset=utf-8' });
    downloadBlob(blob, 'cc-wordbook-' + dateStamp() + '.csv');
  }
  function exportMarkdown(list) {
    const en = isEn();
    const lines = ['# ' + (en ? 'Claude Code Wordbook' : 'Claude Code 生词本'), '',
      (en ? 'Exported on ' : '导出时间：') + new Date().toLocaleString(), '',
      '---', ''];
    list.forEach((e, i) => {
      const term1 = en ? (e.term_en || e.term_zh) : (e.term_zh || e.term_en);
      const term2 = en ? (e.term_zh || '') : (e.term_en || '');
      const def = en ? (e.definition_en || e.definition_zh) : (e.definition_zh || e.definition_en);
      const plain = en ? (e.plain_explanation_en || e.plain_explanation_zh) : (e.plain_explanation_zh || e.plain_explanation_en);
      const fa = e.first_appearance || {};
      lines.push('## ' + (i + 1) + '. ' + (term1 || ''));
      if (term2) lines.push('*' + term2 + '*');
      lines.push('');
      if (def) lines.push('**' + (en ? 'Definition' : '定义') + '**：' + def);
      lines.push('');
      if (plain) lines.push('> ' + plain);
      lines.push('');
      if (fa.chapter) lines.push('**' + (en ? 'First appears' : '首次出现') + '**：`' + fa.chapter + '`');
      lines.push('');
      lines.push('---', '');
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    downloadBlob(blob, 'cc-wordbook-' + dateStamp() + '.md');
  }
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 200);
  }
  function dateStamp() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate());
  }

  async function render() {
    await init();
    bindToolbar();
    ensureWordbookBadge();
    refreshWordbookBadge();
    if (activeSubView === 'wordbook') {
      renderSubview();
    } else {
      // 切回主视图时确保隐藏的 wb view 不残留
      const wb = document.getElementById('dict-wordbook-view');
      if (wb) wb.remove();
      const mainView = document.querySelector('#dictionary .dict-toolbar');
      const mainBody = document.querySelector('#dictionary .dict-body');
      if (mainView) mainView.classList.remove('hidden');
      if (mainBody) mainBody.classList.remove('hidden');
      renderFilters();
      renderList();
    }
  }

  // 切语言时重渲染（修复 select option / 卡片按钮 切语言后还是旧语言）
  // dictionary.js 在 i18n.js 之前加载，所以 hook 必须 deferred 到 i18n 就绪后
  function hookLocaleSwitch() {
    if (!window.i18n || typeof window.i18n.switch !== 'function') return false;
    if (window.i18n.__dictLocaleHooked) return true;
    const _origSwitch = window.i18n.switch;
    window.i18n.switch = function(newLocale) {
      const ret = _origSwitch.call(window.i18n, newLocale);
      Promise.resolve(ret).then(() => {
        try {
          if (loaded) {
            renderFilters();
            renderList();
            refreshWordbookBadge();
            if (activeSubView === 'wordbook') {
              const wb = document.getElementById('dict-wordbook-view');
              if (wb) renderWordbookView(wb);
            } else if (activeSubView === 'review') {
              const rv = document.getElementById('dict-review-view');
              if (rv) renderReviewView(rv);
            }
          }
        } catch (e) { console.warn('[Dictionary] locale-switch reflow failed:', e); }
      });
      return ret;
    };
    window.i18n.__dictLocaleHooked = true;
    return true;
  }
  // 立即试一次（如果 i18n 已加载）
  if (!hookLocaleSwitch()) {
    // 再 DOMContentLoaded 试
    document.addEventListener('DOMContentLoaded', function tryHook() {
      if (hookLocaleSwitch()) return;
      // 再失败：轮询 5 秒（兜底）
      let attempts = 0;
      const t = setInterval(() => {
        attempts++;
        if (hookLocaleSwitch() || attempts > 20) clearInterval(t);
      }, 250);
    });
  }

  // 暴露
  window.Dictionary = {
    init: init,
    render: render,
    refresh: function () {
      renderFilters();
      renderList();
      refreshWordbookBadge();
      if (activeSubView === 'wordbook') {
        const wb = document.getElementById('dict-wordbook-view');
        if (wb) renderWordbookView(wb);
      }
    },
    refreshWordbookBadge: refreshWordbookBadge,
    showWordbook: function () { activeSubView = 'wordbook'; renderSubview(); },
    showMain: function () { activeSubView = 'main'; renderSubview(); }
  };
})();
