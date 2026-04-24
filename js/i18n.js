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

  /** 切换语言 */
  function switchLocale(newLocale) {
    locale = newLocale;
    try { localStorage.setItem('cc-locale', newLocale); } catch (e) {}
    return fetch('js/locales/' + newLocale + '.json')
      .then(function (r) { return r.json(); })
      .then(function (data) { dict = data; apply(); })
      .catch(function (err) { console.warn('[i18n] 切换失败:', newLocale, err); });
  }

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
