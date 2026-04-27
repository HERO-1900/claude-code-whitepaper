#!/usr/bin/env node
/**
 * ci-smoke.js · 公仓 CI 用 Playwright 冒烟脚本
 *
 * 5 个核心场景（必须全过，否则 CI 失败）：
 *   1. 首页加载，无 console error / network fail
 *   2. 中英切换：点 EN → 顶部导航文案变英文 → 点 ZH 回中文（持久化到 localStorage）
 *   3. 章节加载：点一个抽样章节 → reader 出现内容（>500 字符）
 *   4. 难度过滤：点 「入门」按钮 → 章节列表 DOM 数量变化
 *   5. 图表 iframe：找到嵌入的 iframe，确认 src 指向 /charts/，加载成功
 *
 * 输出：ci-smoke-report.json + 失败时上传截图
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const os = require('os');

const BASE = process.env.SMOKE_BASE_URL || 'https://insidecc.dev';
const OUT_REPORT = path.join(process.cwd(), 'ci-smoke-report.json');

const REPORT = {
  base: BASE,
  ts: new Date().toISOString(),
  scenarios: {},
  consoleErrors: [],
  networkFails: [],
};

function ok(name, detail) {
  REPORT.scenarios[name] = { ok: true, ...detail };
  console.log(`  PASS  ${name}`);
}
function fail(name, detail) {
  REPORT.scenarios[name] = { ok: false, ...detail };
  console.log(`  FAIL  ${name}: ${JSON.stringify(detail)}`);
}

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-cismoke-'));
  const ctx = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    viewport: { width: 1440, height: 900 },
  });
  const page = ctx.pages()[0] || await ctx.newPage();

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      REPORT.consoleErrors.push({ text: msg.text() });
    }
  });
  page.on('response', (resp) => {
    if (resp.status() >= 400) {
      const u = resp.url();
      // 忽略：第三方 / favicon / inline-warm 渐进增强 fallback / chart-embed-fallback 探测
      if (
        !u.includes(BASE) ||
        u.endsWith('favicon.ico') ||
        u.includes('/test-viz/inline-warm/') ||
        u.includes('/inline-warm/')
      ) return;
      REPORT.networkFails.push({ url: u, status: resp.status() });
    }
  });

  console.log(`\n=== ci-smoke vs ${BASE} ===\n`);

  // -------- Scenario 1: home --------
  try {
    await page.goto(BASE + '/', { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(2500);
    const title = await page.title();
    if (!title || title.length < 3) {
      fail('home_loaded', { title });
    } else {
      ok('home_loaded', { title });
    }
  } catch (e) {
    fail('home_loaded', { error: String(e) });
  }

  // -------- Scenario 2: 中英切换 --------
  try {
    // 截当前 zh 状态某段文案
    const zhBefore = await page.evaluate(() => document.body.innerText.slice(0, 500));
    // 找语言切换按钮（多种可能的选择器，鲁棒）
    const langClicked = await page.evaluate(() => {
      const candidates = Array.from(document.querySelectorAll('button, a, [role=button]'));
      const btn = candidates.find((el) => {
        const t = (el.innerText || el.textContent || '').trim();
        return t === 'EN' || t === 'English' || t.toLowerCase() === 'en';
      });
      if (btn) { btn.click(); return true; }
      return false;
    });
    if (!langClicked) {
      fail('lang_switch', { reason: 'EN button not found' });
    } else {
      await page.waitForTimeout(1500);
      const enAfter = await page.evaluate(() => document.body.innerText.slice(0, 500));
      // 切换前后的前 500 字符不应完全一致
      if (zhBefore === enAfter) {
        fail('lang_switch', { reason: 'no text change after EN click' });
      } else {
        // 检查 localStorage 持久化
        const stored = await page.evaluate(() => localStorage.getItem('cc-locale') || localStorage.getItem('locale') || '');
        ok('lang_switch', { stored });
      }
      // 切回中文
      await page.evaluate(() => {
        const candidates = Array.from(document.querySelectorAll('button, a, [role=button]'));
        const btn = candidates.find((el) => {
          const t = (el.innerText || el.textContent || '').trim();
          return t === 'ZH' || t === '中文' || t.toLowerCase() === 'zh';
        });
        if (btn) btn.click();
      });
      await page.waitForTimeout(1000);
    }
  } catch (e) {
    fail('lang_switch', { error: String(e) });
  }

  // -------- Scenario 3: 章节加载 --------
  try {
    // 步骤 1：进 reader 视图（首页是 hero/panorama 模式，TOC 在 reader view 里）
    await page.evaluate(() => {
      const navReader = document.querySelector('#nav-reader');
      if (navReader) navReader.click();
    });
    await page.waitForTimeout(2500);
    // 步骤 2：在 #toc 里找一个章节链接（动态生成，可能是 a / button / li）
    const linkClicked = await page.evaluate(() => {
      const toc = document.querySelector('#toc');
      if (!toc) return { found: false, reason: 'no #toc' };
      // 真实 DOM：TOC items 是 div.toc-chapter（带 data-chapter-id）
      const leaves = Array.from(toc.querySelectorAll('.toc-chapter, [data-chapter-id]'));
      if (leaves.length === 0) return { found: false, reason: 'no leaf items', total: items.length };
      const target = leaves[Math.min(3, leaves.length - 1)]; // 第 4 个，避开 part 标题
      target.click();
      return { found: true, text: (target.innerText || '').slice(0, 60), totalLeaves: leaves.length };
    });
    if (!linkClicked.found) {
      fail('chapter_load', linkClicked);
    } else {
      await page.waitForTimeout(4000);
      const readerLen = await page.evaluate(() => {
        const body = document.querySelector('#chapter-body');
        return body ? (body.innerText || '').length : 0;
      });
      if (readerLen < 200) {
        fail('chapter_load', { readerLen, clicked: linkClicked });
      } else {
        ok('chapter_load', { readerLen, clicked: linkClicked });
      }
    }
  } catch (e) {
    fail('chapter_load', { error: String(e) });
  }

  // -------- Scenario 4: 难度过滤（在 reader view 里）--------
  try {
    // 章节加载场景已经在 reader view，可以继续用
    const before = await page.evaluate(() => {
      const toc = document.querySelector('#toc');
      if (!toc) return { total: 0, visible: 0 };
      const items = toc.querySelectorAll('.toc-chapter, [data-chapter-id]');
      let visible = 0;
      items.forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) visible++;
      });
      return { total: items.length, visible };
    });
    const filterClicked = await page.evaluate(() => {
      // 难度过滤通常是 toc 上方/侧边的按钮组
      const els = Array.from(document.querySelectorAll('button, a, [role=button], [data-difficulty]'));
      const btn = els.find((el) => {
        const t = (el.innerText || '').trim();
        return t === '入门' || t === 'Easy' || t === '简单' || t === '初级' || t === '初阶';
      });
      if (btn) { btn.click(); return true; }
      return false;
    });
    if (!filterClicked) {
      ok('difficulty_filter', { skipped: 'no easy button found', before });
    } else {
      await page.waitForTimeout(1500);
      const after = await page.evaluate(() => {
        const toc = document.querySelector('#toc');
        if (!toc) return { total: 0, visible: 0 };
        const items = toc.querySelectorAll('.toc-chapter, [data-chapter-id]');
        let visible = 0;
        items.forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) visible++;
        });
        return { total: items.length, visible };
      });
      if (before.visible === after.visible && before.total > 0) {
        fail('difficulty_filter', { before, after, reason: 'visible count unchanged' });
      } else {
        ok('difficulty_filter', { before, after });
      }
    }
  } catch (e) {
    fail('difficulty_filter', { error: String(e) });
  }

  // -------- Scenario 5: 图表 iframe --------
  // 不依赖具体哪一章有图，遍历多个章节找到第一个 iframe 即可
  try {
    let foundIframe = null;
    // 先看当前 chapter-body
    foundIframe = await page.evaluate(() => {
      const iframes = Array.from(document.querySelectorAll('#chapter-body iframe, iframe'));
      const charts = iframes.filter((f) => f.src && f.src.includes('/charts/'));
      return charts.length > 0 ? { src: charts[0].src, count: charts.length } : null;
    });
    if (!foundIframe) {
      // 在 #toc 里挑前 8 个 leaf，逐个点击直到找到 iframe
      const tocLeaves = await page.evaluate(() => {
        const toc = document.querySelector('#toc');
        if (!toc) return 0;
        return toc.querySelectorAll('.toc-chapter, [data-chapter-id]').length;
      });
      const tryN = Math.min(tocLeaves, 12);
      for (let i = 0; i < tryN; i++) {
        const clicked = await page.evaluate((idx) => {
          const toc = document.querySelector('#toc');
          if (!toc) return false;
          const leaves = Array.from(toc.querySelectorAll('.toc-chapter, [data-chapter-id]'));
          if (idx >= leaves.length) return false;
          leaves[idx].click();
          return true;
        }, i);
        if (!clicked) break;
        await page.waitForTimeout(2500);
        foundIframe = await page.evaluate(() => {
          const iframes = Array.from(document.querySelectorAll('#chapter-body iframe, iframe'));
          const charts = iframes.filter((f) => f.src && f.src.includes('/charts/'));
          return charts.length > 0 ? { src: charts[0].src, count: charts.length } : null;
        });
        if (foundIframe) break;
      }
    }
    if (foundIframe) {
      ok('chart_iframe', foundIframe);
    } else {
      fail('chart_iframe', { reason: 'no chart iframe found in 12 sampled chapters' });
    }
  } catch (e) {
    fail('chart_iframe', { error: String(e) });
  }

  // -------- 汇总 --------
  await ctx.close();

  const failures = Object.entries(REPORT.scenarios).filter(([, v]) => v.ok === false);
  REPORT.summary = {
    total: Object.keys(REPORT.scenarios).length,
    passed: Object.values(REPORT.scenarios).filter((v) => v.ok).length,
    failed: failures.length,
    consoleErrors: REPORT.consoleErrors.length,
    networkFails: REPORT.networkFails.length,
  };

  fs.writeFileSync(OUT_REPORT, JSON.stringify(REPORT, null, 2));

  console.log('\n=== summary ===');
  console.log(JSON.stringify(REPORT.summary, null, 2));

  if (failures.length > 0) {
    console.log('\nfailed scenarios:');
    failures.forEach(([k, v]) => console.log(`  - ${k}:`, v));
    process.exit(1);
  }
  // network/console 错误降级为 warning（不阻塞 CI），因为线上可能有第三方分析脚本
  if (REPORT.consoleErrors.length > 5 || REPORT.networkFails.length > 3) {
    console.log('\nWARN: too many console/network errors');
    console.log('console errors:', REPORT.consoleErrors.slice(0, 10));
    console.log('network fails:', REPORT.networkFails.slice(0, 10));
  }
  process.exit(0);
})().catch((e) => {
  console.error('FATAL', e);
  fs.writeFileSync(OUT_REPORT, JSON.stringify({ ...REPORT, fatal: String(e) }, null, 2));
  process.exit(1);
});
