/**
 * svg-inline.js — 把 <div.embedded-diagram-host data-src="foo.svg"> 运行时 fetch + 内联成 DOM SVG
 *
 * 三件事：
 *   1. fetch SVG 文本 + 作用域隔离内嵌 <style> + 注入 DOM（外部 CSS 直达）
 *   2. 根据 <html lang> 做文本 i18n（图表里原本硬编码英文）
 *   3. 监听 html lang / data-theme 切换，实时重译
 *
 * 历史：
 *   - commit 29608ed 用 filter invert+hue-rotate → 灰蒙
 *   - commit 83c7484 改内联 + 属性选择器覆盖 → 颜色 OK 但文本仍纯英文
 *   - 本次 加 i18n 翻译字典解决中文下图表英文残留
 */
(function () {
  'use strict';

  // ──────────────────────────────────────────────
  // 英文 → 中文 翻译表（6 张 SVG 所有文字条目）
  // 原则：技术术语保留英文（API / JSON / Tool / CLI / Bash / MCP / Git 等）
  //       路径 / 文件名 / 代码 / 数字保留原样
  //       自然语言句子全译；标题译
  const ZH = {
    // ===== agent-loop-flow.svg =====
    "Agent Loop Flow": "Agent 循环",
    "Claude Code Query Execution Cycle": "Claude Code 查询执行循环",
    "User Input": "用户输入",
    "Build System Prompt": "构建 System Prompt",
    "Call Claude API": "调用 Claude API",
    "Parse Response": "解析响应",
    "Has Tool": "是否",
    "Calls?": "有工具调用？",
    "Execute Tools": "执行工具",
    "Collect Results": "收集结果",
    "Final Response": "最终响应",
    "Return to user": "返回用户",
    "Re-enter loop": "重新入循环",
    "Yes": "是",
    "No": "否",
    "Legend": "图例",
    "Input / Output": "输入 / 输出",
    "AI Processing": "AI 处理",
    "Tool Execution": "工具执行",
    "Decision": "决策",
    "Loop / Return": "循环 / 返回",

    // ===== architecture-treemap.svg =====
    "Claude Code Architecture": "Claude Code 架构",
    "Layered Module Map": "分层模块图",
    "CLI ENTRY POINTS": "CLI 入口",
    "CORE ENGINE": "核心引擎",
    "INFRASTRUCTURE": "基础设施",
    "SERVICES": "服务",
    "TOOLS": "工具",
    "TOOL RUNTIME": "工具运行时",
    "request": "请求",
    "execution": "执行",
    "response": "响应",
    "Agent orchestration, query cycle, prompt assembly": "Agent 编排、查询循环、Prompt 组装",
    "External integrations and side-channel systems": "外部集成与侧通道系统",
    "Sandbox, security, persistence, rendering": "沙箱、安全、持久化、渲染",
    "43 built-in tools": "43 个内置工具",
    "Agent (sub)": "Agent（子任务）",
    "Agent Class": "Agent 类",
    "API Client": "API 客户端",
    "Messages": "消息",
    "Hooks": "Hooks",
    "Plugins": "插件",
    "Settings": "设置",
    "Telemetry / Auth": "遥测 / 认证",
    "Sandbox (macOS)": "沙箱 (macOS)",
    "Permissions": "权限",
    "State / Persistence": "状态 / 持久化",
    "Terminal UI": "终端 UI",
    "Cost Ctrl": "成本控制",
    "MCP Server": "MCP 服务",
    "MCP Tools": "MCP 工具",
    "+30 more...": "+30 更多…",
    "utils/": "utils/（工具库）",
    "components/": "components/（组件）",
    "services/": "services/（服务）",
    "tools/": "tools/（工具）",
    "commands/": "commands/（命令）",
    "ink/": "ink/（终端渲染）",
    "hooks/": "hooks/（钩子）",
    "bridge/": "bridge/（桥接）",
    "cli/": "cli/（CLI）",
    "screens/": "screens/（屏幕）",
    "keybindings/": "keybindings/（快捷键）",
    "constants/": "constants/（常量）",
    "types/": "types/（类型）",
    "mmdir/": "mmdir/",
    "vim/": "vim/",
    "entrypoints/": "entrypoints/（入口）",
    "skills/": "skills/（技能）",
    "buddy/": "buddy/（伙伴）",
    "state/": "state/（状态）",
    "remote/": "remote/（远程）",
    "context/": "context/（上下文）",
    "files": "文件",
    "lines": "行",
    "React Context 提供者": "React Context 提供者",

    // ===== token-lifecycle.svg =====
    "Token Lifecycle": "Token 生命周期",
    "From user input to cost tracking and compression": "从用户输入到成本追踪与压缩",
    "REQUEST PATH": "请求路径",
    "RESPONSE PATH": "响应路径",
    "Text / file references": "文本 / 文件引用",
    "processUserInput()": "processUserInput()",
    "Validate, parse, expand": "验证、解析、展开",
    "System Prompt Assembly": "System Prompt 组装",
    "6-layer sandwich build": "六层三明治构建",
    "API Request": "API 请求",
    "messages + system + tools": "messages + system + tools",
    "SSE Stream": "SSE 流",
    "Server-sent events": "服务端推送事件",
    "Token Counting": "Token 计数",
    "API usage headers": "API 用量头",
    "Cost Tracking": "成本追踪",
    "Cumulative $ spent": "累计消耗 $",
    "Compression Check": "压缩检查",
    "softLimit / hardLimit": "softLimit / hardLimit",
    "HTTP POST / SSE": "HTTP POST / SSE",
    "Token Pricing (per MTok)": "Token 定价（每百万 Token）",
    "input": "input（输入）",
    "cache_write": "cache_write（缓存写）",
    "cache_read": "cache_read（缓存读）",
    "output": "output（输出）",

    // ===== permission-state-machine.svg =====
    "Permission Check Flow": "权限检查流程",
    "9-Step Sequential Evaluation Pipeline": "九步顺序评估管线",
    "STEP 1": "步骤 1",
    "STEP 2": "步骤 2",
    "STEP 3": "步骤 3",
    "STEP 4": "步骤 4",
    "STEP 5": "步骤 5",
    "STEP 6": "步骤 6",
    "STEP 7": "步骤 7",
    "STEP 8": "步骤 8",
    "STEP 9": "步骤 9",
    "Bypass-Immune Check": "豁免检查",
    "Cache Result": "缓存结果",
    "Deny-List Check": "拒绝名单检查",
    "Allow-List Check": "允许名单检查",
    "Mode Check": "模式检查",
    "Policy Check": "策略检查",
    "Risk Assessment": "风险评估",
    "Resolution": "最终判定",
    "Allowed": "允许",
    "Denied": "拒绝",
    "Cached": "已缓存",
    "Cached Decision": "缓存判定",
    "Short-circuit allow": "短路允许",
    "Short-circuit deny": "短路拒绝",
    "Continue to next step": "继续下一步",
    "continue": "继续",
    "miss": "未命中",
    "evaluate": "评估",
    "low / medium / high": "低 / 中 / 高",
    "Check step": "检查步骤",
    "Decision step": "决策步骤",

    // ===== context-compression-pipeline.svg =====
    "Context Compression Pipeline": "上下文压缩管线",
    "4-stage pipeline to manage context window utilization": "四阶段管线管理上下文窗口利用率",
    "Stage 1: Monitor": "阶段 1：监控",
    "Stage 2: Slice": "阶段 2：切片",
    "Stage 3: Summarize": "阶段 3：摘要",
    "Stage 4: Persist": "阶段 4：持久化",
    "Stage 4: Memories": "阶段 4：记忆",
    "Summary replaces original turns": "摘要替换原始对话",
    "−60%": "−60%",
    "Check token count after each turn": "每轮后检查 token 计数",
    "Compare against softLimit/hardLimit": "与 softLimit/hardLimit 对比",
    "Select oldest conversation turns": "选最早的会话轮",
    "Preserve recent context window": "保留近期上下文窗口",
    "LLM generates concise summary": "LLM 生成精简摘要",
    "of sliced conversation turns": "对切出的会话轮",
    "Extract key facts to CLAUDE.md": "关键事实沉淀到 CLAUDE.md",
    "Persist across future sessions": "跨未来会话持久化",
    "Context Window": "上下文窗口",
    "Pipeline runs automatically when context utilization exceeds softLimit (80%)": "利用率超 softLimit (80%) 时管线自动运行",
    "Conversation data before compression": "压缩前会话数据",
    "Oldest turns marked for summarization": "最早几轮标记为待摘要",
    "softLimit": "softLimit（软上限）",
    "hardLimit": "hardLimit（硬上限）",
    "exceeds softLimit": "超过 softLimit",
    "sliced": "已切片",
    "persist": "持久化",
    "CLAUDE.md": "CLAUDE.md",
    "+3 new memories": "+3 条新记忆",
    "200K tokens": "200K token",
    "175,000 tokens (87.5%)": "175,000 token (87.5%)",
    "122K tokens": "122K token",
    "70K tokens": "70K token",
    "80% = 160K": "80% = 160K",
    "95% = 190K": "95% = 190K",

    // ===== system-prompt-sandwich.svg =====
    "System Prompt Sandwich": "System Prompt 三明治",
    "6-layer system prompt structure with cache boundary": "六层 System Prompt 结构 + 缓存边界",
    "1. Core Identity": "1. 核心身份",
    "2. Tool Definitions": "2. 工具定义",
    "3. Environment Info": "3. 环境信息",
    "4. CLAUDE.md Instructions": "4. CLAUDE.md 指令",
    "5. Context Reminders": "5. 上下文提醒",
    "6. Conversation History": "6. 会话历史",
    "Role definition, capabilities, safety rules, behavioral guidelines": "角色定义、能力、安全规则、行为准则",
    "JSON schemas for all available tools (Read, Write, Bash, Grep, ...)": "所有可用工具的 JSON schema（Read / Write / Bash / Grep…）",
    "CWD, OS, shell, git status, project type": "CWD / OS / shell / git 状态 / 项目类型",
    "Project-specific rules, 3-tier hierarchy (~/.claude, project, cwd)": "项目规则，三层优先级（~/.claude / 项目 / cwd）",
    "system-reminder injections, MCP servers, active tools, memories": "system-reminder 注入、MCP 服务、激活工具、记忆",
    "All prior messages, tool calls, tool results — grows with each turn": "所有历史消息 / 工具调用 / 工具结果 —— 每轮递增",
    "Subject to compression when approaching context window limit": "接近上下文窗口上限时会被压缩",
    "CACHED (above)": "已缓存（上方）",
    "UNCACHED (below)": "未缓存（下方）",
    "Layers 1-3 are cached across turns (cache_read pricing). Layers 4-6 are rebuilt each turn (cache_write pricing).":
      "第 1-3 层跨轮缓存（cache_read 价格）· 第 4-6 层每轮重建（cache_write 价格）",
    "Total context window: 200K tokens (Claude Sonnet 4) | Compression triggers at ~80% utilization":
      "总上下文窗口：200K token（Claude Sonnet 4）· 利用率 ~80% 时触发压缩",
    "DYNAMIC_BOUNDARY": "动态边界",
    "messages[ ] + system": "messages[ ] + system",
    "~4,200 tokens": "~4,200 token",
    "~3,100 tokens": "~3,100 token",
    "~500 tokens": "~500 token",
    "~variable": "~可变",
    "~growing": "~递增",
  };

  function isChinese() {
    // 站点 i18n.js 使用 localStorage['cc-locale']（'zh' / 'en'），默认 'zh'
    try {
      var stored = localStorage.getItem('cc-locale');
      if (stored) return stored === 'zh';
    } catch (_) {}
    // 次选：window.i18n.getLocale()（如果 i18n.js 已加载）
    if (window.i18n && typeof window.i18n.getLocale === 'function') {
      return window.i18n.getLocale() === 'zh';
    }
    // 末选：URL 路径
    if (window.location.pathname.indexOf('/en/') === 0) return false;
    return true; // 默认中文
  }

  function scopeStyles(svgText) {
    return svgText.replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/gi, function (_m, open, body, close) {
      var scoped = body.replace(/([^{}]+)\{([^{}]*)\}/g, function (_rule, selectors, declarations) {
        var out = selectors.split(',').map(function (s) {
          var t = s.trim();
          if (!t) return t;
          if (t.charAt(0) === '@') return t;
          return '.embedded-diagram-host svg ' + t;
        }).join(', ');
        return out + ' {' + declarations + '}';
      });
      return open + scoped + close;
    });
  }

  // 保存每个 text / tspan 的原始英文，便于中英切换时恢复
  function stashOriginal(host) {
    host.querySelectorAll('text, tspan').forEach(function (el) {
      if (el.dataset.origText == null) {
        var t = el.textContent;
        // 只对直接含 text 且无子元素的叶子节点处理；有 tspan 子的 <text> 跳过（由 tspan 处理）
        var hasChildEl = Array.prototype.some.call(el.children, function (c) {
          return c.tagName && c.tagName.toLowerCase() === 'tspan';
        });
        if (!hasChildEl) {
          el.dataset.origText = t;
        }
      }
    });
  }

  function applyLang(host) {
    var zh = isChinese();
    host.querySelectorAll('text, tspan').forEach(function (el) {
      var orig = el.dataset.origText;
      if (orig == null) return;
      var key = orig.trim();
      if (zh && ZH[key]) {
        el.textContent = ZH[key];
      } else {
        el.textContent = orig;
      }
    });
  }

  function renderHost(host, svgText) {
    host.innerHTML = scopeStyles(svgText);
    stashOriginal(host);
    applyLang(host);
  }

  function inlineHost(host) {
    var src = host.getAttribute('data-src');
    if (!src || host.dataset.inlined === '1') return;
    host.dataset.inlined = '1';
    // 优先查构建时 bundle（window.__SVG_DATA，由 scripts/build-svg-bundle.js 生成）
    if (window.__SVG_DATA && typeof window.__SVG_DATA[src] === 'string') {
      try { renderHost(host, window.__SVG_DATA[src]); return; } catch (e) {
        console.warn('[svg-inline] bundle render failed for', src, e);
      }
    }
    // Fallback：bundle 没命中（例如新加的 SVG 还没重新 build）则走 fetch
    fetch(src, { cache: 'force-cache' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
      .then(function (text) { renderHost(host, text); })
      .catch(function (err) {
        host.dataset.inlined = '0';
        console.warn('[svg-inline] load failed', src, err);
        host.innerHTML = '<img src="' + src + '" alt="" loading="lazy" style="width:100%;height:auto;display:block" />';
      });
  }

  function inlineAll() {
    document.querySelectorAll('.embedded-diagram-host[data-src]').forEach(inlineHost);
  }

  function reapplyAllLang() {
    document.querySelectorAll('.embedded-diagram-host[data-inlined="1"]').forEach(applyLang);
  }

  // 切语言时重译：wrap window.i18n.switch，让它在切换后回调 reapplyAllLang
  function hookI18n() {
    if (!window.i18n || typeof window.i18n.switch !== 'function' || window.i18n.__svgInlineHooked) return;
    var origSwitch = window.i18n.switch;
    window.i18n.switch = function (newLocale) {
      var p = origSwitch.apply(this, arguments);
      // switch 返回 Promise（加载新 locale JSON）
      if (p && typeof p.then === 'function') {
        return p.then(function (v) { reapplyAllLang(); return v; });
      }
      reapplyAllLang();
      return p;
    };
    window.i18n.__svgInlineHooked = true;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { inlineAll(); hookI18n(); });
  } else {
    inlineAll();
    hookI18n();
  }
  // i18n.js 可能晚于本脚本加载，轮询几次兜底
  var hookTries = 0;
  var hookTimer = setInterval(function () {
    hookI18n();
    hookTries++;
    if (hookTries > 20 || (window.i18n && window.i18n.__svgInlineHooked)) clearInterval(hookTimer);
  }, 200);

  window.__svgInline = { inlineAll: inlineAll, inlineHost: inlineHost, reapplyAllLang: reapplyAllLang, ZH: ZH };
})();
