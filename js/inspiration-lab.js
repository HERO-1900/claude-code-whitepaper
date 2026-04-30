/**
 * Inspiration Lab — 灵感实验室
 * 火花(Sparks) & 蓝图(Blueprints) 可视化面板
 */
(function() {
  'use strict';

  let sparks = [];
  let blueprints = [];
  let loaded = false;

  // 富文本格式化：**标题**：正文 → <h4>标题</h4><p>正文</p>
  function fmtRichText(text) {
    if (!text) return '';
    return text
      .replace(/\*\*([^*]+)\*\*[：:]\s*/g, '<h4 class="insp-sub">$1</h4><p>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>')
      + '</p>';
  }
  let currentFilter = 'all';
  let currentTab = 'sparks';
  let searchQuery = '';

  // i18n helper
  function isEn() { try { return (localStorage.getItem('cc-locale')||'zh')==='en'; } catch(e){ return false; } }

  const CATEGORY_LABELS_ZH = {
    pain_point: '痛点',
    unmet_need: '未满足需求',
    wild_idea: '异想天开',
    counter_intuitive: '反直觉',
    cross_domain: '跨界'
  };
  const CATEGORY_LABELS_EN = {
    pain_point: 'Pain Point',
    unmet_need: 'Unmet Need',
    wild_idea: 'Wild Idea',
    counter_intuitive: 'Counter-Intuitive',
    cross_domain: 'Cross-Domain'
  };
  const CATEGORY_COLORS = {
    pain_point: '#ff6b6b',
    unmet_need: '#ffd93d',
    wild_idea: '#6bcb77',
    counter_intuitive: '#4d96ff',
    cross_domain: '#9b59b6'
  };
  const CONFIDENCE_LABELS_ZH = {
    wild_guess: '直觉',
    has_signal: '有信号',
    strong_signal: '强信号',
    validated: '已验证',
    speculative: '推测性'
  };
  const CONFIDENCE_LABELS_EN = {
    wild_guess: 'Hunch',
    has_signal: 'Has Signal',
    strong_signal: 'Strong Signal',
    validated: 'Validated',
    speculative: 'Speculative'
  };
  const SOURCE_LABELS_ZH = {
    book_analysis: '书籍分析',
    community_research: '社区调研',
    deep_reading: '深读老炮儿'
  };
  const SOURCE_LABELS_EN = {
    book_analysis: 'Book Analysis',
    community_research: 'Community Research',
    deep_reading: 'Deep Reading'
  };
  const SOURCE_ICONS = {
    book_analysis: '📖',
    community_research: '🌍',
    deep_reading: '🔥'
  };
  // 统一 getter：按当前 locale 返回对应 map
  function CAT_LABELS() { return isEn() ? CATEGORY_LABELS_EN : CATEGORY_LABELS_ZH; }
  function CONF_LABELS() { return isEn() ? CONFIDENCE_LABELS_EN : CONFIDENCE_LABELS_ZH; }
  function SRC_LABELS() { return isEn() ? SOURCE_LABELS_EN : SOURCE_LABELS_ZH; }
  // 兼容旧引用
  const CATEGORY_LABELS = new Proxy({}, { get: (_, k) => CAT_LABELS()[k] });
  const CONFIDENCE_LABELS = new Proxy({}, { get: (_, k) => CONF_LABELS()[k] });
  const SOURCE_LABELS = new Proxy({}, { get: (_, k) => SRC_LABELS()[k] });

  // 硬编码 UI 文案词典
  const UI = {
    zh: {
      title: '灵感实验室',
      desc: '从 Claude Code 源码分析 + 全球社区调研 + 深度阅读中提炼的灵感。火花是异想天开的微灵感，蓝图是经过验证的成熟方向。',
      sparks_unit: '火花', blueprints_unit: '蓝图',
      tab_sparks: '火花', tab_blueprints: '蓝图',
      search_placeholder: '搜索火花...',
      filter_all: '全部',
      empty_match: '没有找到匹配的火花',
      empty_loading: '蓝图数据加载中或暂无数据...',
      plain: '💡 通俗理解',
      why_matters: '为什么重要',
      anchor: '🔗 CC源码锚点',
      next_step: '🚀 下一步行动',
      cross: '跨界联想',
      sketch: '初步方案',
      source: '来源',
      feedback: '💬 多角色评审',
      feasibility: '可行性',
      value: '价值',
      why_worth: '为什么值得做',
      action_plan: '行动方案',
      bp_feedback: '多角色评审',
      evidence: '证据来源',
      from_sparks: '来自火花',
      bp_anchor: 'CC源码锚点',
      high: '高', medium: '中', low: '低'
    },
    en: {
      title: 'Inspiration Lab',
      desc: 'Ideas distilled from three sources: analyzing the Claude Code source, global community research, and deep reading. Sparks are wild micro-ideas; blueprints are proven directions.',
      sparks_unit: 'sparks', blueprints_unit: 'blueprints',
      tab_sparks: 'Sparks', tab_blueprints: 'Blueprints',
      search_placeholder: 'Search sparks...',
      filter_all: 'All',
      empty_match: 'No matching sparks found',
      empty_loading: 'Blueprints loading or unavailable...',
      plain: '💡 Plain English',
      why_matters: 'Why It Matters',
      anchor: '🔗 Source Reference',
      next_step: '🚀 Next Step',
      cross: 'Cross-Domain Connection',
      sketch: 'Rough Sketch',
      source: 'Source',
      feedback: '💬 Reviewer Panel',
      feasibility: 'Feasibility',
      value: 'Value',
      why_worth: "Why It's Worth Doing",
      action_plan: 'Action Plan',
      bp_feedback: 'Reviewer Panel',
      evidence: 'Evidence',
      from_sparks: 'Traced from Sparks',
      bp_anchor: 'Source Reference',
      high: 'High', medium: 'Medium', low: 'Low'
    }
  };
  function T(k) { return (UI[isEn() ? 'en' : 'zh'])[k] || k; }

  async function loadData(forceRefresh) {
    if (loaded && !forceRefresh) return;
    try {
      const bust = forceRefresh ? `?t=${Date.now()}` : '';
      var sparksRes = await fetch('handoff/brainstorm/sparks-v1.json' + bust);
      sparks = sparksRes.ok ? await sparksRes.json() : [];
      try {
        var blueprintsRes = await fetch('handoff/brainstorm/blueprints-v1.json' + bust);
        blueprints = blueprintsRes.ok ? await blueprintsRes.json() : [];
      } catch(e2) { blueprints = []; console.warn('Blueprints load failed:', e2); }
      loaded = true;
      // B8 灵感↔词典：异步建立 cross-reference（不阻塞渲染）
      buildDictCrossRef();
    } catch (e) {
      console.warn('Inspiration data not loaded:', e);
    }
  }

  // B8 · 灵感↔词典 cross-reference
  // sparkId → [dict ids]，每个 spark 最多 5 个相关词条
  let sparkDictRel = {};
  async function buildDictCrossRef() {
    try {
      const r = await fetch('book/_shared/dictionary.json');
      if (!r.ok) return;
      const dict = await r.json();
      // 建索引：term → id（去 _suppressed）+ 长度 ≥ 2 字
      const idx = [];
      dict.forEach(e => {
        if (e._suppressed) return;
        const id = e.id;
        ['term_zh', 'term_en'].forEach(k => {
          const t = (e[k] || '').trim();
          if (t && t.length >= 2) idx.push({ term: t, id, len: t.length });
        });
      });
      idx.sort((a, b) => b.len - a.len);  // 长 term 优先匹配，避免子串误命中
      // 建 id → 中英标签 map（取最短 term 作显示）
      sparkDictRel.__terms = {};
      sparkDictRel.__termsEn = {};
      dict.forEach(e => {
        if (e._suppressed) return;
        sparkDictRel.__terms[e.id] = e.term_zh || e.term_en || e.id;
        sparkDictRel.__termsEn[e.id] = e.term_en || e.term_zh || e.id;
      });
      // 对每个 spark/blueprint 扫描
      function scan(item) {
        const text = [
          pickL(item, 'spark') || '',
          pickL(item, 'why_it_matters') || '',
          pickL(item, 'cc_anchor') || '',
          pickL(item, 'plain_explanation') || '',
          (item.tags || []).join(' '),
          (item.tags_en || []).join(' ')
        ].join(' ').toLowerCase();
        const hits = new Set();
        for (const e of idx) {
          if (hits.size >= 5) break;
          const t = e.term.toLowerCase();
          if (text.includes(t)) hits.add(e.id);
        }
        return Array.from(hits);
      }
      sparks.forEach(s => { sparkDictRel[s.id] = scan(s); });
      blueprints.forEach(b => { sparkDictRel[b.id] = scan(b); });
      // 渲染中的话，刷新一下（找到当前容器再 render）
      try {
        const c = document.getElementById('inspiration');
        if (c && !c.classList.contains('hidden')) render(c);
      } catch(e){}
    } catch (e) {
      console.warn('[B8] dict crossref build failed:', e);
    }
  }

  function getDictRelHTML(itemId) {
    const ids = sparkDictRel[itemId];
    if (!ids || !ids.length) return '';
    const label = isEn() ? '📖 Related Terms' : '📖 相关词条';
    const map = isEn() ? sparkDictRel.__termsEn : sparkDictRel.__terms;
    const chips = ids.map(id => {
      const txt = (map && map[id]) || id;
      return `<a class="spark-dict-chip" href="#dict-${id}" data-dict-id="${id}">${txt}</a>`;
    }).join('');
    return `<div class="spark-dict-rel"><strong>${label}</strong><div class="spark-dict-chips">${chips}</div></div>`;
  }

  function getStats() {
    const cats = {};
    const confs = {};
    const srcs = {};
    sparks.forEach(s => {
      cats[s.category] = (cats[s.category] || 0) + 1;
      confs[s.confidence] = (confs[s.confidence] || 0) + 1;
      const st = s.source_type || 'book_analysis';
      srcs[st] = (srcs[st] || 0) + 1;
    });
    return { total: sparks.length, blueprintCount: blueprints.length, cats, confs, srcs };
  }

  function render(container) {
    const stats = getStats();
    container.innerHTML = `
      <div class="insp-header">
        <div class="insp-title-row">
          <h1 class="insp-title">${T('title')}</h1>
          <div class="insp-stats">
            <span class="insp-stat"><span class="insp-stat-num">${stats.total}</span> ${T('sparks_unit')}</span>
            <span class="insp-stat"><span class="insp-stat-num">${stats.blueprintCount}</span> ${T('blueprints_unit')}</span>
          </div>
        </div>
        <p class="insp-desc">${T('desc')}</p>
        <div class="insp-source-bar">
          ${Object.entries(stats.srcs).map(([k, v]) => `<span class="insp-src-chip">${SOURCE_ICONS[k] || ''} ${SOURCE_LABELS[k] || k} <b>${v}</b></span>`).join('')}
        </div>
        <div class="insp-tabs">
          <button class="insp-tab ${currentTab === 'sparks' ? 'active' : ''}" data-tab="sparks">${T('tab_sparks')} (${stats.total})</button>
          <button class="insp-tab ${currentTab === 'blueprints' ? 'active' : ''}" data-tab="blueprints">${T('tab_blueprints')} (${stats.blueprintCount})</button>
        </div>
      </div>
      <div class="insp-body">
        ${currentTab === 'sparks' ? renderSparksView(stats) : renderBlueprintsView()}
      </div>
    `;
    bindEvents(container);
  }

  function renderSparksView(stats) {
    const filters = [
      { key: 'all', label: T('filter_all'), count: stats.total },
      ...Object.entries(stats.cats).map(([k, v]) => ({
        key: k, label: CATEGORY_LABELS[k] || k, count: v
      }))
    ];

    let filtered = currentFilter === 'all'
      ? sparks
      : sparks.filter(s => s.category === currentFilter);

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(s =>
        s.spark.toLowerCase().includes(q) ||
        (s.why_it_matters || '').toLowerCase().includes(q) ||
        (s.cc_anchor || '').toLowerCase().includes(q) ||
        (s.tags || []).some(t => t.toLowerCase().includes(q))
      );
    }

    return `
      <div class="insp-search-row">
        <input class="insp-search" type="text" placeholder="${T('search_placeholder')}" value="${searchQuery}">
        <span class="insp-result-count">${filtered.length} / ${stats.total}</span>
      </div>
      <div class="insp-filters">
        ${filters.map(f => `
          <button class="insp-filter ${currentFilter === f.key ? 'active' : ''}" data-filter="${f.key}">
            ${f.label} <span class="insp-filter-count">${f.count}</span>
          </button>
        `).join('')}
      </div>
      <div class="insp-grid">
        ${filtered.length ? filtered.map(renderSparkCard).join('') : `<p class="insp-empty">${T('empty_match')}</p>`}
      </div>
    `;
  }

  // 双语字段选择器：当 isEn() && s[field+'_en'] 存在，返回英文版；否则回落中文
  function pickL(s, field) {
    const enField = field + '_en';
    if (isEn() && s[enField]) return s[enField];
    return s[field] || '';
  }
  // persona 也双语：f.persona_en 优先
  function pickPersona(f) { return isEn() && f.persona_en ? f.persona_en : (f.persona || ''); }
  function pickComment(f) { return isEn() && f.comment_en ? f.comment_en : (f.comment || ''); }

  function renderSparkCard(s) {
    const catColor = CATEGORY_COLORS[s.category] || '#888';
    const confLabel = CONFIDENCE_LABELS[s.confidence] || s.confidence;
    const confClass = s.confidence === 'validated' ? 'conf-validated' :
                      s.confidence === 'has_signal' ? 'conf-signal' : 'conf-guess';
    const anchorText = pickL(s, 'cc_anchor');
    const sourceRaw = typeof s.source === 'string' ? s.source : '';
    const sourceText = (isEn() && s.source_en) ? s.source_en : sourceRaw;
    const crossDomain = pickL(s, 'cross_domain');
    const firstSketch = pickL(s, 'first_sketch');
    const srcType = s.source_type || 'book_analysis';
    const srcIcon = SOURCE_ICONS[srcType] || '📖';
    const srcLabel = SOURCE_LABELS[srcType] || srcType;
    const plainExp = pickL(s, 'plain_explanation');
    const nextStep = pickL(s, 'next_step');
    const feedback = s.user_feedback || [];
    const fmtNextStep = fmtRichText(nextStep);
    const sparkText = pickL(s, 'spark');
    const whyText = pickL(s, 'why_it_matters');

    return `
      <div class="spark-card" data-id="${s.id}">
        <div class="spark-top">
          <span class="spark-id">${s.id}</span>
          <span class="spark-cat" style="background:${catColor}">${CATEGORY_LABELS[s.category] || s.category}</span>
          <span class="spark-conf ${confClass}">${confLabel}</span>
          <span class="spark-src" title="${srcLabel}">${srcIcon}</span>
        </div>
        <div class="spark-body">
          <p class="spark-text">${sparkText}</p>
        </div>
        <div class="spark-detail" style="display:none">
          ${plainExp ? `<div class="spark-plain"><strong>${T('plain')}</strong><p>${plainExp}</p></div>` : ''}
          <div class="spark-why">
            <strong>${T('why_matters')}</strong>
            <p>${whyText}</p>
          </div>
          ${anchorText ? `<div class="spark-anchor"><strong>${T('anchor')}</strong><p>${anchorText}</p></div>` : ''}
          ${fmtNextStep ? `<div class="spark-nextstep"><strong>${T('next_step')}</strong><div class="spark-nextstep-content">${fmtNextStep}</div></div>` : ''}
          ${crossDomain ? `<div class="spark-cross"><strong>${T('cross')}</strong><p>${crossDomain}</p></div>` : ''}
          ${firstSketch ? `<div class="spark-sketch"><strong>${T('sketch')}</strong><p>${firstSketch}</p></div>` : ''}
          ${sourceText ? `<div class="spark-source"><strong>${T('source')}</strong><p>${sourceText.startsWith('http') ? `<a href="${sourceText}" target="_blank">${sourceText.replace(/https?:\/\//, '').split('/')[0]}</a>` : sourceText}</p></div>` : ''}
          ${feedback.length ? `<div class="spark-feedback"><strong>${T('feedback')}</strong>${feedback.map(f => `<div class="spark-fb-item"><span class="spark-fb-persona">${pickPersona(f)}</span><p>${pickComment(f)}</p></div>`).join('')}</div>` : ''}
          <div class="spark-tags">${((isEn() && s.tags_en) ? s.tags_en : (s.tags || [])).map(t => `<span class="spark-tag">${t}</span>`).join('')}</div>
          ${getDictRelHTML(s.id)}
        </div>
        <span class="spark-arrow" aria-hidden="true">→</span>
      </div>
    `;
  }

  function renderBlueprintsView() {
    if (!blueprints.length) {
      return `<p class="insp-empty">${T('empty_loading')}</p>`;
    }
    return `
      <div class="insp-blueprints">
        ${blueprints.map(renderBlueprintCard).join('')}
      </div>
    `;
  }

  function renderBlueprintCard(b) {
    const lvlKey = function(v){ return v==='high'?'high':v==='medium'?'medium':'low'; };
    const fVal = T(lvlKey(b.feasibility));
    const vVal = T(lvlKey(b.value));
    const sparkLinks = (b.from_sparks || []).join(', ');
    const confLabel = CONFIDENCE_LABELS[b.confidence] || b.confidence || '';
    const confClass = b.confidence === 'strong_signal' ? 'conf-validated' :
                      b.confidence === 'has_signal' ? 'conf-signal' : 'conf-guess';
    const plainExp = pickL(b, 'plain_explanation');
    const whyMatters = pickL(b, 'why_it_matters');
    const feedback = b.user_feedback || [];
    const firstStep = pickL(b, 'first_step');
    const ccAnchor = pickL(b, 'cc_anchor');
    const bpTitle = pickL(b, 'title');
    const bpDesc = pickL(b, 'description');
    // evidence 是数组，每项可能是字符串或对象，支持 evidence_en 同构数组
    const evidence = (isEn() && b.evidence_en) ? b.evidence_en : (b.evidence || []);

    const fmtStep = fmtRichText(firstStep);
    const fmtWhy = fmtRichText(whyMatters);

    return `
      <div class="blueprint-card" data-id="${b.id}">
        <div class="bp-header">
          <span class="bp-id">${b.id}</span>
          <div class="bp-badges">
            ${confLabel ? `<span class="spark-conf ${confClass}">${confLabel}</span>` : ''}
            <span class="bp-meta-chip">${T('feasibility')}: ${fVal}</span>
            <span class="bp-meta-chip">${T('value')}: ${vVal}</span>
          </div>
        </div>
        <h3 class="bp-title">${bpTitle}</h3>
        ${plainExp ? `<p class="bp-plain">${plainExp}</p>` : `<p class="bp-desc">${bpDesc}</p>`}
        <div class="bp-detail" style="display:none">
          ${fmtWhy ? `<div class="bp-why"><strong>${T('why_worth')}</strong><p>${fmtWhy}</p></div>` : ''}
          ${fmtStep ? `<div class="bp-step"><strong>${T('action_plan')}</strong><div class="bp-step-content">${fmtStep}</div></div>` : ''}
          ${feedback.length ? `<div class="bp-feedback"><strong>${T('bp_feedback')}</strong>${feedback.map(f => `<div class="bp-fb-item"><span class="bp-fb-persona">${pickPersona(f)}</span><p>${pickComment(f)}</p></div>`).join('')}</div>` : ''}
          <div class="bp-evidence">
            <strong>${T('evidence')}</strong>
            <ul>${evidence.map(e => `<li>${e}</li>`).join('')}</ul>
          </div>
          ${sparkLinks ? `<div class="bp-sparks"><strong>${T('from_sparks')}</strong><p>${sparkLinks}</p></div>` : ''}
          ${ccAnchor ? `<div class="bp-anchor"><strong>${T('bp_anchor')}</strong><p>${ccAnchor}</p></div>` : ''}
          ${getDictRelHTML(b.id)}
        </div>
        <span class="bp-arrow" aria-hidden="true">→</span>
      </div>
    `;
  }

  function showModal(detailEl) {
    var overlay = document.createElement('div');
    overlay.className = 'insp-modal-overlay';
    var modal = document.createElement('div');
    modal.className = 'insp-modal';
    modal.innerHTML = '<button class="insp-modal-close" aria-label="' + (isEn() ? 'Close' : '关闭') + '">✕</button>';
    var content = detailEl.cloneNode(true);
    content.style.display = 'block';
    modal.appendChild(content);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    requestAnimationFrame(function() { overlay.classList.add('visible'); });
    function close() { overlay.classList.remove('visible'); setTimeout(function() { overlay.remove(); }, 200); }
    overlay.addEventListener('click', function(e) { if (e.target === overlay) close(); });
    modal.querySelector('.insp-modal-close').addEventListener('click', close);
    // B8 v2 修复：点击词条 chip 时先关闭灵感 modal + 切到词典 main subview
    modal.querySelectorAll('.spark-dict-chip').forEach(function(chip) {
      chip.addEventListener('click', function(e) {
        // 先把词典切回 main subview（不要停在 wordbook）
        try { if (window.Dictionary && window.Dictionary.showMain) window.Dictionary.showMain(); } catch(err){}
        close();
        // <a href="#dict-XXX"> 默认行为继续触发 handleHashRoute
      });
    });
    document.addEventListener('keydown', function handler(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', handler); } });
  }

  function bindEvents(container) {
    // Tab 切换 — 直接绑定（每次 render 后重绑）
    container.querySelectorAll('.insp-tab').forEach(function(btn) {
      btn.addEventListener('click', function() {
        currentTab = btn.dataset.tab;
        render(container);
      });
    });

    // 分类筛选 — 直接绑定
    container.querySelectorAll('.insp-filter').forEach(function(btn) {
      btn.addEventListener('click', function() {
        currentFilter = btn.dataset.filter;
        render(container);
      });
    });

    // Search
    var searchInput = container.querySelector('.insp-search');
    if (searchInput) {
      searchInput.addEventListener('input', function() {
        searchQuery = searchInput.value;
        render(container);
        var newInput = container.querySelector('.insp-search');
        if (newInput) { newInput.focus(); newInput.selectionStart = newInput.selectionEnd = newInput.value.length; }
      });
    }

    // 卡片点击 → 弹窗
    container.querySelectorAll('.spark-card, .blueprint-card').forEach(function(card) {
      card.addEventListener('click', function(e) {
        if (e.target.closest('a, button, input, textarea')) return;
        var detail = card.querySelector('.spark-detail') || card.querySelector('.bp-detail');
        if (detail) showModal(detail);
      });
    });
  }

  // Public API
  window.InspirationLab = {
    init: loadData,
    render: render,
    getStats: getStats,
    setTab: function(tab) { currentTab = tab; },
    getTab: function() { return currentTab; }
  };

  // 语言切换时重渲染当前活动 tab —— 修复 Bug 1（火花/蓝图 tab 内容不刷新）
  // 监听两种事件：
  //  (1) i18n.js / index.html 里 setLocale 后 dispatch 的全局事件（若有）
  //  (2) 直接劫持 window.i18n.switch 链路兜底
  function refreshIfMounted() {
    var container = document.getElementById('inspiration-container');
    if (container && container.children.length > 0 && loaded) {
      render(container);
    }
  }
  window.addEventListener('cc-locale-change', refreshIfMounted);
  // 同时挂 hook 兜底：__appOnLocaleChange 链路
  var prevHook = window.__appOnInspirationLocaleChange;
  window.__appOnInspirationLocaleChange = function() {
    try { if (typeof prevHook === 'function') prevHook(); } catch(e) {}
    refreshIfMounted();
  };
})();
