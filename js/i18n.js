/**
 * i18n.js — 极简国际化运行时
 * 无外部依赖，兼容无构建工具环境
 */
(function () {
  'use strict';

  var dict = {};
  var locale = 'zh';

  /** 按点号路径查找嵌套值 */
  function resolve(obj, path) {
    var keys = path.split('.');
    var cur = obj;
    for (var i = 0; i < keys.length; i++) {
      if (cur == null) return undefined;
      cur = cur[keys[i]];
    }
    return cur;
  }

  /** 翻译函数 */
  function t(key, fallback) {
    var val = resolve(dict, key);
    return val !== undefined ? val : (fallback !== undefined ? fallback : key);
  }

  /** 扫描 DOM 并替换文案 */
  function apply() {
    // textContent 替换
    var els = document.querySelectorAll('[data-i18n]');
    for (var i = 0; i < els.length; i++) {
      var key = els[i].getAttribute('data-i18n');
      var val = resolve(dict, key);
      if (val !== undefined) els[i].textContent = val;
    }
    // 属性替换（格式: "attr:key" 或 "attr1:key1;attr2:key2"）
    var attrEls = document.querySelectorAll('[data-i18n-attr]');
    for (var j = 0; j < attrEls.length; j++) {
      var parts = attrEls[j].getAttribute('data-i18n-attr').split(';');
      for (var k = 0; k < parts.length; k++) {
        var pair = parts[k].split(':');
        if (pair.length === 2) {
          var val2 = resolve(dict, pair[1].trim());
          if (val2 !== undefined) attrEls[j].setAttribute(pair[0].trim(), val2);
        }
      }
    }
  }

  /** 检测初始 locale */
  function detectLocale() {
    // URL 路径优先
    if (window.location.pathname.indexOf('/en/') === 0) return 'en';
    // localStorage 次之
    try {
      var stored = localStorage.getItem('cc-locale');
      if (stored) return stored;
    } catch (e) {}
    // 默认中文
    return 'zh';
  }

  /** 加载语言文件并应用 */
  function init() {
    locale = detectLocale();
    return fetch('js/locales/' + locale + '.json')
      .then(function (r) { return r.json(); })
      .then(function (data) { dict = data; apply(); })
      .catch(function (err) { console.warn('[i18n] 加载失败:', locale, err); });
  }

  /** 同步 <html> 上的 lang/data-lang 属性，触发 chart-embed.js 的 MutationObserver
   *  → 让所有已加载的图表 iframe 收到 cc-lang postMessage 自动切换 .lz/.le */
  function syncHtmlLangAttr(newLocale) {
    try {
      var html = document.documentElement;
      html.setAttribute('data-lang', newLocale);
      html.setAttribute('lang', newLocale === 'en' ? 'en' : 'zh-CN');
    } catch (e) {}
  }

  /** 显式向所有图表 iframe 广播 lang/theme（不依赖 MutationObserver，
   *  因为某些时序下 mutation 没触发 chart-embed 监听器）*/
  function broadcastToCharts(newLocale) {
    try {
      var theme = document.documentElement.getAttribute('data-theme') || 'dark';
      // 向当前 DOM 中所有图表 iframe 直接发 postMessage
      document.querySelectorAll('iframe.chart-embed-iframe').forEach(function (f) {
        if (!f.contentWindow) return;
        try {
          f.contentWindow.postMessage({ type: 'cc-lang', lang: newLocale }, '*');
          f.contentWindow.postMessage({ type: 'cc-theme', theme: theme }, '*');
          f.contentWindow.postMessage({ type: 'v2-sync', lang: newLocale, theme: theme }, '*');
        } catch (e) { /* cross-origin/detached, 静默 */ }
      });
    } catch (e) { console.warn('[i18n] broadcastToCharts 失败', e); }
  }

  /** 切换语言 */
  function switchLocale(newLocale) {
    locale = newLocale;
    try { localStorage.setItem('cc-locale', newLocale); } catch (e) {}
    syncHtmlLangAttr(newLocale);
    broadcastToCharts(newLocale);  // 显式广播，兜底 MutationObserver
    return fetch('js/locales/' + newLocale + '.json')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        dict = data; apply();
        // apply() 后再广播一次（处理 i18n 触发章节重渲染期间新创建的 iframe）
        setTimeout(function () { broadcastToCharts(newLocale); }, 300);
        setTimeout(function () { broadcastToCharts(newLocale); }, 1000);
      })
      .catch(function (err) { console.warn('[i18n] 切换失败:', newLocale, err); });
  }

  /** 初始化时也同步一次 */
  document.addEventListener('DOMContentLoaded', function () {
    try {
      var l = (localStorage.getItem('cc-locale') || 'zh');
      syncHtmlLangAttr(l);
    } catch (e) {}
  });

  // 暴露到全局
  window.i18n = {
    init: init,
    t: t,
    apply: apply,
    switch: switchLocale,
    getLocale: function () { return locale; }
  };

  // DOM Ready 后自动初始化
  document.addEventListener('DOMContentLoaded', function () { window.i18n.init(); });
})();
