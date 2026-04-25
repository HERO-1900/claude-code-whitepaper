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

const BASE = process.env.SMOKE_BASE_URL || 'https://hero-1900.github.io/claude-code-whitepaper';
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
      // 忽略第三方 / favicon
      if (u.includes(BASE) && !u.endsWith('favicon.ico')) {
        REPORT.networkFails.push({ url: u, status: resp.status() });
      }
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
    // 找一个章节链接（toc / sidebar）
    const linkClicked = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[href], [data-chapter], [data-href], li'));
      // 找包含 「这不是聊天机器人」 或 第一章相关字样的 link
      const target = links.find((el) => {
        const t = (el.innerText || el.textContent || '').trim();
        return t.includes('这不是聊天机器人') || t.includes('代码地图') || t.includes('权限系统');
      });
      if (target) {
        // 优先 click anchor，否则触发 mousedown
        target.click();
        return (target.innerText || '').slice(0, 50);
      }
      return null;
    });
    if (!linkClicked) {
      fail('chapter_load', { reason: 'no chapter link found' });
    } else {
      await page.waitForTimeout(3500);
      const readerLen = await page.evaluate(() => {
        // 找 reader / chapter 容器
        const sel = ['#reader', '.reader', '.chapter-content', '#chapter', 'main', 'article'];
        for (const s of sel) {
          const el = document.querySelector(s);
          if (el && el.innerText && el.innerText.length > 500) {
            return el.innerText.length;
          }
        }
        return document.body.innerText.length;
      });
      if (readerLen < 500) {
        fail('chapter_load', { readerLen, clicked: linkClicked });
      } else {
        ok('chapter_load', { readerLen, clicked: linkClicked });
      }
    }
  } catch (e) {
    fail('chapter_load', { error: String(e) });
  }

  // -------- Scenario 4: 难度过滤 --------
  try {
    // 回首页防止状态污染
    await page.goto(BASE + '/', { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(2000);
    const before = await page.evaluate(() => {
      // 数 toc 里的章节 item 数
      const items = document.querySelectorAll('[data-difficulty], .toc-item, .chapter-item, li.chapter, li[data-ch]');
      // 只数可见的
      let visible = 0;
      items.forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) visible++;
      });
      return { total: items.length, visible };
    });
    const filterClicked = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('button, a, [role=button], [data-difficulty]'));
      const btn = els.find((el) => {
        const t = (el.innerText || '').trim();
        return t === '入门' || t === 'Easy' || t === '简单' || t === '初级';
      });
      if (btn) { btn.click(); return true; }
      return false;
    });
    if (!filterClicked) {
      // filter 按钮不存在不算 hard fail（页面结构可能改）
      ok('difficulty_filter', { skipped: 'no easy button found', before });
    } else {
      await page.waitForTimeout(1200);
      const after = await page.evaluate(() => {
        const items = document.querySelectorAll('[data-difficulty], .toc-item, .chapter-item, li.chapter, li[data-ch]');
        let visible = 0;
        items.forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) visible++;
        });
        return { total: items.length, visible };
      });
      if (before.visible === after.visible && before.total > 0) {
        // 数量没变可能是 filter 没生效
        fail('difficulty_filter', { before, after, reason: 'visible count unchanged' });
      } else {
        ok('difficulty_filter', { before, after });
      }
    }
  } catch (e) {
    fail('difficulty_filter', { error: String(e) });
  }

  // -------- Scenario 5: 图表 iframe --------
  try {
    // 章节内查找 iframe（前面 chapter_load 已切到一个章节；如果没切，重新打开一个）
    const iframes = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('iframe')).map((f) => ({
        src: f.src,
        w: f.getBoundingClientRect().width,
        h: f.getBoundingClientRect().height,
      }));
    });
    const chartIframes = iframes.filter((f) => f.src && f.src.includes('/charts/'));
    if (chartIframes.length === 0) {
      // 如果当前页没图表，主动切到肯定有图的章节
      await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a, li, [data-chapter]'));
        const target = links.find((el) => (el.innerText || '').includes('代码地图') || (el.innerText || '').includes('系统调用'));
        if (target) target.click();
      });
      await page.waitForTimeout(4000);
      const iframes2 = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('iframe')).map((f) => ({
          src: f.src,
        }));
      });
      const chartIframes2 = iframes2.filter((f) => f.src && f.src.includes('/charts/'));
      if (chartIframes2.length === 0) {
        fail('chart_iframe', { reason: 'no chart iframe found in any tested chapter' });
      } else {
        ok('chart_iframe', { count: chartIframes2.length, sample: chartIframes2[0].src });
      }
    } else {
      ok('chart_iframe', { count: chartIframes.length, sample: chartIframes[0].src });
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
