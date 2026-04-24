/**
 * Chart Gallery & Review System
 *
 * A closed-loop human-AI collaboration system for chart quality improvement.
 * - Displays all 114 charts in a filterable grid
 * - Per-chart rating (1-5 stars), commenting, and issue flagging
 * - Batch feedback submission → generates structured JSON for revision pipeline
 * - Before/After comparison view for revised charts
 * - Version history tracking
 *
 * Exposes: window.Gallery
 */
(function () {
  'use strict';

  // ── State ──
  let catalog = null;
  let feedback = {};       // vid → { rating, comment, flagged, timestamp }
  let filterMode = 'all';  // all | needs-review | flagged | revised
  let sortMode = 'id';     // id | rating | size
  let expandedChart = null;

  const STORAGE_KEY = 'cc-chart-feedback';
  const CATALOG_URL = 'test-viz/chart-catalog.json';

  // ── Init ──
  async function init() {
    loadFeedbackFromStorage();
    try {
      const resp = await fetch(CATALOG_URL);
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const data = await resp.json();
      catalog = data.charts || [];
      console.log(`[Gallery] Loaded ${catalog.length} charts`);
    } catch (e) {
      console.warn('[Gallery] Failed to load catalog:', e);
      catalog = [];
    }
  }

  // ── Storage ──
  function loadFeedbackFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) feedback = JSON.parse(raw);
    } catch (e) { feedback = {}; }
  }

  function saveFeedbackToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(feedback));
    } catch (e) { console.warn('[Gallery] localStorage write failed'); }
  }

  function getFeedback(vid) {
    return feedback[vid] || { rating: 0, comment: '', flagged: false, timestamp: null };
  }

  function setFeedback(vid, data) {
    feedback[vid] = { ...getFeedback(vid), ...data, timestamp: new Date().toISOString() };
    saveFeedbackToStorage();
  }

  // ── Render Gallery View ──
  function render(container) {
    if (!catalog) { container.innerHTML = '<p style="padding:40px;text-align:center;color:var(--text-muted)">加载图表目录中...</p>'; return; }

    const stats = getStats();
    const filtered = getFilteredCharts();

    container.innerHTML = `
      <div class="gallery-wrapper">
        <div class="gallery-top-bar">
          <div class="gallery-stats">
            <span class="gallery-stat">${catalog.length} 张图表</span>
            <span class="gallery-stat">${stats.reviewed} 已审阅</span>
            <span class="gallery-stat gallery-stat-flag">${stats.flagged} 待修复</span>
            <span class="gallery-stat">${stats.thisSession} 本轮反馈</span>
          </div>
          <div class="gallery-actions">
            <select class="gallery-filter" title="筛选">
              <option value="all"${filterMode === 'all' ? ' selected' : ''}>全部 (${catalog.length})</option>
              <option value="needs-review"${filterMode === 'needs-review' ? ' selected' : ''}>待审阅 (${stats.needsReview})</option>
              <option value="flagged"${filterMode === 'flagged' ? ' selected' : ''}>已标记待修 (${stats.flagged})</option>
              <option value="revised"${filterMode === 'revised' ? ' selected' : ''}>有修订版 (${stats.revised})</option>
            </select>
            <button class="gallery-btn gallery-btn-submit" title="提交本轮全部反馈">
              <span>提交反馈</span> <span class="gallery-btn-count">${stats.thisSession}</span>
            </button>
          </div>
        </div>

        <div class="gallery-grid" id="gallery-grid">
          ${filtered.map(c => renderCard(c)).join('')}
        </div>

        ${filtered.length === 0 ? '<p style="padding:60px;text-align:center;color:var(--text-muted)">没有匹配的图表</p>' : ''}
      </div>
    `;

    // Wire events
    container.querySelector('.gallery-filter').addEventListener('change', e => {
      filterMode = e.target.value;
      render(container);
    });

    container.querySelector('.gallery-btn-submit').addEventListener('click', () => {
      showSubmitModal(container);
    });

    // Card events
    container.querySelectorAll('.gallery-card').forEach(card => {
      const vid = card.dataset.vid;

      // Expand/collapse
      card.querySelector('.gallery-card-preview').addEventListener('click', () => {
        if (expandedChart === vid) {
          expandedChart = null;
          render(container);
        } else {
          expandedChart = vid;
          render(container);
          // Scroll expanded card into view
          setTimeout(() => {
            const expanded = container.querySelector('.gallery-card-expanded');
            if (expanded) expanded.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }, 100);
        }
      });

      // Star rating
      card.querySelectorAll('.gallery-star').forEach(star => {
        star.addEventListener('click', (e) => {
          e.stopPropagation();
          const rating = parseInt(star.dataset.rating);
          const fb = getFeedback(vid);
          setFeedback(vid, { rating: fb.rating === rating ? 0 : rating });
          render(container);
        });
      });

      // Flag toggle
      const flagBtn = card.querySelector('.gallery-flag-btn');
      if (flagBtn) {
        flagBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const fb = getFeedback(vid);
          setFeedback(vid, { flagged: !fb.flagged });
          render(container);
        });
      }

      // Comment save
      const commentArea = card.querySelector('.gallery-comment-input');
      const saveBtn = card.querySelector('.gallery-comment-save');
      if (commentArea && saveBtn) {
        saveBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          setFeedback(vid, { comment: commentArea.value });
          render(container);
        });
      }
    });
  }

  function renderCard(chart) {
    const vid = chart.id;
    const fb = getFeedback(vid);
    const isExpanded = expandedChart === vid;
    const hasRevisions = chart.revisions && chart.revisions.length > 0;
    const latestScore = hasRevisions
      ? chart.revisions.reduce((best, r) => r.score > best ? r.score : best, 0)
      : null;

    const starsHtml = [1, 2, 3, 4, 5].map(i =>
      `<span class="gallery-star ${i <= fb.rating ? 'gallery-star-active' : ''}" data-rating="${i}">★</span>`
    ).join('');

    const statusBadge = fb.flagged
      ? '<span class="gallery-badge gallery-badge-flag">待修复</span>'
      : fb.rating > 0
        ? '<span class="gallery-badge gallery-badge-rated">已评</span>'
        : hasRevisions
          ? '<span class="gallery-badge gallery-badge-revised">有修订</span>'
          : '';

    let expandedHtml = '';
    if (isExpanded) {
      expandedHtml = `
        <div class="gallery-expanded-content">
          <div class="gallery-iframe-wrap">
            <iframe src="${chart.file}" class="gallery-iframe" loading="lazy"></iframe>
            <a href="${chart.file}" target="_blank" class="gallery-fullscreen-link">⛶ 新窗口打开</a>
          </div>
          <div class="gallery-review-panel">
            <div class="gallery-review-section">
              <label>评分</label>
              <div class="gallery-stars-large">${starsHtml}</div>
            </div>
            <div class="gallery-review-section">
              <label>标记需修复</label>
              <button class="gallery-flag-btn ${fb.flagged ? 'gallery-flag-active' : ''}">
                ${fb.flagged ? '🚩 已标记' : '⚐ 标记待修'}
              </button>
            </div>
            <div class="gallery-review-section">
              <label>反馈意见</label>
              <textarea class="gallery-comment-input" placeholder="描述需要修改的内容...">${escapeHTML(fb.comment)}</textarea>
              <button class="gallery-comment-save">保存评论</button>
            </div>
            ${hasRevisions ? `
              <div class="gallery-review-section">
                <label>修订历史 (${chart.revisions.length} 版)</label>
                <div class="gallery-version-list">
                  ${chart.revisions.map((r, i) => `
                    <div class="gallery-version-item">
                      v${i + 2} · ${r.timestamp || '?'} ${r.score ? `· ${r.score}分` : ''}
                    </div>
                  `).join('')}
                </div>
              </div>
            ` : ''}
            ${chart.has_feedback ? `
              <div class="gallery-review-section">
                <label>历史反馈</label>
                <div class="gallery-old-feedback">${escapeHTML(chart.feedback_text).substring(0, 300)}${chart.feedback_text.length > 300 ? '...' : ''}</div>
              </div>
            ` : ''}
          </div>
        </div>
      `;
    }

    return `
      <div class="gallery-card ${isExpanded ? 'gallery-card-expanded' : ''} ${fb.flagged ? 'gallery-card-flagged' : ''}" data-vid="${vid}">
        <div class="gallery-card-preview">
          <div class="gallery-card-header">
            <span class="gallery-card-id">${vid}</span>
            ${statusBadge}
            ${latestScore ? `<span class="gallery-card-score">${latestScore}分</span>` : ''}
          </div>
          <div class="gallery-card-name">${escapeHTML(chart.name)}</div>
          ${!isExpanded ? `<div class="gallery-card-mini-stars">${starsHtml}</div>` : ''}
        </div>
        ${expandedHtml}
      </div>
    `;
  }

  // ── Submit Modal ──
  function showSubmitModal(container) {
    const batch = generateBatch();
    if (batch.items.length === 0) {
      alert('本轮没有新的反馈可提交。请先对图表评分或评论。');
      return;
    }

    const jsonStr = JSON.stringify(batch, null, 2);

    const modal = document.createElement('div');
    modal.className = 'gallery-modal-overlay';
    modal.innerHTML = `
      <div class="gallery-modal">
        <div class="gallery-modal-header">
          <h3>提交反馈批次</h3>
          <button class="gallery-modal-close">&times;</button>
        </div>
        <div class="gallery-modal-body">
          <div class="gallery-modal-summary">
            <p>本轮审阅了 <strong>${batch.items.length}</strong> 张图表</p>
            <p>其中 <strong>${batch.items.filter(i => i.flagged).length}</strong> 张标记为待修复</p>
            <p>平均评分 <strong>${(batch.items.reduce((s, i) => s + i.rating, 0) / batch.items.length).toFixed(1)}</strong>/5</p>
          </div>
          <textarea class="gallery-modal-json" readonly>${jsonStr}</textarea>
          <div class="gallery-modal-actions">
            <button class="gallery-btn gallery-btn-copy">复制 JSON 到剪贴板</button>
            <button class="gallery-btn gallery-btn-download">下载 feedback.json</button>
            <button class="gallery-btn gallery-btn-confirm">确认提交 → 启动修订管线</button>
          </div>
          <p class="gallery-modal-hint">提交后，将反馈 JSON 粘贴给 Claude，或等待自动修订管线处理。</p>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector('.gallery-modal-close').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

    modal.querySelector('.gallery-btn-copy').addEventListener('click', () => {
      navigator.clipboard.writeText(jsonStr).then(() => {
        modal.querySelector('.gallery-btn-copy').textContent = '已复制 ✓';
      });
    });

    modal.querySelector('.gallery-btn-download').addEventListener('click', () => {
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `feedback-batch-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });

    modal.querySelector('.gallery-btn-confirm').addEventListener('click', () => {
      // Save the batch to a well-known location via localStorage
      localStorage.setItem('cc-feedback-batch-latest', jsonStr);
      // Mark all submitted items
      batch.items.forEach(item => {
        const fb = getFeedback(item.chart_id);
        feedback[item.chart_id] = { ...fb, submitted: true, batch_id: batch.batch_id };
      });
      saveFeedbackToStorage();
      modal.querySelector('.gallery-btn-confirm').textContent = '已确认提交 ✓';
      modal.querySelector('.gallery-btn-confirm').disabled = true;
      // Re-render
      setTimeout(() => { modal.remove(); render(container); }, 1000);
    });
  }

  // ── Batch Generation ──
  function generateBatch() {
    const items = [];
    for (const [vid, fb] of Object.entries(feedback)) {
      if ((fb.rating > 0 || fb.comment || fb.flagged) && !fb.submitted) {
        items.push({
          chart_id: vid,
          rating: fb.rating || 0,
          comment: fb.comment || '',
          flagged: fb.flagged || false,
          timestamp: fb.timestamp
        });
      }
    }

    return {
      batch_id: `batch-${Date.now()}`,
      generated: new Date().toISOString(),
      total_reviewed: items.length,
      flagged_for_revision: items.filter(i => i.flagged).length,
      items: items.sort((a, b) => a.chart_id.localeCompare(b.chart_id))
    };
  }

  // ── Stats ──
  function getStats() {
    const reviewed = Object.values(feedback).filter(f => f.rating > 0 || f.comment).length;
    const flagged = Object.values(feedback).filter(f => f.flagged).length;
    const thisSession = Object.values(feedback).filter(f => (f.rating > 0 || f.comment || f.flagged) && !f.submitted).length;
    const revised = catalog ? catalog.filter(c => c.revisions && c.revisions.length > 0).length : 0;
    const needsReview = catalog ? catalog.length - reviewed : 0;
    return { reviewed, flagged, thisSession, revised, needsReview };
  }

  // ── Filtering ──
  function getFilteredCharts() {
    if (!catalog) return [];
    let list = [...catalog];

    switch (filterMode) {
      case 'needs-review':
        list = list.filter(c => { const fb = getFeedback(c.id); return !fb.rating && !fb.comment; });
        break;
      case 'flagged':
        list = list.filter(c => getFeedback(c.id).flagged);
        break;
      case 'revised':
        list = list.filter(c => c.revisions && c.revisions.length > 0);
        break;
    }

    return list;
  }

  // ── Utility ──
  function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Public API ──
  window.Gallery = {
    init,
    render,
    generateBatch,
    getStats
  };
})();
