/**
 * Main application logic — routing, panel, chapter reader.
 */
(function () {
  'use strict';

  // ===== 难度评级数据（TOC 用） =====
  // 性能优化（2026-04-25）：用 requestIdleCallback 推迟到浏览器空闲，
  // 避免首屏与 search-index、chart-embedding-map 抢带宽。
  let difficultyMap = {};
  function loadDifficultyRatings() {
    fetch('book/_shared/difficulty-ratings.json').then(r=>r.json()).then(d=>{
      var ratings = d.ratings || d;
      ratings.forEach(function(r){
        difficultyMap[r.chapter] = r;
      });
      // TOC 已渲染完毕，加入难度筛选器
      addDifficultyFilter();
    }).catch(function(){});
  }
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(loadDifficultyRatings, { timeout: 3000 });
  } else {
    setTimeout(loadDifficultyRatings, 1500);
  }

  // 把难度等级（easy/medium/hard/expert）打到每条 .toc-chapter 上
  // 单独抽出来：每次 buildTOC 完成后都要重新调用（因为 TOC 重建会丢失 dataset）
  function tagTocChaptersWithDifficulty() {
    document.querySelectorAll('.toc-chapter').forEach(function(el) {
      var chId = el.dataset.chapterId;
      if (!chId) return;
      var ch = null;
      for (var p of BOOK_STRUCTURE) {
        for (var c of p.chapters) { if (c.id === chId) { ch = c; break; } }
        if (ch) break;
      }
      if (!ch) return;
      var diff = getDifficulty(ch.file);
      if (diff) {
        var level = Math.round(diff.difficulty);
        el.dataset.diffLevel = level <= 2 ? 'easy' : level <= 3 ? 'medium' : level <= 4 ? 'hard' : 'expert';
        if (diff.roles && diff.roles.length) {
          el.dataset.diffRoles = diff.roles.join(',');
        }
      }
    });
  }

  // 渲染（或刷新）TOC 顶部的难度筛选条。i18n 切换时也调它，保证标签语言跟随。
  function renderDifficultyFilterBar() {
    var search = document.getElementById('toc-search');
    if (!search) return;
    // 已存在则先移除（locale 切换时重渲）
    var existing = document.querySelector('.toc-filter-bar');
    var prevActive = existing ? existing.querySelector('.toc-filter.active')?.dataset.level : 'all';
    if (existing) existing.remove();

    var bar = document.createElement('div');
    bar.className = 'toc-filter-bar';
    var _isEnFilter = (function(){ try { return (localStorage.getItem('cc-locale')||'zh')==='en'; } catch(e){ return false; } })();
    var filterLabels = _isEnFilter
      ? { all: 'All', easy: 'Beginner', medium: 'Intermediate', hard: 'Advanced', expert: 'Expert' }
      : { all: '全部', easy: '入门', medium: '进阶', hard: '深入', expert: '专家' };
    function btn(level, label, color) {
      var cls = 'toc-filter' + (level === prevActive ? ' active' : '');
      var style = color ? ' style="--fc:' + color + '"' : '';
      return '<button class="' + cls + '" data-level="' + level + '"' + style + '>' + label + '</button>';
    }
    bar.innerHTML =
      btn('all', filterLabels.all) +
      btn('easy', filterLabels.easy, '#4a7c50') +
      btn('medium', filterLabels.medium, '#4a6b8a') +
      btn('hard', filterLabels.hard, '#c77d2e') +
      btn('expert', filterLabels.expert, '#b84a3a');
    search.parentNode.insertBefore(bar, search.nextSibling);

    function applyFilter(level) {
      document.querySelectorAll('.toc-chapter').forEach(function(el) {
        if (level === 'all' || !level) {
          el.style.opacity = '';
        } else {
          el.style.opacity = el.dataset.diffLevel === level ? '1' : '0.25';
        }
      });
    }

    bar.addEventListener('click', function(e) {
      var btn = e.target.closest('.toc-filter');
      if (!btn) return;
      bar.querySelectorAll('.toc-filter').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      applyFilter(btn.dataset.level);
    });

    // 应用之前的过滤状态（locale 切换后保留用户选择）
    if (prevActive && prevActive !== 'all') applyFilter(prevActive);
  }

  function addDifficultyFilter() {
    tagTocChaptersWithDifficulty();
    renderDifficultyFilterBar();
  }

  // 暴露给 __appOnLocaleChange / buildTOC 调用
  window.__appRefreshDifficultyFilter = function() {
    tagTocChaptersWithDifficulty();
    renderDifficultyFilterBar();
  };

  function getDifficulty(chFile) {
    if (!chFile) return null;
    // 尝试多种匹配方式
    for (var key in difficultyMap) {
      if (chFile.includes(key.replace(/\//g, '_').replace(/^part\d+_?/, '')) ||
          chFile.includes(key.split('/').pop()) ||
          key.includes(chFile.replace('.md','').split('/').pop())) {
        return difficultyMap[key];
      }
    }
    return null;
  }

  // ===== DOM REFS =====
  const views = {
    welcome: document.getElementById('welcome'),
    landing: document.getElementById('landing'),
    reader: document.getElementById('reader'),
    gallery: document.getElementById('gallery'),
    inspiration: document.getElementById('inspiration'),
  };
  const navBtns = {
    guide: document.getElementById('nav-guide'),
    home: document.getElementById('nav-home'),
    reader: document.getElementById('nav-reader'),
    gallery: document.getElementById('nav-gallery'),
    inspiration: document.getElementById('nav-inspiration'),
  };
  const breadcrumb = document.getElementById('breadcrumb');
  const panel = document.getElementById('detail-panel');
  const panelContent = document.getElementById('panel-content');
  const panelCloseBtn = document.getElementById('panel-close');
  const toc = document.getElementById('toc');
  const chapterBody = document.getElementById('chapter-body');
  const backToMap = document.getElementById('back-to-map');

  // 根据 locale 动态切换章节来源：中文→book/ 英文→book-en/
  // 用函数而非 const，让切语言后下一次 loadChapter 自动读到新 locale
  function getBookBase() {
    return localStorage.getItem('cc-locale') === 'en' ? 'book-en/' : 'book/';
  }

  let currentView = 'welcome';
  let currentChapter = null;
  let currentMetaphor = 'city'; // 'city' or 'os'

  // ===== METAPHOR SYSTEM =====
  const metaphorToggle = document.getElementById('metaphor-toggle');
  const metaphorIcon = document.getElementById('metaphor-icon');
  const metaphorLabel = document.getElementById('metaphor-label');
  const subtitleText = document.getElementById('subtitle-text');

  function setMetaphor(type) {
    currentMetaphor = type;
    const _isEnMeta = (function(){ try { return (localStorage.getItem('cc-locale')||'zh')==='en'; } catch(e){ return false; } })();
    if (type === 'city') {
      metaphorIcon.textContent = '🏙';
      metaphorLabel.textContent = _isEnMeta ? 'City' : '城市';
      if (subtitleText) subtitleText.textContent = _isEnMeta
        ? 'The Smart-City View of the Architecture'
        : '智慧城市 — 架构全景';
    } else {
      metaphorIcon.textContent = '🖥';
      metaphorLabel.textContent = 'OS';
      if (subtitleText) subtitleText.textContent = _isEnMeta
        ? 'Agent Operating System — Architecture Overview'
        : 'Agent Operating System — 架构全景';
    }
    // Update welcome buttons (supports both old .metaphor-btn and new .metaphor-btn-inline)
    document.querySelectorAll('.metaphor-btn, .metaphor-btn-inline').forEach(btn => {
      btn.classList.toggle('selected', btn.dataset.metaphor === type);
    });
  }

  if (metaphorToggle) {
    metaphorToggle.addEventListener('click', () => {
      setMetaphor(currentMetaphor === 'city' ? 'os' : 'city');
    });
  }
  // Welcome page metaphor buttons (supports both class names)
  document.querySelectorAll('.metaphor-btn, .metaphor-btn-inline').forEach(btn => {
    btn.addEventListener('click', () => setMetaphor(btn.dataset.metaphor));
  });
  // Enter map / start reading button → goes to reader view
  const enterBtn = document.getElementById('enter-map');
  if (enterBtn) enterBtn.addEventListener('click', () => showView('reader'));
  // Panorama button → goes to landing (architecture overview)
  const panoramaBtn = document.getElementById('enter-panorama');
  if (panoramaBtn) panoramaBtn.addEventListener('click', () => showView('landing'));

  setMetaphor('city'); // default

  // ===== VIEW ROUTING =====
  function showView(name) {
    Object.entries(views).forEach(([k, el]) => {
      if (el) el.classList.toggle('active', k === name);
    });
    Object.entries(navBtns).forEach(([k, btn]) => {
      if (btn) btn.classList.toggle('active', k === name);
    });
    currentView = name;
    closePanel();
    // 切视图时关闭所有 overlay（修复 ISS-01）
    document.body.classList.remove('review-mode-active');
    var reviewBtn = document.getElementById('review-mode-toggle');
    if (reviewBtn) { reviewBtn.classList.remove('active'); var lbl = reviewBtn.querySelector('.review-label'); if (lbl) lbl.textContent = '修订'; }
    var reviewGallery = document.getElementById('review-gallery');
    if (reviewGallery) reviewGallery.classList.remove('active');

    const _isEn = (function(){ try { return (localStorage.getItem('cc-locale')||'zh')==='en'; } catch(e){ return false; } })();
    const BC = _isEn
      ? { landing: 'System Overview', welcome: 'Welcome', gallery: 'Chart Gallery', inspiration: 'Inspiration Lab' }
      : { landing: '架构全景', welcome: '欢迎', gallery: '图表画廊', inspiration: '灵感实验室' };
    if (BC[name]) {
      breadcrumb.textContent = `Claude Code 2.1.88 · ${BC[name]}`;
    }
  }

  if (navBtns.guide) navBtns.guide.addEventListener('click', () => showView('welcome'));
  navBtns.home.addEventListener('click', () => showView('landing'));
  navBtns.reader.addEventListener('click', () => {
    showView('reader');
    if (!currentChapter) {
      const _isEn = (function(){ try { return (localStorage.getItem('cc-locale')||'zh')==='en'; } catch(e){ return false; } })();
      chapterBody.innerHTML = `
        <div class="empty-state">
          <h2>${_isEn ? 'Choose a chapter to begin' : '选择一个章节开始阅读'}</h2>
          <p>${_isEn ? 'Pick any chapter from the table of contents on the left' : '从左侧目录中选择任意章节'}</p>
        </div>`;
    }
  });

  // ===== Mobile TOC drawer =====
  const mobileTocBtn = document.getElementById('mobile-toc-toggle');
  const sidebarEl = document.getElementById('sidebar');
  let mobileBackdrop = null;
  function openMobileTOC() {
    if (!sidebarEl) return;
    sidebarEl.classList.add('mobile-open');
    if (mobileTocBtn) mobileTocBtn.setAttribute('aria-expanded', 'true');
    if (!mobileBackdrop) {
      mobileBackdrop = document.createElement('div');
      mobileBackdrop.className = 'mobile-toc-backdrop';
      mobileBackdrop.addEventListener('click', closeMobileTOC);
      document.body.appendChild(mobileBackdrop);
    }
    requestAnimationFrame(() => mobileBackdrop.classList.add('visible'));
  }
  function closeMobileTOC() {
    if (!sidebarEl) return;
    sidebarEl.classList.remove('mobile-open');
    if (mobileTocBtn) mobileTocBtn.setAttribute('aria-expanded', 'false');
    if (mobileBackdrop) {
      mobileBackdrop.classList.remove('visible');
      setTimeout(() => { if (mobileBackdrop) { mobileBackdrop.remove(); mobileBackdrop = null; } }, 220);
    }
  }
  if (mobileTocBtn) {
    mobileTocBtn.addEventListener('click', () => {
      if (sidebarEl && sidebarEl.classList.contains('mobile-open')) closeMobileTOC();
      else openMobileTOC();
    });
  }
  // 点 TOC 章节后自动关闭 drawer（移动端才有此行为，桌面无效因为没 .mobile-open）
  if (sidebarEl) {
    sidebarEl.addEventListener('click', (e) => {
      const tocChapter = e.target.closest('.toc-chapter');
      if (tocChapter && sidebarEl.classList.contains('mobile-open')) {
        setTimeout(closeMobileTOC, 100);
      }
    });
  }
  // Esc 关闭 drawer
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sidebarEl && sidebarEl.classList.contains('mobile-open')) {
      closeMobileTOC();
    }
  });
  // Gallery view
  if (navBtns.gallery) {
    let galleryInited = false;
    navBtns.gallery.addEventListener('click', () => {
      showView('gallery');
      if (!galleryInited && window.Gallery) {
        Gallery.init().then(() => {
          Gallery.render(document.getElementById('gallery-container'));
          galleryInited = true;
        });
      } else if (window.Gallery) {
        Gallery.render(document.getElementById('gallery-container'));
      }
    });
  }

  // Inspiration Lab view
  if (navBtns.inspiration) {
    let inspInited = false;
    navBtns.inspiration.addEventListener('click', () => {
      showView('inspiration');
      const container = document.getElementById('inspiration-container');
      if (!inspInited && window.InspirationLab) {
        // Bug 修复 2026-04-27：之前点开 → 容器空白 → fetch ~600KB 后才显示，
        // 用户感觉"卡死"。立刻先渲染 loading 骨架屏。
        const _isEnInsp = (function(){ try { return (localStorage.getItem('cc-locale')||'zh')==='en'; } catch(e){ return false; } })();
        if (container) {
          container.innerHTML = `
            <div class="insp-loading" style="text-align:center;padding:80px 24px;color:var(--text-muted, #8c8378);">
              <div style="display:inline-block;width:48px;height:48px;border:3px solid var(--border, #2a2a2a);border-top-color:var(--accent, #c77d2e);border-radius:50%;animation:insp-spin 0.9s linear infinite;margin-bottom:16px;"></div>
              <div style="font-size:14px;letter-spacing:0.05em;">${_isEnInsp ? 'Loading inspirations…' : '灵感加载中…'}</div>
              <style>@keyframes insp-spin{to{transform:rotate(360deg);}}</style>
            </div>`;
        }
        InspirationLab.init().then(() => {
          InspirationLab.render(container);
          inspInited = true;
        });
      } else if (window.InspirationLab) {
        InspirationLab.render(container);
      }
    });
  }

  if (backToMap) backToMap.addEventListener('click', () => showView('landing'));

  // ===== DETAIL PANEL =====
  function openPanel(componentId) {
    const data = COMPONENTS[componentId];
    if (!data) return;

    panelContent.innerHTML = renderPanelHTML(data);
    panel.classList.remove('hidden');
    requestAnimationFrame(() => panel.classList.add('visible'));

    // Wire up chapter links inside panel
    panelContent.querySelectorAll('.panel-link[data-chapter]').forEach(link => {
      link.addEventListener('click', () => {
        const chId = link.dataset.chapter;
        closePanel();
        showView('reader');
        loadChapterById(chId);
      });
    });
  }

  function closePanel() {
    panel.classList.remove('visible');
    setTimeout(() => panel.classList.add('hidden'), 350);
  }

  panelCloseBtn.addEventListener('click', closePanel);

  // Click outside panel to close
  document.addEventListener('click', (e) => {
    if (panel.classList.contains('visible') &&
        !panel.contains(e.target) &&
        !e.target.closest('.node')) {
      closePanel();
    }
  });

  function renderPanelHTML(data) {
    // i18n: read locale per render（与切换器一致），优先取 fieldEn 回退中文
    const isEn = (function(){ try { return (localStorage.getItem('cc-locale')||'zh')==='en'; } catch(e){ return false; } })();
    function pick(field) {
      if (!data) return '';
      if (isEn && data[field + 'En'] != null) return data[field + 'En'];
      return data[field] != null ? data[field] : '';
    }
    function pickFrom(obj, field) {
      if (!obj) return '';
      if (isEn && obj[field + 'En'] != null) return obj[field + 'En'];
      return obj[field] != null ? obj[field] : '';
    }

    // Stats with explanations
    const statsHTML = data.stats.map(s => {
      const lbl = pickFrom(s, 'lbl');
      const explanation = pickFrom(s, 'explain');
      return `<div class="panel-stat-card">
        <div class="val" style="color:${data.color}">${s.val}</div>
        <div class="lbl">${lbl}</div>
        ${explanation ? `<div class="stat-explain">${explanation}</div>` : ''}
      </div>`;
    }).join('');

    // Concepts —— 统一渲染：永远 name + explain（即使 explain 为空），消除字号不一致
    const conceptsHTML = data.concepts.map(c => {
      let name, explain;
      if (typeof c === 'object' && c !== null) {
        name = pickFrom(c, 'name');
        explain = pickFrom(c, 'explain');
      } else {
        name = c;
        explain = '';
      }
      return `<li>
        <div class="concept-name">${name}</div>
        ${explain ? `<div class="concept-explain">${explain}</div>` : ''}
      </li>`;
    }).join('');

    const chaptersHTML = data.chapters.map(ch => {
      const chId = findChapterId(ch.part, ch.num);
      const partLabel = pickFrom(ch, 'part') || ch.part;
      const chTitle = pickFrom(ch, 'title') || ch.title;
      return `<div class="panel-link" data-chapter="${chId || ''}">
        <span>${partLabel} / ${chTitle}</span>
        <span class="arrow">→</span>
      </div>`;
    }).join('');

    // Pick metaphor based on current setting + locale
    const cityMeta = pick('cityMetaphor') || pick('metaphor');
    const osMeta = pick('metaphor');
    const metaphorText = currentMetaphor === 'city' ? cityMeta : osMeta;
    const cityAna = pick('cityAnalogy') || pick('osAnalogy');
    const osAna = pick('osAnalogy');
    const analogyText = currentMetaphor === 'city' ? cityAna : osAna;
    const analogyLabel = currentMetaphor === 'city'
      ? (isEn ? '🏙 City Analogy' : '🏙 城市类比')
      : (isEn ? '🔑 OS Analogy' : '🔑 OS 类比');

    // Section labels —— 统一 i18n
    const L = isEn ? {
      whyMatters: 'Why it matters: ',
      keyData: 'Key Data',
      overview: 'Overview',
      coreConcepts: 'Core Concepts',
      relatedChapters: 'Related Chapters',
    } : {
      whyMatters: '为什么重要：',
      keyData: '关键数据',
      overview: '概述',
      coreConcepts: '核心概念',
      relatedChapters: '相关章节',
    };

    const title = pick('title');
    const description = pick('description');
    const whyMatters = pick('whyMatters');

    return `
      <div class="panel-header">
        <div class="panel-icon" style="background:${data.color}20;color:${data.color};border:1px solid ${data.color}40">${data.icon}</div>
        <div>
          <div class="panel-title" style="color:${data.color}">${title}</div>
          <div class="panel-subtitle">${metaphorText}</div>
        </div>
      </div>

      <div class="os-analogy">${analogyLabel}: ${analogyText}</div>

      ${whyMatters ? `<div class="panel-why-matters"><strong>${L.whyMatters}</strong>${whyMatters}</div>` : ''}

      <div class="panel-section">
        <h3>${L.keyData}</h3>
        <div class="panel-stat-grid">${statsHTML}</div>
      </div>

      <div class="panel-section">
        <h3>${L.overview}</h3>
        <div class="panel-description">${description}</div>
      </div>

      <div class="panel-section">
        <h3>${L.coreConcepts}</h3>
        <ul class="concept-list">${conceptsHTML}</ul>
      </div>

      <div class="panel-section">
        <h3>${L.relatedChapters}</h3>
        <div class="panel-links">${chaptersHTML}</div>
      </div>
    `;
  }

  function findChapterId(partLabel, num) {
    // partLabel like "Part 2", num like "04" or "Q02"
    const partNum = partLabel.replace('Part ', '');
    for (const part of BOOK_STRUCTURE) {
      if (part.id === `part${partNum}`) {
        for (const ch of part.chapters) {
          if (ch.id.endsWith(num) || ch.id.endsWith(`-${num}`)) return ch.id;
        }
      }
    }
    return null;
  }

  // ===== SVG NODE CLICK → PANEL =====
  document.querySelectorAll('.node').forEach(node => {
    node.addEventListener('click', (e) => {
      e.stopPropagation();
      openPanel(node.dataset.component);
    });
    node.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openPanel(node.dataset.component);
      }
    });
  });

  // ===== TABLE OF CONTENTS =====
  // Part 标题的 i18n 映射（中英双语）
  const PART_TITLE_EN = {
    'Part 0 · 序章': 'Part 0 · Prologue',
    'Part 1 · 认识这个系统': 'Part 1 · Understanding the System',
    'Part 2 · 代码架构完全解构': 'Part 2 · Architecture Deep Dive',
    'Part 3 · 子系统完全解析': 'Part 3 · Subsystems',
    'Part 4 · 工程哲学': 'Part 4 · Engineering Philosophy',
    'Part 5 · 批判与超越': 'Part 5 · Critique & Beyond',
    'Part 6 · 好奇心驱动的深度问答': 'Part 6 · Deep Q&A',
    'Part 7 · 补遗与延伸': 'Part 7 · Addenda & Extensions'
  };
  function buildTOC() {
    toc.innerHTML = '';
    const isEn = (function(){ try { return (localStorage.getItem('cc-locale')||'zh')==='en'; } catch(e){ return false; } })();
    BOOK_STRUCTURE.forEach((part, partIndex) => {
      const partDiv = document.createElement('div');
      partDiv.className = 'toc-part';

      const title = document.createElement('div');
      title.className = 'toc-part-title';
      // 优先级：part.titleEn > PART_TITLE_EN 映射 > part.title
      if (isEn) {
        title.textContent = part.titleEn || PART_TITLE_EN[part.title] || part.title;
      } else {
        title.textContent = part.title;
      }
      title.addEventListener('click', () => partDiv.classList.toggle('expanded'));
      partDiv.appendChild(title);

      const chaptersDiv = document.createElement('div');
      chaptersDiv.className = 'toc-chapters';

      let lastGroup = null;
      part.chapters.forEach((ch, chIndex) => {
        // 分组标题
        if (ch.group && ch.group !== lastGroup) {
          const groupEl = document.createElement('div');
          groupEl.className = 'toc-subgroup';
          groupEl.textContent = isEn && ch.groupEn ? ch.groupEn : ch.group;
          chaptersDiv.appendChild(groupEl);
          lastGroup = ch.group;
        }
        const item = document.createElement('div');
        item.className = 'toc-chapter';
        // 层级编号：Part 0 序章不编号，Q&A 章节保留 Q 前缀，其他用 partIndex.chIndex+1
        // i18n: 优先用 titleEn（如果存在），否则回退到 title
        var rawLabel = isEn && ch.titleEn ? ch.titleEn : ch.title;
        var label = rawLabel;
        if (/^Q\d+/.test(label)) {
          // Q 前缀改为小图标 + 纯标题
          var qNum = label.match(/^Q(\d+)/)[1];
          var qTitle = label.replace(/^Q\d+\s*/, '');
          item.innerHTML = '<span class="toc-q-badge">Q' + qNum + '</span>' + qTitle;
        } else if (/^\d+/.test(label)) {
          label = label.replace(/^\d+\s*/, partIndex + '.' + (chIndex + 1) + ' ');
          item.textContent = label;
        } else if (partIndex > 0) {
          label = partIndex + '.' + (chIndex + 1) + ' ' + label;
          item.textContent = label;
        } else {
          item.textContent = label;
        }
        item.dataset.chapterId = ch.id;
        item.addEventListener('click', () => loadChapter(ch));
        // Prefetch on hover（desktop）/ touchstart（mobile）—— 用户意图显露时提前把章节 md
        // 塞进浏览器 cache，等真 click 时 fetch 命中 memory/disk cache ≈ 几十毫秒。
        let prefetched = false;
        const prefetch = () => {
          if (prefetched) return;
          prefetched = true;
          try { fetch(getBookBase() + ch.file, { cache: 'force-cache', priority: 'low' }).catch(() => {}); } catch (_) {}
        };
        item.addEventListener('mouseenter', prefetch);
        item.addEventListener('touchstart', prefetch, { passive: true });
        chaptersDiv.appendChild(item);
      });

      partDiv.appendChild(chaptersDiv);
      toc.appendChild(partDiv);
    });

    // Auto-expand Part 0, 1, 2（前三个 Part）
    toc.querySelectorAll('.toc-part').forEach(function(p, i) {
      if (i < 3) p.classList.add('expanded');
    });
  }

  // ===== CHAPTER LOADING =====
  async function loadChapter(ch) {
    // Bug B 修复（2026-04-26）：切语言时会重新 loadChapter，
    // 如果是同章节，保留滚动位置 + 滚动百分比（中英长度可能不同，按 % 还原）
    const isSameChapter = currentChapter && currentChapter.id === ch.id;
    let preserveScrollPct = null;
    if (isSameChapter) {
      const scroller = document.querySelector('#chapter-content') || document.scrollingElement || document.documentElement;
      if (scroller && scroller.scrollHeight > scroller.clientHeight) {
        preserveScrollPct = scroller.scrollTop / (scroller.scrollHeight - scroller.clientHeight);
      }
    }
    currentChapter = ch;

    // Update TOC active state
    toc.querySelectorAll('.toc-chapter').forEach(el => {
      el.classList.toggle('active', el.dataset.chapterId === ch.id);
    });

    // Expand parent part
    const parentPart = toc.querySelector(`[data-chapter-id="${ch.id}"]`)?.closest('.toc-part');
    if (parentPart) parentPart.classList.add('expanded');

    // Update breadcrumb, nav, and URL
    const _isEnCh = (function(){ try { return (localStorage.getItem('cc-locale')||'zh')==='en'; } catch(e){ return false; } })();
    breadcrumb.textContent = _isEnCh && ch.titleEn ? ch.titleEn : ch.title;
    updateChapterNav();
    history.replaceState(null, '', `#chapter-${ch.id}`);

    // 把保留的 scroll 百分比挂到本次 fetch 后的渲染流程
    if (preserveScrollPct !== null) {
      window.__pendingScrollPct = preserveScrollPct;
    }

    // 防抖 loading 占位符 —— fetch 在 300ms 内完成就不闪"加载中..."
    // 避免短暂网络请求让用户感觉卡顿（保留原内容直到新内容就位）
    let loadingShown = false;
    const loadingTimer = setTimeout(() => {
      loadingShown = true;
      chapterBody.innerHTML = `<div class="empty-state"><p>${_isEnCh ? 'Loading…' : '加载中...'}</p></div>`;
    }, 300);

    try {
      const resp = await fetch(getBookBase() + ch.file);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const md = await resp.text();
      clearTimeout(loadingTimer);
      renderMarkdown(md);
      // Bug B 修复：还原切语言前的滚动位置（按百分比，因中英长度不同）
      if (typeof window.__pendingScrollPct === 'number') {
        const pct = window.__pendingScrollPct;
        window.__pendingScrollPct = null;
        // 多次 rAF 等图表 lazy load 撑高内容
        const restore = () => {
          const scroller = document.querySelector('#chapter-content') || document.scrollingElement || document.documentElement;
          if (scroller && scroller.scrollHeight > scroller.clientHeight) {
            scroller.scrollTop = pct * (scroller.scrollHeight - scroller.clientHeight);
          }
        };
        requestAnimationFrame(() => requestAnimationFrame(() => {
          restore();
          // 二次还原（图表渲染完后内容会再变高）
          setTimeout(restore, 300);
          setTimeout(restore, 800);
        }));
      }
    } catch (err) {
      clearTimeout(loadingTimer);
      // 用户向错误提示——不再泄漏开发者命令（python3 -m http.server）
      // 提供 Retry 按钮，让用户在临时网络抖动后重试
      const retryId = 'chapter-retry-' + Date.now();
      chapterBody.innerHTML = _isEnCh ? `
        <div class="empty-state">
          <h2>Chapter unavailable</h2>
          <p>We couldn't load this chapter right now.</p>
          <p style="color:#9a8b76;margin-top:8px;font-size:13px">If the problem persists, please try a different chapter from the table of contents.</p>
          <button id="${retryId}" class="cc-btn-retry" style="margin-top:18px;padding:8px 18px;background:transparent;border:1px solid var(--border);color:var(--text-primary);border-radius:4px;cursor:pointer;font-family:inherit;">Retry</button>
        </div>` : `
        <div class="empty-state">
          <h2>章节暂时无法显示</h2>
          <p>这一章节暂时没能加载出来。</p>
          <p style="color:#9a8b76;margin-top:8px;font-size:13px">如果问题持续，请从左侧目录选择其他章节。</p>
          <button id="${retryId}" class="cc-btn-retry" style="margin-top:18px;padding:8px 18px;background:transparent;border:1px solid var(--border);color:var(--text-primary);border-radius:4px;cursor:pointer;font-family:inherit;">重试</button>
        </div>`;
      var btn = document.getElementById(retryId);
      if (btn) btn.addEventListener('click', function() { loadChapter(ch); });
    }
  }

  function loadChapterById(chId) {
    if (!chId) return;
    for (const part of BOOK_STRUCTURE) {
      for (const ch of part.chapters) {
        if (ch.id === chId) { loadChapter(ch); return; }
      }
    }
  }

  // 全站代码块复制按钮（2026-04-29）：覆盖 chapter / inspiration / 任何动态渲染处
  function addCopyButtons(root) {
    if (!root) return;
    var isEnFn = function() { try { return (localStorage.getItem('cc-locale') || 'zh') === 'en'; } catch(e) { return false; } };
    root.querySelectorAll('pre').forEach(function(pre) {
      if (pre.querySelector('.copy-btn')) return;
      // 跳过过短的内联式 pre
      var text0 = (pre.textContent || '').trim();
      if (text0.length < 20) return;
      var btn = document.createElement('button');
      btn.className = 'copy-btn';
      btn.type = 'button';
      btn.setAttribute('aria-label', isEnFn() ? 'Copy' : '复制');
      btn.title = isEnFn() ? 'Copy' : '复制';
      btn.innerHTML = '<span class="copy-icon">⧉</span>';
      btn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        var code = pre.querySelector('code') || pre;
        var text = code.innerText || code.textContent || '';
        var done = function(ok) {
          btn.classList.toggle('copied', ok);
          btn.classList.toggle('failed', !ok);
          btn.innerHTML = ok ? (isEnFn() ? '✓ Copied' : '✓ 已复制') : (isEnFn() ? '✗ Failed' : '✗ 失败');
          setTimeout(function() {
            btn.classList.remove('copied', 'failed');
            btn.innerHTML = '<span class="copy-icon">⧉</span>';
          }, 1500);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(function() { done(true); }, function() { done(false); });
        } else {
          // 兜底：textarea + execCommand
          try {
            var ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed'; ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            var ok = document.execCommand('copy');
            document.body.removeChild(ta);
            done(ok);
          } catch (err) { done(false); }
        }
      });
      pre.appendChild(btn);
    });
  }
  // 暴露给其他模块（chart-embed / inspiration 等如有需要）
  window.__addCopyButtons = addCopyButtons;

  // ==================== Prompt 中英切换（2026-04-29）====================
  // 数据：book/_shared/prompt-translations.json — { "section_id": { en, zh, title } }
  // 位置：仅在 14_Prompt原文集 章节生效（其他章节不需要）
  // 持久化：localStorage['cc-prompt-lang'] = 'en' | 'zh'
  var __PROMPT_TRANSLATIONS = null;
  var __PROMPT_TRANSLATIONS_PROMISE = null;

  function loadPromptTranslations() {
    if (__PROMPT_TRANSLATIONS) return Promise.resolve(__PROMPT_TRANSLATIONS);
    if (__PROMPT_TRANSLATIONS_PROMISE) return __PROMPT_TRANSLATIONS_PROMISE;
    __PROMPT_TRANSLATIONS_PROMISE = fetch('book/_shared/prompt-translations.json')
      .then(function(r) { return r.ok ? r.json() : {}; })
      .then(function(data) { __PROMPT_TRANSLATIONS = data; return data; })
      .catch(function() { __PROMPT_TRANSLATIONS = {}; return {}; });
    return __PROMPT_TRANSLATIONS_PROMISE;
  }

  function getPromptLang() {
    try { return localStorage.getItem('cc-prompt-lang') || 'en'; } catch(e) { return 'en'; }
  }
  function setPromptLang(v) {
    try { localStorage.setItem('cc-prompt-lang', v); } catch(e) {}
  }

  // 给每个 ### N.M 标题之后的第一个 <pre>（"原文" block）打 data-prompt-id 标签
  // 并在其上方注入 [EN] [中] tab
  function wirePromptLangToggles(root) {
    if (!root) return;
    // 仅当当前章节是 14_Prompt原文集（heading 文本里含"Prompt 原文集" / "Prompt Collection"）
    var firstH1 = root.querySelector('h1');
    var isPromptChapter = firstH1 && /Prompt\s*原文集|Prompt\s*Collection|Prompt\s*Library/i.test(firstH1.textContent);
    if (!isPromptChapter) return;

    var headings = root.querySelectorAll('h3');
    headings.forEach(function(h3) {
      var m = (h3.textContent || '').match(/^\s*(\d+(?:\.\d+)?)\s/);
      if (!m) return;
      var sid = m[1];
      // 找它后面紧邻的第一个 pre（跨过 <p> 等）
      var node = h3.nextElementSibling;
      var firstPre = null;
      while (node && node.tagName !== 'H3' && node.tagName !== 'H2') {
        if (node.tagName === 'PRE' && !firstPre) {
          firstPre = node;
          break;
        }
        node = node.nextElementSibling;
      }
      if (!firstPre) return;
      firstPre.setAttribute('data-prompt-id', sid);
      // 保存原 EN 文本（用于切回）
      var codeEl = firstPre.querySelector('code') || firstPre;
      if (!firstPre.hasAttribute('data-prompt-en')) {
        firstPre.setAttribute('data-prompt-en', codeEl.textContent || '');
      }

      // 注入 toolbar（如已存在则跳过）
      if (firstPre.previousElementSibling && firstPre.previousElementSibling.classList.contains('prompt-lang-tabs')) return;
      var tabs = document.createElement('div');
      tabs.className = 'prompt-lang-tabs';
      tabs.innerHTML =
        '<button class="prompt-lang-tab" data-lang="en" type="button">EN</button>' +
        '<button class="prompt-lang-tab" data-lang="zh" type="button">中</button>';
      firstPre.parentNode.insertBefore(tabs, firstPre);
      tabs.addEventListener('click', function(e) {
        var btn = e.target.closest('.prompt-lang-tab');
        if (!btn) return;
        var lang = btn.dataset.lang;
        setPromptLang(lang);
        applyPromptLangAll(root);
      });
    });

    // 应用当前 lang 一次
    applyPromptLangAll(root);
  }

  function applyPromptLangAll(root) {
    var lang = getPromptLang();
    // 同步 tab active 态
    root.querySelectorAll('.prompt-lang-tabs').forEach(function(tabs) {
      tabs.querySelectorAll('.prompt-lang-tab').forEach(function(b) {
        b.classList.toggle('active', b.dataset.lang === lang);
      });
    });
    // 切换 pre 内容
    var pres = root.querySelectorAll('pre[data-prompt-id]');
    if (pres.length === 0) return;
    if (lang === 'en') {
      pres.forEach(function(pre) {
        var code = pre.querySelector('code') || pre;
        var en = pre.getAttribute('data-prompt-en') || '';
        if (code.textContent !== en) code.textContent = en;
      });
      // 重新高亮
      if (window.hljs) pres.forEach(function(p) { var c = p.querySelector('code'); if (c) hljs.highlightElement(c); });
      return;
    }
    // zh：异步加载翻译数据
    loadPromptTranslations().then(function(data) {
      pres.forEach(function(pre) {
        var sid = pre.getAttribute('data-prompt-id');
        var code = pre.querySelector('code') || pre;
        var entry = data[sid];
        if (entry && entry.zh && entry.zh.trim()) {
          code.textContent = entry.zh;
        } else {
          // 翻译尚未完成 — 显示占位 + 保留 EN
          var en = pre.getAttribute('data-prompt-en') || '';
          code.textContent = '【中文翻译进行中…暂显示英文原文】\n\n' + en;
        }
      });
      if (window.hljs) pres.forEach(function(p) { var c = p.querySelector('code'); if (c) hljs.highlightElement(c); });
    });
  }
  // ==================== END Prompt 中英切换 ====================


  function renderMarkdown(md) {
    if (window.marked) {
      // Use marked.parse (works across v4-v14+)
      try {
        chapterBody.innerHTML = marked.parse(md);
      } catch (e) {
        // Fallback for very old/new API changes
        chapterBody.innerHTML = marked(md);
      }
      // Post-render syntax highlighting
      if (window.hljs) {
        chapterBody.querySelectorAll('pre code').forEach(block => {
          hljs.highlightElement(block);
        });
      }
      // 一键复制按钮注入（用户要求 2026-04-29）
      addCopyButtons(chapterBody);
      // Prompt 中英切换 tab（仅 14_Prompt原文集 章节）— 见 wirePromptLangToggles()
      wirePromptLangToggles(chapterBody);
      // 性能优化（2026-04-25）：所有章节内图片加 lazy + async decode，
      // 防止滚动到对应位置之前消耗带宽。images/ 目录有 33MB，多张大图，
      // 不 lazy 会拖慢章节切换。
      chapterBody.querySelectorAll('img').forEach(img => {
        if (!img.hasAttribute('loading')) img.setAttribute('loading', 'lazy');
        if (!img.hasAttribute('decoding')) img.setAttribute('decoding', 'async');
      });
    } else {
      chapterBody.innerHTML = '<pre style="white-space:pre-wrap">' + escapeHTML(md) + '</pre>';
    }
    // Classify blockquotes by their content prefix (emoji)
    chapterBody.querySelectorAll('blockquote').forEach(bq => {
      const text = bq.textContent.trim();
      if (text.startsWith('🌍')) bq.classList.add('bq-industry');
      else if (text.startsWith('📚') || text.startsWith('🎓')) bq.classList.add('bq-course');
      else if (text.startsWith('💡')) bq.classList.add('bq-layperson');
      else if (text.startsWith('🔑')) bq.classList.add('bq-os');
      else if (text.startsWith('⚠️')) bq.classList.add('bq-warning');
    });
    // Wrap wide tables for horizontal scroll
    chapterBody.querySelectorAll('table').forEach(table => {
      if (!table.parentElement.classList.contains('table-wrapper')) {
        const wrapper = document.createElement('div');
        wrapper.className = 'table-wrapper';
        table.parentNode.insertBefore(wrapper, table);
        wrapper.appendChild(table);
      }
    });
    // Embed interactive charts (replaces [图表预留 X.X-X] placeholders)
    // 传入 bookFile 启用 B 路径：游离图表会在章节末尾"本章配图"附录里自动归位
    if (window.ChartEmbed) {
      ChartEmbed.embed(chapterBody, {
        bookFile: currentChapter ? currentChapter.file : null
      });
    }
    // Annotate glossary terms, difficulty badge, and Q&A panel
    if (window.GlossarySystem && currentChapter) {
      GlossarySystem.annotate(chapterBody, currentChapter.file);
    }
    // 章节内 H2/H3 锚点导航（侧边栏第三级）
    buildChapterSectionNav();
    // Scroll to top
    document.getElementById('chapter-content').scrollTop = 0;
  }

  // ===== 章节内标题锚点导航 =====
  let sectionObserver = null;

  function buildChapterSectionNav() {
    // 清除旧导航
    const existing = document.getElementById('chapter-section-nav');
    if (existing) existing.remove();
    if (sectionObserver) { sectionObserver.disconnect(); sectionObserver = null; }

    const headings = [...chapterBody.querySelectorAll('h2, h3')];
    if (headings.length < 2) return;

    const nav = document.createElement('div');
    nav.id = 'chapter-section-nav';

    const title = document.createElement('div');
    title.className = 'chapter-section-nav-title';
    const _isEn = (function(){ try { return (localStorage.getItem('cc-locale')||'zh')==='en'; } catch(e){ return false; } })();
    title.textContent = _isEn ? 'In This Chapter' : '本章目录';
    nav.appendChild(title);

    const chapterContent = document.getElementById('chapter-content');

    headings.forEach((h, i) => {
      // 为标题分配锚点 ID
      if (!h.id) h.id = 'sec-' + i;

      const item = document.createElement('div');
      item.className = 'chapter-section-item' + (h.tagName === 'H3' ? ' section-h3' : ' section-h2');
      item.dataset.targetId = h.id;
      item.textContent = h.textContent.replace(/^#+\s*/, '');
      item.title = item.textContent;

      item.addEventListener('click', () => {
        const containerTop = chapterContent.getBoundingClientRect().top;
        const headingTop = h.getBoundingClientRect().top;
        const scrollOffset = chapterContent.scrollTop + (headingTop - containerTop) - 24;
        chapterContent.scrollTo({ top: scrollOffset, behavior: 'smooth' });
      });

      nav.appendChild(item);
    });

    var rightPanel = document.getElementById('chapter-toc-panel');
    if (rightPanel) { rightPanel.innerHTML = ''; rightPanel.appendChild(nav); } else { toc.appendChild(nav); }

    // 滚动监听：高亮当前可见标题（取最上方的一个）
    const navItems = [...nav.querySelectorAll('.chapter-section-item')];
    let activeHeadingId = null;
    if (typeof IntersectionObserver !== 'undefined') {
      const visibleHeadings = new Set();
      sectionObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) visibleHeadings.add(entry.target.id);
          else visibleHeadings.delete(entry.target.id);
        });
        // 取可见标题中在文档里最靠前的那个
        let topId = null;
        for (const h of headings) {
          if (visibleHeadings.has(h.id)) { topId = h.id; break; }
        }
        if (topId && topId !== activeHeadingId) {
          activeHeadingId = topId;
          navItems.forEach(item => {
            item.classList.toggle('section-active', item.dataset.targetId === topId);
          });
        }
      }, {
        root: chapterContent,
        rootMargin: '-20px 0px -70% 0px',
        threshold: 0
      });
      headings.forEach(h => sectionObserver.observe(h));
    }
  }

  function escapeHTML(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ===== FLAT CHAPTER LIST (for navigation) =====
  const allChapters = BOOK_STRUCTURE.flatMap(p => p.chapters);

  function getChapterIndex(ch) {
    return allChapters.findIndex(c => c.id === ch.id);
  }

  function updateChapterNav() {
    if (!currentChapter) return;
    const idx = getChapterIndex(currentChapter);
    const total = allChapters.length;
    const hasPrev = idx > 0;
    const hasNext = idx < total - 1;

    ['prev-chapter', 'prev-chapter-bottom'].forEach(id => {
      const btn = document.getElementById(id);
      btn.disabled = !hasPrev;
      if (hasPrev) btn.onclick = () => loadChapter(allChapters[idx - 1]);
    });
    ['next-chapter', 'next-chapter-bottom'].forEach(id => {
      const btn = document.getElementById(id);
      btn.disabled = !hasNext;
      if (hasNext) btn.onclick = () => loadChapter(allChapters[idx + 1]);
    });
    const posText = `${idx + 1} / ${total}`;
    const posEl = document.getElementById('chapter-position');
    const posElB = document.getElementById('chapter-position-bottom');
    if (posEl) posEl.textContent = posText;
    if (posElB) posElB.textContent = posText;
  }

  // ===== FULL-TEXT SEARCH =====
  const tocSearch = document.getElementById('toc-search');
  const searchResultsEl = document.getElementById('search-results');
  let searchIndex = null;
  let searchDebounceTimer = null;

  // 加载搜索索引（700KB，性能优化 2026-04-25：延迟到首次聚焦搜索框 / idle 才 fetch）
  let searchIndexPromise = null;
  function ensureSearchIndex() {
    if (searchIndex) return Promise.resolve(searchIndex);
    if (searchIndexPromise) return searchIndexPromise;
    searchIndexPromise = fetch('js/search-index.json')
      .then(r => r.ok ? r.json() : Promise.reject('索引加载失败'))
      .then(data => { searchIndex = data; return data; })
      .catch(() => { console.warn('[Search] 搜索索引加载失败，仅支持标题搜索'); return null; });
    return searchIndexPromise;
  }
  // 首次聚焦 / 输入搜索框 → 立刻拉取；加载完成后自动重跑当前查询
  if (tocSearch) {
    var triggerSearchLoad = function(){
      ensureSearchIndex().then(function(){
        if (tocSearch.value) performSearch(tocSearch.value);
      });
    };
    tocSearch.addEventListener('focus', triggerSearchLoad, { once: true });
    tocSearch.addEventListener('input', triggerSearchLoad, { once: true });
  }
  // idle 兜底：5s 后浏览器空闲时静默预热（不会与首屏抢带宽）
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(function(){ ensureSearchIndex(); }, { timeout: 8000 });
  } else {
    setTimeout(function(){ ensureSearchIndex(); }, 5000);
  }

  /**
   * 在文本中高亮关键词，返回 HTML
   */
  function highlightKeyword(text, keyword) {
    if (!keyword) return escapeHtml(text);
    const escaped = escapeHtml(text);
    const kw = escapeHtml(keyword);
    // 用正则全局替换（忽略大小写）
    const regex = new RegExp('(' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
    return escaped.replace(regex, '<mark class="search-highlight">$1</mark>');
  }

  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /**
   * 从匹配文本中提取关键词附近的片段（前后各留一些上下文）
   */
  function extractSnippet(text, keyword, maxLen) {
    maxLen = maxLen || 80;
    const lower = text.toLowerCase();
    const kwLower = keyword.toLowerCase();
    const idx = lower.indexOf(kwLower);
    if (idx < 0) return text.slice(0, maxLen);
    const start = Math.max(0, idx - 30);
    const end = Math.min(text.length, idx + keyword.length + 50);
    let snippet = text.slice(start, end);
    if (start > 0) snippet = '...' + snippet;
    if (end < text.length) snippet = snippet + '...';
    return snippet;
  }

  /**
   * 执行全文搜索
   */
  function performSearch(query) {
    const q = query.trim().toLowerCase();

    // 如果搜索为空，恢复正常目录显示
    if (!q) {
      if (searchResultsEl) {
        searchResultsEl.classList.add('hidden');
        searchResultsEl.innerHTML = '';
      }
      toc.style.display = '';
      // 恢复所有 TOC 条目的显示
      toc.querySelectorAll('.toc-part').forEach(p => p.classList.remove('hidden-by-search'));
      toc.querySelectorAll('.toc-chapter').forEach(c => c.classList.remove('hidden-by-search'));
      return;
    }

    // 先进行标题搜索（TOC 过滤）
    const titleMatches = new Set();
    toc.querySelectorAll('.toc-part').forEach(partDiv => {
      const chapters = partDiv.querySelectorAll('.toc-chapter');
      let anyVisible = false;
      chapters.forEach(ch => {
        const match = ch.textContent.toLowerCase().includes(q);
        ch.classList.toggle('hidden-by-search', !match);
        if (match) {
          anyVisible = true;
          titleMatches.add(ch.dataset.chapterId);
        }
      });
      partDiv.classList.toggle('hidden-by-search', !anyVisible);
      if (q && anyVisible) partDiv.classList.add('expanded');
    });

    // 全文搜索（从索引中查找）
    if (!searchIndex || !searchResultsEl) return;

    const results = [];
    const MAX_RESULTS = 30;

    for (const entry of searchIndex) {
      if (results.length >= MAX_RESULTS) break;

      // 标题匹配（已在 TOC 中显示，但也加入全文结果以显示片段）
      const titleMatch = entry.title.toLowerCase().includes(q);

      // 搜索每个段落
      for (const section of entry.sections) {
        if (results.length >= MAX_RESULTS) break;
        const headingMatch = section.heading.toLowerCase().includes(q);
        const textMatch = section.text.toLowerCase().includes(q);

        if (headingMatch || textMatch) {
          results.push({
            chapterId: entry.id,
            chapterTitle: entry.title,
            sectionHeading: section.heading,
            text: section.text,
            isTitleOnly: titleMatch && !textMatch && !headingMatch,
          });
        }
      }

      // 如果标题匹配但没有正文匹配，也至少添加一条
      if (titleMatch && !results.some(r => r.chapterId === entry.id)) {
        const firstSection = entry.sections[0];
        results.push({
          chapterId: entry.id,
          chapterTitle: entry.title,
          sectionHeading: firstSection ? firstSection.heading : '',
          text: firstSection ? firstSection.text : '',
          isTitleOnly: true,
        });
      }
    }

    // 渲染搜索结果
    if (results.length === 0) {
      toc.style.display = '';
      searchResultsEl.classList.add('hidden');
      searchResultsEl.innerHTML = '';
      return;
    }

    // 隐藏 TOC，显示搜索结果
    toc.style.display = 'none';
    searchResultsEl.classList.remove('hidden');

    let html = `<div class="search-results-header">找到 ${results.length} 条结果${results.length >= MAX_RESULTS ? '（仅显示前 ' + MAX_RESULTS + ' 条）' : ''}</div>`;

    results.forEach(r => {
      const snippet = extractSnippet(r.text, q);
      const highlightedSnippet = highlightKeyword(snippet, q);
      const highlightedHeading = highlightKeyword(r.sectionHeading, q);
      const highlightedTitle = highlightKeyword(r.chapterTitle, q);

      html += `<div class="search-result-item" data-chapter-id="${r.chapterId}">
        <div class="search-result-title">${highlightedTitle}</div>
        <div class="search-result-section">${highlightedHeading}</div>
        <div class="search-result-snippet">${highlightedSnippet}</div>
      </div>`;
    });

    searchResultsEl.innerHTML = html;

    // 绑定点击事件
    searchResultsEl.querySelectorAll('.search-result-item').forEach(item => {
      item.addEventListener('click', () => {
        const chId = item.dataset.chapterId;
        loadChapterById(chId);
      });
    });
  }

  if (tocSearch) {
    tocSearch.addEventListener('input', () => {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(() => {
        performSearch(tocSearch.value);
      }, 250); // 250ms 防抖
    });

    // Escape 清空搜索
    tocSearch.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        tocSearch.value = '';
        performSearch('');
        tocSearch.blur();
      }
    });
  }

  // ===== KEYBOARD SHORTCUTS =====
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (panel.classList.contains('visible')) closePanel();
      else if (currentView === 'reader') showView('landing');
    }
    // 快捷键映射（与导航栏 3 个按钮对齐）
    // 1 = landing (全景), 2 = reader (章节), 3 = inspiration (灵感)
    // 旧的 3 = gallery 已删除（图表画廊功能已下线，2026-04-26）
    if (e.key === '1' && !e.ctrlKey && !e.metaKey && !isInputFocused()) showView('landing');
    if (e.key === '2' && !e.ctrlKey && !e.metaKey && !isInputFocused()) showView('reader');
    if (e.key === '3' && !e.ctrlKey && !e.metaKey && !isInputFocused()) {
      showView('inspiration');
      if (window.InspirationLab) { InspirationLab.init().then(() => InspirationLab.render(document.getElementById('inspiration-container'))); }
    }
    // ? = shortcuts modal
    if (e.key === '?' && !isInputFocused() && shortcutsModal) {
      shortcutsModal.classList.toggle('hidden');
    }
    // Left/Right arrow for chapter navigation in reader view
    if (currentView === 'reader' && currentChapter && !isInputFocused()) {
      const idx = getChapterIndex(currentChapter);
      if (e.key === 'ArrowLeft' && idx > 0) loadChapter(allChapters[idx - 1]);
      if (e.key === 'ArrowRight' && idx < allChapters.length - 1) loadChapter(allChapters[idx + 1]);
    }
  });

  function isInputFocused() {
    const tag = document.activeElement?.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA';
  }

  // ===== LANDING → READER QUICK LINKS =====
  // Double-click a node to jump directly to its primary chapter
  document.querySelectorAll('.node').forEach(node => {
    node.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      const comp = COMPONENTS[node.dataset.component];
      if (comp && comp.chapters.length) {
        const primary = comp.chapters[0];
        const chId = findChapterId(primary.part, primary.num);
        if (chId) {
          showView('reader');
          loadChapterById(chId);
        }
      }
    });
  });

  // ===== SHORTCUTS MODAL =====
  const shortcutsBtn = document.getElementById('shortcuts-hint');
  const shortcutsModal = document.getElementById('shortcuts-modal');
  if (shortcutsBtn && shortcutsModal) {
    shortcutsBtn.addEventListener('click', () => shortcutsModal.classList.toggle('hidden'));
    shortcutsModal.addEventListener('click', (e) => {
      if (e.target === shortcutsModal || e.target.classList.contains('shortcuts-close')) {
        shortcutsModal.classList.add('hidden');
      }
    });
  }

  // ===== READING PROGRESS =====
  const chapterContent = document.getElementById('chapter-content');
  const progressBar = document.getElementById('reading-progress');
  if (chapterContent && progressBar) {
    chapterContent.addEventListener('scroll', () => {
      const { scrollTop, scrollHeight, clientHeight } = chapterContent;
      const pct = scrollHeight <= clientHeight ? 100 : (scrollTop / (scrollHeight - clientHeight)) * 100;
      progressBar.style.width = Math.min(100, pct) + '%';
    });
  }

  // ===== AGENT LOOP VISUALIZATION =====
  const loopSteps = document.querySelectorAll('.loop-step');
  const loopDetails = document.querySelectorAll('.loop-detail');
  const loopProgressFill = document.querySelector('.loop-progress-fill');
  const loopCurrentEl = document.getElementById('loop-current');
  let currentLoopStep = 1;
  let loopAutoInterval = null;
  let loopSpeed = 2500; // ms per step

  function setLoopStep(n) {
    currentLoopStep = n;
    loopSteps.forEach(s => {
      const sn = parseInt(s.dataset.step);
      s.classList.toggle('active', sn === n);
      s.classList.toggle('visited', sn < n);
    });
    loopDetails.forEach(d => {
      d.classList.toggle('hidden', parseInt(d.dataset.step) !== n);
    });
    if (loopProgressFill) {
      loopProgressFill.style.width = ((n - 1) / 10 * 100) + '%';
    }
    if (loopCurrentEl) loopCurrentEl.textContent = n;
    const prevBtn = document.getElementById('loop-prev');
    const nextBtn = document.getElementById('loop-next');
    if (prevBtn) prevBtn.disabled = n <= 1;
    if (nextBtn) nextBtn.disabled = n >= 11;

    // Re-trigger SSE animation on step 5
    if (n === 5) {
      const sseLines = document.querySelectorAll('.sse-line');
      sseLines.forEach(el => {
        el.style.animation = 'none';
        el.offsetHeight; // force reflow
        el.style.animation = '';
      });
    }
  }

  loopSteps.forEach(s => {
    s.addEventListener('click', () => {
      stopLoopAuto();
      setLoopStep(parseInt(s.dataset.step));
    });
  });

  const loopPrevBtn = document.getElementById('loop-prev');
  const loopNextBtn = document.getElementById('loop-next');
  const loopAutoBtn = document.getElementById('loop-auto');

  if (loopPrevBtn) loopPrevBtn.addEventListener('click', () => {
    stopLoopAuto();
    if (currentLoopStep > 1) setLoopStep(currentLoopStep - 1);
  });
  if (loopNextBtn) loopNextBtn.addEventListener('click', () => {
    stopLoopAuto();
    if (currentLoopStep < 11) setLoopStep(currentLoopStep + 1);
  });

  function stopLoopAuto() {
    if (loopAutoInterval) {
      clearInterval(loopAutoInterval);
      loopAutoInterval = null;
      if (loopAutoBtn) loopAutoBtn.textContent = '▶';
    }
  }

  function startLoopAuto() {
    if (loopAutoBtn) loopAutoBtn.textContent = '⏸';
    loopAutoInterval = setInterval(() => {
      if (currentLoopStep >= 11) {
        setLoopStep(1); // loop back to start
        return;
      }
      setLoopStep(currentLoopStep + 1);
    }, loopSpeed);
  }

  if (loopAutoBtn) loopAutoBtn.addEventListener('click', () => {
    if (loopAutoInterval) {
      stopLoopAuto();
    } else {
      startLoopAuto();
    }
  });

  // Speed controls
  document.querySelectorAll('.speed-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      loopSpeed = parseInt(btn.dataset.speed);
      // If auto-playing, restart with new speed
      if (loopAutoInterval) {
        clearInterval(loopAutoInterval);
        startLoopAuto();
      }
    });
  });

  // ===== ANIMATED STAT COUNTERS =====
  function animateCounters() {
    document.querySelectorAll('.counter').forEach(el => {
      const target = parseInt(el.dataset.target);
      if (!target || el.dataset.animated) return;
      el.dataset.animated = 'true';
      const duration = 1500;
      const start = performance.now();
      function tick(now) {
        const elapsed = now - start;
        const progress = Math.min(elapsed / duration, 1);
        // Ease out
        const eased = 1 - Math.pow(1 - progress, 3);
        const current = Math.round(target * eased);
        el.textContent = current.toLocaleString();
        if (progress < 1) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
  }

  // ===== SCROLL FADE-IN =====
  const fadeObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        // Trigger counter animation when stats strip becomes visible
        if (entry.target.closest('#landing')) animateCounters();
      }
    });
  }, { threshold: 0.15 });

  document.querySelectorAll('.fade-in-section').forEach(el => fadeObserver.observe(el));

  // Also observe stats strip for counter animation
  const statsStrip = document.querySelector('.stats-strip');
  if (statsStrip) {
    const statsObserver = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) animateCounters();
    }, { threshold: 0.5 });
    statsObserver.observe(statsStrip);
  }

  // ===== ARCHITECTURE EXPLORER =====
  function renderArchTreemap() {
    const container = document.getElementById('arch-treemap');
    const breadcrumb = document.getElementById('arch-breadcrumb');
    const infoPanel = document.getElementById('arch-info');
    const legend = document.getElementById('arch-legend');
    if (!container || typeof ARCHITECTURE === 'undefined') return;

    let navStack = [ARCHITECTURE]; // navigation history

    function currentNode() { return navStack[navStack.length - 1]; }

    function renderBlocks(node) {
      container.innerHTML = '';
      const items = (node.children || []).slice().sort((a, b) => b.lines - a.lines);
      const totalLines = items.reduce((s, c) => s + c.lines, 0);
      const parentColor = node.color || null;

      // Calculate block sizes as flex-basis percentages
      items.forEach((item, i) => {
        const pct = (item.lines / totalLines) * 100;
        const block = document.createElement('div');
        block.className = 'arch-block';
        const color = item.color || parentColor || '#48bb78';
        block.style.background = `linear-gradient(135deg, ${color}cc, ${color}88)`;
        // Size: use flex-grow proportional to lines
        block.style.flexGrow = Math.max(item.lines / 1000, 1);
        block.style.flexBasis = Math.max(pct * 2.5, 80) + 'px';
        block.style.minWidth = pct > 8 ? '120px' : '80px';

        block.innerHTML = `
          <div class="arch-block-name">${item.name}</div>
          <div class="arch-block-stats">${item.files} files · ${(item.lines/1000).toFixed(1)}K lines</div>
          <div class="arch-block-bar"></div>
        `;

        // Hover: show info
        block.addEventListener('mouseenter', () => {
          const nameEl = infoPanel.querySelector('.arch-info-name');
          const statsEl = infoPanel.querySelector('.arch-info-stats');
          const _isEnHover = (function(){ try { return (localStorage.getItem('cc-locale')||'zh')==='en'; } catch(e){ return false; } })();
          const descText = _isEnHover ? (item.descEn || item.desc) : item.desc;
          if (nameEl) nameEl.textContent = descText || item.name;
          if (statsEl) statsEl.textContent = `${item.files} files · ${item.lines.toLocaleString()} lines · ${pct.toFixed(1)}%`;
        });

        // Click: drill down if has children
        block.addEventListener('click', () => {
          if (item.children && item.children.length > 0) {
            navStack.push(item);
            renderBlocks(item);
            renderBreadcrumb();
            container.classList.add('zooming');
            setTimeout(() => container.classList.remove('zooming'), 350);
          }
        });

        // Visual indicator for drillable blocks
        if (item.children && item.children.length > 0) {
          block.style.cursor = 'pointer';
          const _isEnBlk = (function(){ try { return (localStorage.getItem('cc-locale')||'zh')==='en'; } catch(e){ return false; } })();
          block.title = _isEnBlk ? 'Click to drill into subdirectory' : '点击进入子目录';
        } else {
          block.style.cursor = 'default';
        }

        container.appendChild(block);
      });

      // Reset info panel
      const nameEl = infoPanel.querySelector('.arch-info-name');
      const statsEl = infoPanel.querySelector('.arch-info-stats');
      const _isEnReset = (function(){ try { return (localStorage.getItem('cc-locale')||'zh')==='en'; } catch(e){ return false; } })();
      const subLabel = _isEnReset ? `${items.length} submodules` : `${items.length} 个子模块`;
      if (nameEl) nameEl.textContent = `${node.name} — ${subLabel}`;
      if (statsEl) statsEl.textContent = `${node.files} files · ${node.lines.toLocaleString()} lines`;
    }

    function renderBreadcrumb() {
      breadcrumb.innerHTML = '';
      navStack.forEach((node, i) => {
        const crumb = document.createElement('span');
        crumb.className = 'arch-crumb';
        crumb.textContent = node.name;
        if (i < navStack.length - 1) {
          crumb.addEventListener('click', () => {
            navStack = navStack.slice(0, i + 1);
            renderBlocks(currentNode());
            renderBreadcrumb();
          });
        }
        breadcrumb.appendChild(crumb);
      });
    }

    function renderLegend() {
      legend.innerHTML = '';
      const topModules = (ARCHITECTURE.children || []).slice(0, 10);
      topModules.forEach(m => {
        const item = document.createElement('div');
        item.className = 'arch-legend-item';
        item.innerHTML = `<span class="arch-legend-dot" style="background:${m.color || '#48bb78'}"></span>${m.name}`;
        legend.appendChild(item);
      });
    }

    renderBlocks(ARCHITECTURE);
    renderBreadcrumb();
    renderLegend();
  }

  renderArchTreemap();

  // ===== DATA FLOW TABS =====
  document.querySelectorAll('.df-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.df-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.df-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      const panelId = 'df-' + tab.dataset.df;
      const panel = document.getElementById(panelId);
      if (panel) panel.classList.add('active');
    });
  });

  // ===== TOOL GRID RENDERING =====
  function renderToolGrid() {
    const grid = document.getElementById('tool-grid');
    if (!grid || typeof TOOL_CATALOG === 'undefined') return;
    grid.innerHTML = '';
    // i18n：根据 locale 选 category/categoryEn 和单位词
    const isEn = (function(){ try { return (localStorage.getItem('cc-locale')||'zh')==='en'; } catch(e){ return false; } })();
    const UNIT_TOOL = isEn ? 'tools' : '个';
    const UNIT_LINES = isEn ? 'lines' : '行';
    let totalTools = 0;
    TOOL_CATALOG.forEach(cat => {
      totalTools += cat.tools.length;
      const card = document.createElement('div');
      card.className = 'tool-category';
      const catLabel = isEn && cat.categoryEn ? cat.categoryEn : cat.category;
      const linesInfo = cat.tools.reduce((s, t) => s + (t.lines || 0), 0);
      card.innerHTML = `
        <div class="tool-category-header">
          <span class="tool-category-name" style="color:${cat.color}">${catLabel}</span>
          <span class="tool-category-count" style="color:${cat.color}">${cat.tools.length} ${UNIT_TOOL}${linesInfo ? ' · ' + linesInfo.toLocaleString() + ' ' + UNIT_LINES : ''}</span>
        </div>
        <div class="tool-items">
          ${cat.tools.map(t => {
            const desc = isEn && t.descEn ? t.descEn : t.desc;
            const linesLabel = t.lines ? ' (' + t.lines + ' ' + UNIT_LINES + ')' : '';
            const title = desc + linesLabel + (t.note ? ' — ' + t.note : '');
            return `<span class="tool-item${t.gated ? ' gated' : ''}" title="${title}">${t.name}</span>`;
          }).join('')}
        </div>
      `;
      grid.appendChild(card);
    });
    // Update the section title with accurate count
    const titleEl = document.querySelector('#tool-grid-section .section-title');
    if (titleEl) {
      titleEl.textContent = isEn
        ? `Tool System — ${totalTools} Built-in Tools`
        : `Tool System — ${totalTools} 个内置工具`;
    }
  }

  // ===== COMMAND CATALOG RENDERING =====
  function renderCommandCatalog() {
    const grid = document.getElementById('command-grid');
    if (!grid || typeof COMMAND_CATALOG === 'undefined') return;
    grid.innerHTML = '';

    // Separate public and internal/gated categories
    const publicCats = [];
    const internalCats = [];
    let totalPublic = 0;
    let totalInternal = 0;

    COMMAND_CATALOG.forEach(cat => {
      const publicCmds = cat.commands.filter(c => !c.gated);
      const gatedCmds = cat.commands.filter(c => c.gated);

      if (publicCmds.length > 0) {
        publicCats.push({ ...cat, commands: publicCmds });
        totalPublic += publicCmds.length;
      }
      if (gatedCmds.length > 0) {
        internalCats.push({ ...cat, commands: gatedCmds });
        totalInternal += gatedCmds.length;
      }
    });

    // Render public commands
    const isEn = (function(){ try { return (localStorage.getItem('cc-locale')||'zh')==='en'; } catch(e){ return false; } })();
    publicCats.forEach(cat => {
      const color = cat.color || '#a0aec0';
      const card = document.createElement('div');
      card.className = 'cmd-category';
      const catLabel = isEn && cat.categoryEn ? cat.categoryEn : cat.category;
      card.innerHTML = `
        <div class="cmd-category-header">
          <span class="cmd-category-name" style="color:${color}">${catLabel}</span>
          <span class="cmd-category-count" style="color:${color}">${cat.commands.length}</span>
        </div>
        <div class="cmd-items">
          ${cat.commands.map(c => {
            const desc = isEn && c.descEn ? c.descEn : c.desc;
            return `<div class="cmd-item" data-cmd="${c.name.toLowerCase()}">
              <span class="cmd-name">${c.name}</span>
              <span class="cmd-desc">${desc}</span>
            </div>`;
          }).join('')}
        </div>
      `;
      grid.appendChild(card);
    });

    // Update counts
    const pubCount = document.querySelector('.cmd-count-public');
    const intCount = document.querySelector('.cmd-count-internal');
    if (pubCount) pubCount.textContent = totalPublic;
    if (intCount) intCount.textContent = totalInternal;

    // Internal commands
    const intList = document.getElementById('internal-commands');
    if (intList && internalCats.length > 0) {
      intList.innerHTML = internalCats.map(cat =>
        cat.commands.map(c => {
          const _d = isEn && c.descEn ? c.descEn : c.desc;
          return `<span class="cmd-internal-item" title="${_d}${c.gate ? ' [' + c.gate + ']' : ''}">${c.name}</span>`;
        }).join('')
      ).join('');
    }

    // Toggle internal
    const toggleBtn = document.getElementById('show-internal');
    const intSection = document.getElementById('internal-command-list');
    if (toggleBtn && intSection) {
      toggleBtn.addEventListener('click', () => {
        intSection.classList.toggle('hidden');
        const _isEnTog = (function(){ try { return (localStorage.getItem('cc-locale')||'zh')==='en'; } catch(e){ return false; } })();
        const hidden = intSection.classList.contains('hidden');
        toggleBtn.textContent = _isEnTog
          ? (hidden ? 'Show Anthropic Internal Commands →' : '← Hide Anthropic Internal Commands')
          : (hidden ? '显示门控/内部命令 →' : '← 隐藏门控/内部命令');
      });
    }

    // Search
    const cmdSearch = document.getElementById('cmd-search');
    if (cmdSearch) {
      cmdSearch.addEventListener('input', () => {
        const q = cmdSearch.value.trim().toLowerCase();
        grid.querySelectorAll('.cmd-item').forEach(item => {
          const match = !q || item.dataset.cmd.includes(q) || item.textContent.toLowerCase().includes(q);
          item.style.display = match ? '' : 'none';
        });
        grid.querySelectorAll('.cmd-category').forEach(cat => {
          const anyVisible = Array.from(cat.querySelectorAll('.cmd-item')).some(i => i.style.display !== 'none');
          cat.style.display = anyVisible ? '' : 'none';
        });
      });
    }
  }

  // ===== HIDDEN FEATURES RENDERING =====
  function renderHiddenFeatures() {
    const grid = document.getElementById('hidden-features-grid');
    if (!grid || typeof HIDDEN_FEATURES === 'undefined') return;
    // 根据 localStorage['cc-locale'] 选择中英文字段（与语言切换器一致，切换时页面会 reload，所以这里读一次即可）
    let locale = 'zh';
    try { locale = localStorage.getItem('cc-locale') || 'zh'; } catch (e) {}
    const isEn = locale === 'en';
    const builtInLabel = isEn ? '✓ Built-in' : '✓ 内置';
    grid.innerHTML = '';
    HIDDEN_FEATURES.forEach(f => {
      const desc = isEn ? (f.descEn || f.desc) : f.desc;
      const detail = isEn ? (f.detailEn || f.detail) : f.detail;
      const flag = isEn ? (f.flagEn || f.flag) : f.flag;
      const card = document.createElement('div');
      card.className = 'hidden-feature-card';
      card.innerHTML = `
        <div class="hf-header">
          <span class="hf-icon">${f.icon}</span>
          <div class="hf-title-block">
            <span class="hf-name" style="color:${f.color}">${f.name}</span>
            <span class="hf-flag">${f.status === 'gated' ? '🔒 ' + flag : builtInLabel}</span>
          </div>
        </div>
        <p class="hf-desc">${desc}</p>
        <div class="hf-meta">
          <span class="hf-source" title="${f.source}">📂 ${f.source.split('/').slice(-1)[0] || f.source}</span>
        </div>
        <div class="hf-detail">${detail}</div>
      `;
      // Click to expand detail
      card.addEventListener('click', () => card.classList.toggle('expanded'));
      grid.appendChild(card);
    });
  }

  // ===== CTA BUTTONS =====
  const ctaRead = document.getElementById('cta-read');
  const ctaMap = document.getElementById('cta-map');
  if (ctaRead) ctaRead.addEventListener('click', () => showView('reader'));
  if (ctaMap) {
    ctaMap.addEventListener('click', () => {
      const landing = document.getElementById('landing');
      if (landing) landing.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  // ===== SECTION NAV TRACKING =====
  const sectionNav = document.getElementById('section-nav');
  if (sectionNav) {
    const navDots = sectionNav.querySelectorAll('.section-nav-dot');
    const sectionIds = ['engine-container', 'agent-loop-section', 'tool-grid-section', 'command-catalog-section', 'hidden-features-section'];

    // Update active dot on scroll
    const landing = document.getElementById('landing');
    if (landing) {
      landing.addEventListener('scroll', () => {
        let activeIdx = 0;
        sectionIds.forEach((id, i) => {
          const el = document.getElementById(id);
          if (el) {
            const rect = el.getBoundingClientRect();
            if (rect.top < window.innerHeight / 2) activeIdx = i;
          }
        });
        navDots.forEach((dot, i) => dot.classList.toggle('active', i === activeIdx));
      });
    }

    // Show section nav only on landing view — use MutationObserver on view active class
    const landingView = document.getElementById('landing');
    function updateSectionNavVisibility() {
      if (sectionNav) sectionNav.style.display = (landingView && landingView.classList.contains('active')) ? '' : 'none';
    }
    updateSectionNavVisibility();
    if (landingView) {
      new MutationObserver(updateSectionNavVisibility).observe(landingView, { attributes: true, attributeFilter: ['class'] });
    }
    // Smooth scroll on dot click
    navDots.forEach(dot => {
      dot.addEventListener('click', (e) => {
        e.preventDefault();
        const target = document.querySelector(dot.getAttribute('href'));
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  // ===== INIT =====
  buildTOC();
  renderToolGrid();
  renderCommandCatalog();
  renderHiddenFeatures();

  // Expose navigation API for external modules (difficulty-map, etc.)
  window.__appShowView = showView;
  window.__appLoadChapterById = loadChapterById;

  // 切语言时 index.html 的 setLocale 会调这个 —— 原地重建 TOC + 重新渲染动态内容
  // + 如果当前在 reader 里就 reload 当前章节（换语言版本）
  // 避免整页 window.location.reload 造成的 1-3s 白屏感
  window.__appOnLocaleChange = function () {
    try {
      buildTOC();
      // 其他依赖 locale 的 DOM 子树也重新渲染（tool grid / command catalog / hidden features）
      renderToolGrid();
      renderCommandCatalog();
      renderHiddenFeatures();
      // 难度筛选器：buildTOC 重建了 TOC 节点，需要重新打 diff-level + 重渲 bar
      if (typeof window.__appRefreshDifficultyFilter === 'function') {
        window.__appRefreshDifficultyFilter();
      }
      // 灵感板块：切语言时重渲染当前活动 tab（火花/蓝图）
      // Bug 1 修复（2026-04-26）：原先只在 onLocaleChange 里没调到 inspiration，
      // 导致 sparks tab 不刷新，只有切到 blueprints 再回来才更新。
      var inspContainer = document.getElementById('inspiration-container');
      if (window.InspirationLab && inspContainer && inspContainer.children.length > 0) {
        InspirationLab.render(inspContainer);
      }
    } catch (e) { console.warn('[app] onLocaleChange partial fail', e); }
    // 通知图表 iframe 切换语言（Bug 3 修复链路侧）
    try {
      if (typeof window.dispatchEvent === 'function') {
        window.dispatchEvent(new CustomEvent('cc-locale-change'));
      }
    } catch(e) {}
    // 如果正在阅读某章节，重新加载新语言版
    if (currentView === 'reader' && currentChapter) {
      loadChapter(currentChapter);
    }
  };

  // Check URL hash for direct chapter link
  if (window.location.hash) {
    const hash = window.location.hash.slice(1);
    const match = hash.match(/^chapter-(.+)$/);
    if (match) {
      showView('reader');
      loadChapterById(match[1]);
    }
  }
})();
