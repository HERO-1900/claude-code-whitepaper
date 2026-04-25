/**
 * difficulty-map.js — 难度地图组件
 * 按难度等级分组展示章节，点击跳转阅读器。
 * 依赖：BOOK_STRUCTURE（data.js）、window.__appShowView / __appLoadChapterById（app.js）
 */
(function () {
  'use strict';

  var GRID_EL = document.getElementById('difficulty-map-grid');
  if (!GRID_EL) return;

  // 难度分组配置（label/labelEn 双语 + range 单位段）
  var GROUPS = [
    { label: '入门', labelEn: 'Beginner',     range: [1, 2], color: '#4a7c50', emoji: '🌱' },
    { label: '进阶', labelEn: 'Intermediate', range: [2, 3], color: '#4a6b8a', emoji: '📘' },
    { label: '深入', labelEn: 'Advanced',     range: [3, 4], color: '#c77d2e', emoji: '🔍' },
    { label: '专家', labelEn: 'Expert',       range: [4, 5], color: '#b84a3a', emoji: '🧠' },
  ];

  function isEn() {
    try { return (localStorage.getItem('cc-locale') || 'zh') === 'en'; }
    catch (e) { return false; }
  }

  /**
   * 从 BOOK_STRUCTURE 里找到与 difficulty-ratings.json 的 chapter 路径匹配的章节对象。
   * JSON 路径格式如 "part2/01_代码地图"，BOOK_STRUCTURE file 如 "part2_代码架构完全解构/01_代码地图.md"。
   * 匹配策略：取 JSON 路径中 "/" 后的部分，在 BOOK_STRUCTURE 的 file 字段中查找包含该子串的条目。
   */
  function findBookChapter(jsonChapterPath) {
    if (typeof BOOK_STRUCTURE === 'undefined') return null;
    var parts = jsonChapterPath.split('/');
    var slug = parts[parts.length - 1]; // 如 "01_代码地图"

    // 策略 1：完整 slug 子串匹配（覆盖 90%+ 的情况）
    for (var p = 0; p < BOOK_STRUCTURE.length; p++) {
      var chapters = BOOK_STRUCTURE[p].chapters;
      for (var c = 0; c < chapters.length; c++) {
        if (chapters[c].file.indexOf(slug) !== -1) {
          return chapters[c];
        }
      }
    }

    // 策略 2：提取章节编号前缀（如 "01_", "Q26_"）+ part 前缀做模糊匹配
    var numMatch = slug.match(/^(Q?\d+)/);
    var partPrefix = parts[0]; // "part1", "part2", etc.
    if (numMatch) {
      var numPrefix = numMatch[1] + '_';
      // JSON 的 part 编号和 BOOK_STRUCTURE file 路径中的 partN_ 对应
      for (var p2 = 0; p2 < BOOK_STRUCTURE.length; p2++) {
        var chapters2 = BOOK_STRUCTURE[p2].chapters;
        for (var c2 = 0; c2 < chapters2.length; c2++) {
          var filePath = chapters2[c2].file;
          // 文件路径以 partN_ 开头且包含编号前缀
          if (filePath.indexOf(partPrefix + '_') === 0 && filePath.indexOf('/' + numPrefix) !== -1) {
            return chapters2[c2];
          }
        }
      }
    }

    // 策略 3：对没有编号的章节（如 "记忆系统"），用关键词匹配
    var keywords = slug.replace(/^\d+_/, '').split(/[_\s]+/);
    for (var p3 = 0; p3 < BOOK_STRUCTURE.length; p3++) {
      var chapters3 = BOOK_STRUCTURE[p3].chapters;
      for (var c3 = 0; c3 < chapters3.length; c3++) {
        var f = chapters3[c3].file;
        if (f.indexOf(partPrefix + '_') === 0) {
          var allMatch = true;
          for (var k = 0; k < keywords.length; k++) {
            if (keywords[k] && f.indexOf(keywords[k]) === -1) { allMatch = false; break; }
          }
          if (allMatch && keywords.length > 0) return chapters3[c3];
        }
      }
    }

    return null;
  }

  /**
   * 生成章节卡片的简短标题：去掉编号前缀，保留核心名。
   */
  function shortTitle(fullTitle) {
    // 去掉 "01 ", "Q01 " 等前缀
    return fullTitle.replace(/^(?:Q?\d+\s*·?\s*|序章：?\s*)/, '').trim();
  }

  /**
   * 点击章节卡片 → 跳转阅读器
   */
  function navigateToChapter(chapterId) {
    if (window.__appShowView) window.__appShowView('reader');
    if (window.__appLoadChapterById) window.__appLoadChapterById(chapterId);
  }

  /**
   * 渲染难度地图
   */
  function render(ratings) {
    // 1. 把每条评级关联到 BOOK_STRUCTURE
    var items = [];
    for (var i = 0; i < ratings.length; i++) {
      var r = ratings[i];
      var ch = findBookChapter(r.chapter);
      if (!ch) continue; // 未找到匹配章节，跳过
      items.push({
        difficulty: r.difficulty,
        friendly: r.friendly,
        metaphor: r.best_metaphor,
        notes: r.notes,
        chapter: ch,
      });
    }

    // 2. 按难度分组
    var grouped = GROUPS.map(function (g) {
      return {
        group: g,
        chapters: items.filter(function (it) {
          return it.difficulty >= g.range[0] && it.difficulty < g.range[1];
        }),
      };
    });

    // 处理难度恰好等于 5 的章节（放入最后一组）
    var maxGroup = grouped[grouped.length - 1];
    items.forEach(function (it) {
      if (it.difficulty === 5 && maxGroup.chapters.indexOf(it) === -1) {
        maxGroup.chapters.push(it);
      }
    });

    // 3. 每组内按难度升序
    grouped.forEach(function (g) {
      g.chapters.sort(function (a, b) { return a.difficulty - b.difficulty; });
    });

    // 4. 渲染
    var totalCards = 0;
    GRID_EL.innerHTML = '';

    grouped.forEach(function (g) {
      var col = document.createElement('div');
      col.className = 'dm-column';

      // 列头（双语支持）
      var en = isEn();
      var labelTxt = en ? g.group.labelEn : g.group.label;
      var rangeTxt = g.group.range[0] + '–' + g.group.range[1] + (en ? ' pts' : ' 分');
      var countTxt = g.chapters.length + (en ? ' chapters' : ' 章');
      var header = document.createElement('div');
      header.className = 'dm-column-header';
      header.style.borderBottomColor = g.group.color;
      header.innerHTML =
        '<span class="dm-header-emoji">' + g.group.emoji + '</span>' +
        '<span class="dm-header-label">' + labelTxt + '</span>' +
        '<span class="dm-header-range">' + rangeTxt + '</span>' +
        '<span class="dm-header-count">' + countTxt + '</span>';
      col.appendChild(header);

      // 章节卡片列表
      var list = document.createElement('div');
      list.className = 'dm-card-list';

      g.chapters.forEach(function (it) {
        var card = document.createElement('div');
        card.className = 'dm-card';
        card.style.borderLeftColor = g.group.color;
        card.setAttribute('role', 'button');
        card.setAttribute('tabindex', '0');

        var title = shortTitle(it.chapter.title);
        card.innerHTML =
          '<span class="dm-card-title">' + title + '</span>' +
          '<span class="dm-card-score">' + it.difficulty.toFixed(1) + '</span>';

        // Tooltip 内容（双语）
        var en2 = isEn();
        var tt = en2
          ? (it.chapter.titleEn || it.chapter.title)
          : it.chapter.title;
        if (it.metaphor && it.metaphor !== '—') {
          tt += en2 ? ('\nMetaphor: ' + it.metaphor) : ('\n比喻：' + it.metaphor);
        }
        tt += en2
          ? ('\nReadability: ' + it.friendly)
          : ('\n文科友好度：' + it.friendly);
        if (it.notes) tt += '\n' + it.notes;
        card.setAttribute('title', tt);

        // 点击 / 键盘导航
        card.addEventListener('click', function () {
          navigateToChapter(it.chapter.id);
        });
        card.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            navigateToChapter(it.chapter.id);
          }
        });

        list.appendChild(card);
        totalCards++;
      });

      col.appendChild(list);
      GRID_EL.appendChild(col);
    });

    // 更新标题里的统计
    var titleEl = document.querySelector('.difficulty-map-title');
    if (titleEl) {
      titleEl.innerHTML = '按难度阅读 · 找到你的入口 <span class="dm-total-badge">' + totalCards + ' 章</span>';
    }
  }

  /**
   * 初始化：加载 JSON 数据
   */
  function init() {
    fetch('book/_shared/difficulty-ratings.json')
      .then(function (resp) {
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        return resp.json();
      })
      .then(function (data) {
        if (data && data.ratings) {
          render(data.ratings);
        }
      })
      .catch(function (err) {
        console.warn('[difficulty-map] 加载失败:', err);
        GRID_EL.innerHTML = '<p style="color:#9a8b76;text-align:center;padding:20px;">难度数据加载失败</p>';
      });
  }

  // DOM ready 后执行（app.js 和 data.js 已先加载）
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
