/**
 * Review Mode (修订模式)
 *
 * Adds an interactive review overlay to chart embeds:
 * - Toggle review mode via button in nav
 * - Each chart shows: ID, version history, comment box
 * - Comments saved to localStorage (user copies to files)
 * - Changelog tracks all revisions per chart
 * - Gallery view shows ALL 114 charts for batch review
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'cc-review-comments';
  const CHANGELOG_KEY = 'cc-review-changelog';
  let reviewMode = false;
  let allCharts = []; // loaded from chart-embedding-map.json + production listing
  let changelog = {};
  let comments = {};

  // ===== INIT =====
  function init() {
    loadFromStorage();
    addToggleButton();
    buildGalleryView();
    // Listen for chart embeds being created
    document.addEventListener('chart-embedded', onChartEmbedded);
  }

  function loadFromStorage() {
    try {
      comments = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      changelog = JSON.parse(localStorage.getItem(CHANGELOG_KEY) || '{}');
    } catch (e) {
      comments = {};
      changelog = {};
    }
  }

  function saveToStorage() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(comments));
    localStorage.setItem(CHANGELOG_KEY, JSON.stringify(changelog));
  }

  // ===== TOGGLE BUTTON =====
  function addToggleButton() {
    const navRight = document.querySelector('.nav-right');
    if (!navRight) return;
    const btn = document.createElement('button');
    btn.id = 'review-mode-toggle';
    btn.className = 'review-mode-btn';
    btn.title = '修订模式';
    btn.innerHTML = '<span class="review-icon">✏️</span><span class="review-label">修订</span>';
    btn.addEventListener('click', toggleReviewMode);
    navRight.insertBefore(btn, navRight.firstChild);
  }

  function toggleReviewMode() {
    reviewMode = !reviewMode;
    document.body.classList.toggle('review-mode-active', reviewMode);
    const btn = document.getElementById('review-mode-toggle');
    if (btn) {
      btn.classList.toggle('active', reviewMode);
      btn.querySelector('.review-label').textContent = reviewMode ? '退出修订' : '修订';
    }
    // Add review panels to existing chart containers
    if (reviewMode) {
      document.querySelectorAll('.chart-embed-container').forEach(addReviewPanel);
    }
  }

  // ===== REVIEW PANEL for inline charts =====
  function addReviewPanel(container) {
    if (container.querySelector('.review-panel')) return;
    const chartId = container.dataset.chartId;
    if (!chartId) return;

    const panel = document.createElement('div');
    panel.className = 'review-panel';
    panel.innerHTML = buildReviewPanelHTML(chartId);
    container.appendChild(panel);

    // Bind submit
    const form = panel.querySelector('.review-comment-form');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const textarea = form.querySelector('textarea');
      const text = textarea.value.trim();
      if (!text) return;
      addComment(chartId, text);
      textarea.value = '';
      updateReviewPanel(panel, chartId);
    });
  }

  function buildReviewPanelHTML(chartId) {
    const info = getChartInfo(chartId);
    const commentList = (comments[chartId] || [])
      .map(c => `<div class="review-comment-item">
        <span class="comment-time">${c.time}</span>
        <span class="comment-text">${escapeHtml(c.text)}</span>
        <button class="comment-delete" data-id="${chartId}" data-idx="${c.idx}">&times;</button>
      </div>`).join('');

    const versions = (changelog[chartId]?.versions || [])
      .map(v => `<span class="version-tag">v${v.v}${v.score ? ' (' + v.score + ')' : ''}</span>`)
      .join(' ');

    return `
      <div class="review-header">
        <span class="review-chart-id">${chartId}</span>
        <span class="review-chart-name">${info.name || ''}</span>
        ${versions ? '<div class="review-versions">版本: ' + versions + '</div>' : '<div class="review-versions">版本: v1 (原始)</div>'}
      </div>
      <div class="review-comments-list">${commentList || '<span class="no-comments">暂无评论</span>'}</div>
      <form class="review-comment-form">
        <textarea placeholder="输入修改意见..." rows="2"></textarea>
        <button type="submit" class="review-submit-btn">提交评论</button>
      </form>
      <div class="review-export">
        <button class="review-export-btn" data-id="${chartId}">导出为文本</button>
      </div>
    `;
  }

  function updateReviewPanel(panel, chartId) {
    panel.innerHTML = buildReviewPanelHTML(chartId);
    // Rebind
    const form = panel.querySelector('.review-comment-form');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const textarea = form.querySelector('textarea');
      const text = textarea.value.trim();
      if (!text) return;
      addComment(chartId, text);
      textarea.value = '';
      updateReviewPanel(panel, chartId);
    });
    // Export button
    panel.querySelector('.review-export-btn')?.addEventListener('click', () => exportComments(chartId));
    // Delete buttons
    panel.querySelectorAll('.comment-delete').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const idx = parseInt(btn.dataset.idx);
        if (comments[id]) {
          comments[id] = comments[id].filter(c => c.idx !== idx);
          saveToStorage();
          updateReviewPanel(panel, id);
        }
      });
    });
  }

  // ===== COMMENTS =====
  function addComment(chartId, text) {
    if (!comments[chartId]) comments[chartId] = [];
    const idx = Date.now();
    comments[chartId].push({
      text,
      time: new Date().toLocaleString('zh-CN'),
      idx
    });
    saveToStorage();
  }

  function exportComments(chartId) {
    const items = comments[chartId] || [];
    if (!items.length) { alert('该图表暂无评论'); return; }
    const text = `# ${chartId} 修改意见\n\n` +
      items.map(c => `[${c.time}] ${c.text}`).join('\n\n') +
      `\n\n---\n导出时间: ${new Date().toLocaleString('zh-CN')}`;
    // Copy to clipboard
    navigator.clipboard.writeText(text).then(() => {
      alert('已复制到剪贴板！可粘贴到 test-viz/revisions/feedback/' + chartId + '.txt');
    }).catch(() => {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      alert('已复制到剪贴板');
    });
  }

  function exportAllComments() {
    const allKeys = Object.keys(comments).filter(k => comments[k]?.length > 0).sort();
    if (!allKeys.length) { alert('暂无任何评论'); return; }
    let text = `# 全部图表修改意见\n\n导出时间: ${new Date().toLocaleString('zh-CN')}\n图表数: ${allKeys.length}\n\n---\n\n`;
    for (const chartId of allKeys) {
      text += `## ${chartId}\n\n`;
      text += comments[chartId].map(c => `[${c.time}] ${c.text}`).join('\n\n');
      text += '\n\n---\n\n';
    }
    navigator.clipboard.writeText(text).then(() => {
      alert(`已复制 ${allKeys.length} 个图表的评论到剪贴板`);
    });
  }

  // ===== GALLERY VIEW =====
  function buildGalleryView() {
    const gallery = document.createElement('div');
    gallery.id = 'review-gallery';
    gallery.className = 'view';
    gallery.innerHTML = `
      <div class="gallery-header">
        <h2>图表修订总览</h2>
        <div class="gallery-controls">
          <select id="gallery-filter">
            <option value="all">全部 (114)</option>
            <option value="has-comments">有评论</option>
            <option value="no-comments">无评论</option>
            <option value="overview">概览 (VIS-0-*)</option>
            <option value="part1">Part 1 (VIS-1-*)</option>
            <option value="part2a">Part 2A (VIS-2A-*)</option>
            <option value="part2q">Part 2Q (VIS-2Q-*)</option>
            <option value="part3">Part 3 (VIS-3-*)</option>
            <option value="part4">Part 4 (VIS-4-*)</option>
            <option value="part5">Part 5 (VIS-5-*)</option>
          </select>
          <button id="gallery-export-all" class="review-submit-btn">导出全部评论</button>
          <span id="gallery-stats"></span>
        </div>
      </div>
      <div id="gallery-grid" class="gallery-grid"></div>
    `;
    // 修复：原代码 insertBefore(gallery, querySelector('nav')) 会抛错，
    // 因为 <nav> 元素不是 <body> 的直接子节点（嵌套在 #viewer / #reader 内）。
    // 改为直接 appendChild，gallery 由 CSS 控制可见性（默认 hidden，激活时全屏覆盖）。
    document.body.appendChild(gallery);

    // Load chart listing
    loadAllCharts().then(() => {
      renderGallery();
      document.getElementById('gallery-filter')?.addEventListener('change', renderGallery);
      document.getElementById('gallery-export-all')?.addEventListener('click', exportAllComments);
    });
  }

  async function loadAllCharts() {
    try {
      // Get the chart list from production directory listing or mapping
      const resp = await fetch('test-viz/chart-embedding-map.json');
      const data = await resp.json();
      const mapped = new Set();

      // Add mapped charts
      if (data.mappings) {
        data.mappings.forEach(m => {
          mapped.add(m.chart_id);
          allCharts.push({
            chartId: m.chart_id,
            name: m.chart_file.split('/').pop().replace('.html', '').replace(/^VIS-[^_]+_/, ''),
            file: m.chart_file,
            placeholderId: m.placeholder_id,
            bookFile: m.book_file
          });
        });
      }

      // Add unmapped charts from the unmatched list
      if (data.unmatched_charts) {
        data.unmatched_charts.forEach(u => {
          if (!mapped.has(u.chart_id)) {
            mapped.add(u.chart_id);
            allCharts.push({
              chartId: u.chart_id,
              name: u.chart_file.split('/').pop().replace('.html', '').replace(/^VIS-[^_]+_/, ''),
              file: u.chart_file,
              placeholderId: null,
              bookFile: null
            });
          }
        });
      }

      // Sort by chart_id
      allCharts.sort((a, b) => a.chartId.localeCompare(b.chartId));
    } catch (e) {
      console.warn('Failed to load chart list:', e);
    }
  }

  function renderGallery() {
    const grid = document.getElementById('gallery-grid');
    const filter = document.getElementById('gallery-filter')?.value || 'all';
    const stats = document.getElementById('gallery-stats');
    if (!grid) return;

    let filtered = allCharts;
    if (filter === 'has-comments') filtered = allCharts.filter(c => comments[c.chartId]?.length > 0);
    else if (filter === 'no-comments') filtered = allCharts.filter(c => !comments[c.chartId]?.length);
    else if (filter === 'overview') filtered = allCharts.filter(c => c.chartId.startsWith('VIS-0'));
    else if (filter === 'part1') filtered = allCharts.filter(c => c.chartId.startsWith('VIS-1'));
    else if (filter === 'part2a') filtered = allCharts.filter(c => c.chartId.startsWith('VIS-2A'));
    else if (filter === 'part2q') filtered = allCharts.filter(c => c.chartId.startsWith('VIS-2Q'));
    else if (filter === 'part3') filtered = allCharts.filter(c => c.chartId.startsWith('VIS-3'));
    else if (filter === 'part4') filtered = allCharts.filter(c => c.chartId.startsWith('VIS-4'));
    else if (filter === 'part5') filtered = allCharts.filter(c => c.chartId.startsWith('VIS-5'));

    const commented = filtered.filter(c => comments[c.chartId]?.length > 0).length;
    if (stats) stats.textContent = `显示 ${filtered.length} / ${allCharts.length} | 已评论 ${commented}`;

    grid.innerHTML = filtered.map(c => {
      const hasComment = comments[c.chartId]?.length > 0;
      const commentCount = comments[c.chartId]?.length || 0;
      const versions = changelog[c.chartId]?.versions || [];
      const latestScore = versions.length ? versions[versions.length - 1].score : null;

      // Check for v2 revision
      const hasV2 = false; // Will be detected by file existence

      return `
        <div class="gallery-card ${hasComment ? 'has-comment' : ''}" data-chart-id="${c.chartId}">
          <div class="gallery-card-header">
            <span class="gallery-chart-id">${c.chartId}</span>
            ${latestScore ? `<span class="gallery-score">${latestScore}</span>` : ''}
            ${commentCount > 0 ? `<span class="gallery-comment-badge">${commentCount}</span>` : ''}
          </div>
          <div class="gallery-chart-name">${c.name}</div>
          <div class="gallery-chart-preview" data-file="${c.file}">
            <button class="gallery-load-btn" data-file="${c.file}" data-id="${c.chartId}">加载预览</button>
          </div>
          <div class="gallery-review-area">
            <textarea class="gallery-comment-input" placeholder="输入修改意见..." data-id="${c.chartId}" rows="2"></textarea>
            <div class="gallery-actions">
              <button class="gallery-submit" data-id="${c.chartId}">提交</button>
              ${commentCount > 0 ? `<button class="gallery-view-comments" data-id="${c.chartId}">查看(${commentCount})</button>` : ''}
            </div>
            <div class="gallery-comments-display" id="gc-${c.chartId}" style="display:none"></div>
          </div>
        </div>
      `;
    }).join('');

    // Bind events
    grid.querySelectorAll('.gallery-load-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const file = btn.dataset.file;
        const id = btn.dataset.id;
        const preview = btn.parentElement;
        preview.innerHTML = `<iframe src="${file}" class="gallery-iframe" loading="lazy"></iframe>`;
      });
    });

    grid.querySelectorAll('.gallery-submit').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const textarea = grid.querySelector(`.gallery-comment-input[data-id="${id}"]`);
        if (textarea && textarea.value.trim()) {
          addComment(id, textarea.value.trim());
          textarea.value = '';
          renderGallery(); // Refresh
        }
      });
    });

    grid.querySelectorAll('.gallery-view-comments').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const display = document.getElementById('gc-' + id);
        if (display) {
          const visible = display.style.display !== 'none';
          display.style.display = visible ? 'none' : 'block';
          if (!visible) {
            display.innerHTML = (comments[id] || []).map(c =>
              `<div class="gallery-comment-entry"><span class="gc-time">${c.time}</span> ${escapeHtml(c.text)}</div>`
            ).join('');
          }
        }
      });
    });
  }

  // ===== CHART INFO HELPERS =====
  function getChartInfo(chartId) {
    return allCharts.find(c => c.chartId === chartId) || { chartId, name: '' };
  }

  function onChartEmbedded(e) {
    if (reviewMode && e.detail?.container) {
      addReviewPanel(e.detail.container);
    }
  }

  // ===== NAV INTEGRATION =====
  function addGalleryNavButton() {
    const navLeft = document.querySelector('.nav-left');
    if (!navLeft) return;
    const btn = document.createElement('button');
    btn.id = 'nav-gallery';
    btn.className = 'nav-btn';
    btn.title = '图表总览';
    btn.textContent = '📊';
    btn.addEventListener('click', () => {
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      document.getElementById('review-gallery')?.classList.add('active');
    });
    navLeft.appendChild(btn);
  }

  // ===== UTILITIES =====
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ===== BOOT =====
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { init(); addGalleryNavButton(); });
  } else {
    init();
    addGalleryNavButton();
  }

  // Expose for external use
  window.ReviewMode = {
    toggle: toggleReviewMode,
    exportAll: exportAllComments,
    getComments: () => comments,
    getChangelog: () => changelog,
    isActive: () => reviewMode
  };
})();
