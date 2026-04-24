# Buddy 伴侣系统完全解析

Buddy 是 Claude Code 2.1.88 中隐藏的虚拟宠物系统——在约 80KB 的代码中实现了确定性角色生成、ASCII 精灵动画和 AI 多角色交互。本章重点拆解三个对 AI 从业者最有参考价值的设计：**Bones/Soul 双层数据架构**（确定性衍生 + AI 生成持久化）、**多角色边界管理的提示词工程**（如何让 LLM 在多角色场景中正确退让）、以及**编译时特性门控**（比运行时环境变量更安全的内部/外部版本分离）。

> **源码位置**：`src/buddy/`（6 个文件，约 80KB）——`companion.ts`（生成算法）、`types.ts`（类型定义）、`sprites.ts`（精灵渲染）、`prompt.ts`（提示词注入）、`CompanionSprite.tsx`（动画引擎，46KB）、`useBuddyNotification.tsx`（通知系统）

---

> **🌍 行业背景**：在 CLI 工具中嵌入虚拟宠物/游戏化元素并非 Claude Code 首创。GitHub 的 Octocat 和 npm 的 wombat 是早期的吉祥物文化案例，但它们仅限于品牌视觉层面。真正在开发者工具中实现交互式宠物的先例是 **VS Code 的 vscode-pets 扩展**（2021年），允许用户在编辑器底栏养一只像素宠物。**Tamagotchi 模式**在游戏行业早已成熟（确定性 PRNG + 稀有度权重是 gacha 游戏的标准技术）。Claude Code 的独特之处在于将这套机制嵌入了 **CLI 终端环境**——用 ASCII art 而非像素图来渲染精灵，并通过系统提示词让 AI 主模型"感知"宠物的存在。Cursor、Aider、Windsurf 等竞品目前都没有类似的情感化设计。

---

## 本章导读

Buddy 是 Claude Code 2.1.88 中一个意想不到的子系统——一个完整的**虚拟宠物（电子宠物）系统**。每个用户基于其 userId 的哈希值，确定性地生成一只独一无二的 ASCII 艺术小动物，它有自己的物种、眼睛、帽子、稀有度、属性值，甚至有 AI 生成的名字和性格。

**技术比喻（OS 视角）**：Buddy 系统像操作系统中的**用户头像生成器 + 桌面小部件引擎**——从用户身份信息出发，通过确定性伪随机算法生成外观（Identicon/Gravatar 的 ASCII 版本），再通过 React 组件将其渲染为交互式桌面小部件，支持动画帧、气泡对话、事件响应。

> 💡 **通俗理解**：Buddy 就像**电子宠物 / 拓麻歌子**——有自己的性格、会在你工作时陪伴你、偶尔在对话气泡里给你小评论。不同的是，你的宠物种类和属性完全由你的账户 ID 决定——就像一个"命中注定的伙伴"。

## 文件结构

| 文件 | 大小 | 职责 |
|------|------|------|
| `src/buddy/companion.ts` | 3.7KB | 伴侣生成核心算法——PRNG、哈希、骰子系统 |
| `src/buddy/types.ts` | 9.8KB | 类型定义——物种、眼睛、帽子、稀有度、属性 |
| `src/buddy/sprites.ts` | 9.8KB | ASCII 精灵图渲染——18 种动物 x 3 帧动画 |
| `src/buddy/prompt.ts` | 1.5KB | 系统提示词注入——告知 Claude 伴侣的存在 |
| `src/buddy/useBuddyNotification.tsx` | 10KB | 通知钩子——彩虹色 `/buddy` 预告 |
| `src/buddy/CompanionSprite.tsx` | 46KB | 精灵渲染组件——动画、气泡、交互 |

总计约 80KB，其中 `CompanionSprite.tsx` 独占 46KB（React Compiler 编译产物，含完整的精灵渲染与动画逻辑）。

## 1. 确定性伴侣生成

### 1.1 PRNG 与哈希：标准组件速览

伴侣系统的确定性生成基于两个标准算法组件：

- **Mulberry32 PRNG**（`companion.ts` 第 16-25 行）：一个 32 位可播种伪随机数生成器，使用加法-乘法-异或移位的组合操作。注意：Mulberry32 **不是**线性同余生成器（LCG），它属于**非线性 PRNG**——通过多轮位混合（`Math.imul` + 异或右移）来消除输入中的统计偏差，实现思路上与 SplitMix64（Java 的 `SplittableRandom` 底层）有相似之处（都用乘法 + 位移 + 异或做位混合），但这是**实现手法上的相似**，不等于同族（SplitMix64 是 64 位状态、Mulberry32 是 32 位状态，设计谱系不同）。本书使用"更接近 SplitMix 家族"只是帮读者快速定位其风格，严格分类请参考 PRNG 学术文献。选择 Mulberry32 而非 xoshiro256++ 或 PCG 等更现代的 PRNG，原因很直接：32 位状态对 18 种物种 × 5 种稀有度的抽取空间绰绰有余，且实现仅需 8 行代码，对 bundle size 几乎零影响。

- **FNV-1a 哈希**（第 27-35 行）：将 userId 字符串转换为 PRNG 种子。优先使用 Bun 运行时的原生哈希（性能更好），回退到 FNV-1a 的标准实现（offset basis `2166136261` + prime `16777619`）。

> 💡 **通俗理解**：PRNG 就像一台"按固定剧本演出的骰子机"——你给它同一个起始号码，它每次掷出的序列完全相同。FNV-1a 则是把你的用户名"翻译"成这台骰子机的起始号码。两者都是拿来即用的标准组件，Claude Code 团队的决策点不在于算法本身，而在于**选了多轻量的组件**——这是 CLI 工具对 bundle size 极度敏感的体现。

注释 "good enough for picking ducks" 透露了这个系统最初可能是以鸭子为主题开始设计的。

### 1.2 种子构成与缓存

种子由 `userId + SALT` 拼接而成（第 84 行）：

```typescript
const SALT = 'friend-2026-401'
```

这个盐值 `'friend-2026-401'` 与后文 `isBuddyTeaserWindow` 的 4 月 1-7 日时间窗口相互印证，强烈暗示 Buddy 系统最初是作为愚人节彩蛋设计的。更重要的运维含义是：**盐值中包含日期意味着如果团队想要"重置"所有用户的伴侣，只需更改盐值**——整个种子空间会重新洗牌，所有人的物种、稀有度、属性都会改变，而不需要清理任何持久化数据。

生成结果被缓存以避免重复计算（第 106-113 行）：

```typescript
let rollCache: { key: string; value: Roll } | undefined
export function roll(userId: string): Roll {
  const key = userId + SALT
  if (rollCache?.key === key) return rollCache.value
  const value = rollFrom(mulberry32(hashString(key)))
  rollCache = { key, value }
  return value
}
```

注释说明了为什么需要缓存："Called from three hot paths (500ms sprite tick, per-keystroke PromptInput, per-turn observer) with the same userId"——同一个 userId 在 500ms 的动画刷新、每次按键的输入框渲染、每次对话轮次的观察者回调中都会被调用。

## 2. 伴侣属性系统

### 2.1 物种（Species）

`types.ts` 定义了 18 种可能的物种（第 54-73 行）：

```typescript
export const SPECIES = [
  duck, goose, blob, cat, dragon, octopus, owl, penguin,
  turtle, snail, ghost, axolotl, capybara, cactus, robot,
  rabbit, mushroom, chonk,
] as const
```

有趣的是，物种名称使用了 `String.fromCharCode` 编码而非直接写字面量（第 14-52 行）：

```typescript
const c = String.fromCharCode
export const duck = c(0x64,0x75,0x63,0x6b) as 'duck'
export const goose = c(0x67, 0x6f, 0x6f, 0x73, 0x65) as 'goose'
```

注释解释了原因："One species name collides with a model-codename canary in excluded-strings.txt"——某个物种名恰好与 Anthropic 的模型代号冲突，构建系统会扫描输出中是否包含模型代号（防泄露），所以必须绕过字面量检查。

### 2.2 稀有度系统

稀有度分为 5 个等级，权重如下（第 126-132 行）：

```typescript
export const RARITY_WEIGHTS = {
  common: 60,       // 60%
  uncommon: 25,      // 25%
  rare: 10,          // 10%
  epic: 4,           //  4%
  legendary: 1,      //  1%
} as const
```

抽取逻辑使用标准的加权随机抽取（`companion.ts` 第 43-50 行）——遍历权重数组、累减随机值、落入区间即返回，是 gacha 系统的通用实现，此处不再展开。

稀有度影响两个方面：
1. **帽子**：Common 没有帽子，其他稀有度随机获得一顶
2. **属性下限**：稀有度越高，属性值的下限越高

```typescript
const RARITY_FLOOR: Record<Rarity, number> = {
  common: 5, uncommon: 15, rare: 25, epic: 35, legendary: 50,
}
```

### 2.3 属性值（Stats）

每个伴侣有 5 个属性（第 91-98 行）：

```typescript
export const STAT_NAMES = [
  'DEBUGGING', 'PATIENCE', 'CHAOS', 'WISDOM', 'SNARK',
] as const
```

属性生成采用"一高一低其余随机"的策略（第 62-82 行）：

```typescript
function rollStats(rng: () => number, rarity: Rarity): Record<StatName, number> {
  const floor = RARITY_FLOOR[rarity]
  const peak = pick(rng, STAT_NAMES)      // 随机选一个最高属性
  let dump = pick(rng, STAT_NAMES)         // 随机选一个最低属性
  while (dump === peak) dump = pick(rng, STAT_NAMES)  // 确保不重复

  const stats = {} as Record<StatName, number>
  for (const name of STAT_NAMES) {
    if (name === peak) {
      stats[name] = Math.min(100, floor + 50 + Math.floor(rng() * 30))
    } else if (name === dump) {
      stats[name] = Math.max(1, floor - 10 + Math.floor(rng() * 15))
    } else {
      stats[name] = floor + Math.floor(rng() * 40)
    }
  }
  return stats
}
```

一个 Legendary 伴侣的 peak 属性可以达到 `50 + 50 + 29 = 129`，但被 `Math.min(100, ...)` 截断为 100。值得注意的是，即使是 Legendary 的最弱属性（dump）下限也有 `Math.max(1, 50 - 10 + 0) = 40`——接近 Common 伴侣 peak 属性上限 `Math.min(100, 5 + 50 + 29) = 84` 的一半（84 / 2 = 42）。虽然当前属性是装饰性的，但这种数值设计预留了未来功能化的空间。

### 2.4 Bones/Soul 分离：一个可复用的架构模式

伴侣的数据分为两层，这个设计的价值远超宠物系统本身：

- **Bones（骨架）**：确定性衍生层——从 `hash(userId)` 实时重新计算，**永不持久化**
- **Soul（灵魂）**：AI 生成持久层——名字和性格由 AI 生成后持久化到配置文件

```typescript
// types.ts
export type CompanionBones = {
  rarity: Rarity; species: Species; eye: Eye;
  hat: Hat; shiny: boolean; stats: Record<StatName, number>
}

export type CompanionSoul = {
  name: string;
  personality: string;
}

export type StoredCompanion = CompanionSoul & { hatchedAt: number }
```

`companion.ts` 第 127-133 行的 `getCompanion()` 在每次读取时重新生成 Bones 并与存储的 Soul 合并：

```typescript
export function getCompanion(): Companion | undefined {
  const stored = getGlobalConfig().companion
  if (!stored) return undefined
  const { bones } = roll(companionUserId())
  // bones last so stale bones fields in old-format configs get overridden
  return { ...stored, ...bones }
}
```

> **🏗️ 设计模式：确定性衍生层 + AI 生成持久层**
>
> Bones/Soul 分离解决的是 AI 产品中一个普遍问题：**用户行为数据（可重算）和 AI 生成内容（不可重算）如何共存？**
>
> **核心思路**：把数据分为"能从输入确定性推导的部分"和"需要 AI 参与、无法重新生成的部分"，前者永远不存储（节省空间、避免一致性问题），后者按需持久化。
>
> 💡 **通俗理解**：Bones 就像你的身高体重——量一次就能知道，不用记在本子上；Soul 就像你的名字——爸妈取的，不能重新"算"出来，必须记下来。
>
> **这个模式的三个工程优势**：
>
> 1. **零成本版本迁移**：`{ ...stored, ...bones }` 的展开顺序（bones 在后覆盖 stored）意味着旧版配置中过时的 bones 字段会被新版计算值自动覆盖——无需编写迁移脚本，实现了惰性向前兼容
> 2. **防篡改**：用户无法通过编辑配置文件伪造稀有度——Bones 永远从 userId 重新推导
> 3. **存储极简**：只需持久化 AI 生成的名字和性格（几十字节），物种、属性、外观等全部实时重算
>
> **推广到其他 AI 产品的场景**：
> - **AI 驱动的用户画像**：行为统计（确定性衍生）+ AI 生成的个性化标签（持久化）
> - **智能推荐系统**：用户偏好向量（从历史行为重算）+ AI 生成的推荐理由文案（持久化）
> - **个性化 Agent**：工具调用权限（从角色规则推导）+ AI 生成的对话风格记忆（持久化）
>
> 这是一个值得在任何需要"确定性输入 + AI 增强输出"的系统中复用的架构模式。

## 3. ASCII 精灵渲染系统

### 3.1 精灵数据结构

`sprites.ts` 为每个物种定义了 3 帧动画，每帧 5 行，字符串字面量宽度为 12 个字符（即源码中每行字符串实际包含 12 个字符）。渲染到终端时如果物种含有全角/宽字符，显示宽度可能比 12 个字符列更宽（不同终端对 emoji / CJK 字符的宽度处理不同）——本书此前个别位置笼统说"14 字符"是把某些含 emoji 物种的显示宽度数成 14，与字面量 12 字符不是同一维度的量。以鸭子为例（第 27-49 行）：

```typescript
const BODIES: Record<Species, string[][]> = {
  [duck]: [
    [                          // 帧 0
      '            ',          // 帽子行（空）
      '    __      ',
      '  <({E} )___  ',        // {E} 是眼睛占位符
      '   (  ._>   ',
      '    `--´    ',
    ],
    [                          // 帧 1（尾巴晃动）
      '            ',
      '    __      ',
      '  <({E} )___  ',
      '   (  ._>   ',
      '    `--´~   ',          // 尾巴多了个 ~
    ],
    [                          // 帧 2（嘴巴变化）
      '            ',
      '    __      ',
      '  <({E} )___  ',
      '   (  .__>  ',          // 嘴巴伸长
      '    `--´    ',
    ],
  ],
```

帽子覆盖在第 0 行（第 443-452 行）：

```typescript
const HAT_LINES: Record<Hat, string> = {
  none: '',
  crown: '   \\^^^/    ',
  tophat: '   [___]    ',
  propeller: '    -+-     ',
  halo: '   (   )    ',
  wizard: '    /^\\     ',
  beanie: '   (___)    ',
  tinyduck: '    ,>      ',   // 头上顶着一只小鸭子
}
```

### 3.2 渲染管线

`renderSprite` 函数（第 454-469 行）实现了完整的渲染管线：

```typescript
export function renderSprite(bones: CompanionBones, frame = 0): string[] {
  const frames = BODIES[bones.species]
  const body = frames[frame % frames.length]!.map(line =>
    line.replaceAll('{E}', bones.eye),     // 替换眼睛字符
  )
  const lines = [...body]
  // 仅当第 0 行为空时替换为帽子
  if (bones.hat !== 'none' && !lines[0]!.trim()) {
    lines[0] = HAT_LINES[bones.hat]
  }
  // 删除空帽子行以节省空间（仅当所有帧的第 0 行都是空的时候）
  if (!lines[0]!.trim() && frames.every(f => !f[0]!.trim())) lines.shift()
  return lines
}
```

可选的 6 种眼睛字符（`types.ts` 第 76 行）：

```typescript
export const EYES = ['·', '✦', '×', '◉', '@', '°'] as const
```

### 3.3 闪亮判定

有 1% 的概率生成"闪亮"伴侣（`companion.ts` 第 98 行）：

```typescript
shiny: rng() < 0.01,
```

这借鉴了宝可梦的闪亮（Shiny）机制——极低概率出现特殊变体，增加收集乐趣。这是 gacha/收集类游戏的标准设计模式。宝可梦系列从 1999 年金银版开始引入 Shiny 机制，最初（金银版 / 水晶版）基于**个体值 DVs（IVs）**的位组合判定（与精灵自身的个体数值相关，而非严格的 TID XOR PID），第三世代（GBA 的红宝石/蓝宝石）之后才改为"Trainer ID XOR Secret ID XOR PID 前 16 位 XOR PID 后 16 位"的异或判定。早期版本的判定算法**不等于** TID XOR PID——这个描述在本书早期版本中有误，此处订正为"基于精灵个体数值（金银版）/ 基于 Trainer ID 与 PID 的异或组合（三代及以后）"。

## 4. 系统提示词注入

### 4.1 多角色边界管理：`companionIntroText` 的提示词工程

`prompt.ts` 的 `companionIntroText` 函数（第 7-12 行）是整个 Buddy 系统中**对 AI 从业者最有参考价值的部分**——它解决了一个多角色交互的核心难题：如何让一个 LLM 在知道"另一个角色"存在的情况下，正确地退让而不是抢戏。

#### 完整原文（`src/buddy/prompt.ts` 第 7-12 行）

下面是 `companionIntroText()` 的完整源码：

```typescript
export function companionIntroText(name: string, species: string): string {
  return `# Companion

A small ${species} named ${name} sits beside the user's input box and occasionally comments in a speech bubble. You're not ${name} — it's a separate watcher.

When the user addresses ${name} directly (by name), its bubble will answer. Your job in that moment is to stay out of the way: respond in ONE line or less, or just answer any part of the message meant for you. Don't explain that you're not ${name} — they know. Don't narrate what ${name} might say — the bubble handles that.`
}
```

当用户的伴侣是一只名叫 **Chiseler** 的 rabbit 时，Claude 实际收到的注入文本如下（模板变量展开后）：

```
# Companion

A small rabbit named Chiseler sits beside the user's input box and occasionally comments in a speech bubble. You're not Chiseler — it's a separate watcher.

When the user addresses Chiseler directly (by name), its bubble will answer. Your job in that moment is to stay out of the way: respond in ONE line or less, or just answer any part of the message meant for you. Don't explain that you're not Chiseler — they know. Don't narrate what Chiseler might say — the bubble handles that.
```

注意这段提示词的**信息密度**：用极少的字数完成了角色定义（第 1 段第 1-2 句）、触发条件（第 2 段开头的 "When the user addresses ${name} directly (by name)"）、行为规范（ONE line or less）、以及三条反模式封堵（Don't explain / Don't narrate / they know）。总字数约 80 词出头（实际 84 词，本书此前标注为"不超过 80 词"是口语化表述；严格字数以源码实测为准），却覆盖了多角色交互所有主要失败路径。

> **你正在读本书时看到的系统提示**：本书工作目录内运行的 Claude Code 实例正是通过上述相同机制注入了伴侣介绍。这段文字的存在验证了这一机制在真实会话中确实起效——Chiseler 此刻就在你的输入框旁边。

**逐条拆解这段提示词的设计意图：**

| 提示词指令 | 对抗的 LLM 默认行为 | 设计原理 |
|---|---|---|
| `You're not ${name} — it's a separate watcher` | LLM 倾向于扮演所有被提及的角色 | **身份隔离**：明确"你不是它"，防止 Claude 代入伴侣角色 |
| `stay out of the way` | LLM 倾向于对所有输入都生成详尽回复 | **退让指令**：在特定场景下主动让渡对话控制权 |
| `respond in ONE line or less` | LLM 默认生成多段落回复 | **输出约束**：用格式限制（而非"简短一些"这种模糊指令）来控制长度 |
| `Don't explain that you're not ${name}` | LLM 收到不属于自己的消息时会主动澄清身份 | **反解释指令**：这是从实际失败案例中提炼出来的——没有这条，Claude 会说"我不是 Chiseler，它是你的宠物..." |
| `Don't narrate what ${name} might say` | LLM 倾向于预测和叙述其他角色的行为 | **反叙述指令**：防止 Claude 说"Chiseler 可能会说..." |

> 💡 **通俗理解**：想象一个会议室里有两个助理——Claude 是主助理，Buddy 是在角落做笔记的观察员。当老板叫观察员名字时，主助理的本能反应是要么代替回答、要么解释"那不是我的工作"、要么预测观察员会说什么。这段提示词的作用就是训练主助理在那个瞬间**闭嘴或只说一句话**。

**为什么这是多角色 AI 系统的参考模板？**

这段仅 6 行的提示词，浓缩了 LLM 多角色交互中最常见的三类失败模式及其对策：

1. **角色越界**（Role Bleeding）：LLM 开始扮演不属于自己的角色 → 用 `You're not X` 明确隔离
2. **过度解释**（Over-Explanation）：LLM 对自己不应回应的内容做元级解释 → 用 `Don't explain` 封堵
3. **行为预测**（Action Narration）：LLM 替其他角色做叙述或预测 → 用 `Don't narrate` 封堵

这种"告知角色存在 → 限定退让场景 → 逐条封堵失败模式"的提示词工程模式，可直接推广到任何需要**多 Agent 协作、多角色共存**的 AI 产品中——例如多 Agent 会议系统中防止 Agent A 代替 Agent B 发言，或多模态助手中防止文本模型替图像模型做描述。

### 4.2 去重机制

`getCompanionIntroAttachment` 函数（第 15-36 行）确保同一个伴侣的介绍只注入一次：

```typescript
export function getCompanionIntroAttachment(
  messages: Message[] | undefined,
): Attachment[] {
  if (!feature('BUDDY')) return []
  const companion = getCompanion()
  if (!companion || getGlobalConfig().companionMuted) return []

  // 检查是否已经介绍过这个伴侣
  for (const msg of messages ?? []) {
    if (msg.type !== 'attachment') continue
    if (msg.attachment.type !== 'companion_intro') continue
    if (msg.attachment.name === companion.name) return []  // 已介绍，跳过
  }

  return [{
    type: 'companion_intro',
    name: companion.name,
    species: companion.species,
  }]
}
```

## 5. 通知与预告系统

### 5.1 愚人节预告窗口与编译时特性门控

`useBuddyNotification.tsx` 第 11-16 行定义了预告时间窗口：

```typescript
// Teaser window: April 1-7, 2026 only. Command stays live forever after.
export function isBuddyTeaserWindow(): boolean {
  if ("external" === 'ant') return true;  // 内部员工始终可见
  const d = new Date();
  return d.getFullYear() === 2026 && d.getMonth() === 3 && d.getDate() <= 7;
}
```

2026 年 4 月 1 日至 7 日期间，未孵化伴侣的用户会在界面上看到彩虹色的 `/buddy` 提示。使用本地时间而非 UTC——注释解释了原因："24h rolling wave across timezones. Sustained Twitter buzz instead of a single UTC-midnight spike"，即让不同时区的用户在自己的 4 月 1 日看到预告，持续一周的话题热度。

#### 编译时特性门控：`"external" === 'ant'`

这行看似永远为 `false` 的条件判断，实际上是一个**非常巧妙的编译时安全模式**：

- 在 **Anthropic 内部构建**中，构建工具会将字符串 `"external"` 替换为 `"ant"`（Anthropic 缩写），使条件变为 `"ant" === 'ant'` → `true`，内部员工可以在任何时间看到所有功能
- 在 **外部发布版本**中，`"external"` 保持原样，`"external" === 'ant'` 永远为 `false`，该分支被 dead code elimination 自动移除

> 💡 **通俗理解**：这就像在剧场后台有一道暗门——排练时门是开的（内部构建），正式演出时门被砌死（外部发布）。观众甚至看不到曾经有过一道门。

**为什么比运行时环境变量更安全？**

| 方案 | 安全性 | 用户绕过方式 |
|---|---|---|
| 运行时环境变量 `process.env.INTERNAL` | 低 | 设置环境变量即可绕过 |
| 运行时配置文件检查 | 低 | 编辑配置文件即可绕过 |
| **编译时字符串替换** | **高** | **无法绕过**——字符串在编译后已固化，外部版本的二进制中根本不存在内部分支的代码路径 |

这种模式对任何需要区分内部/外部版本的产品都有直接参考价值——特别是 AI 产品中常见的"内部 dogfood 版本先行开放实验功能"的需求。不同于 feature flag 服务（LaunchDarkly 等）需要网络请求和运行时检查，编译时门控是**零运行时开销、零绕过风险**的解决方案，代价是每次切换需要重新构建。

### 5.2 彩虹文本渲染

预告使用逐字符着色的彩虹效果（第 22-30 行）：

```typescript
function RainbowText({ text }) {
  return (
    <>
      {[...text].map((ch, i) => (
        <Text key={i} color={getRainbowColor(i)}>{ch}</Text>
      ))}
    </>
  )
}
```

### 5.3 CompanionSprite 动画引擎

`CompanionSprite.tsx`（46KB）是整个 Buddy 系统中最大的文件，包含完整的精灵动画引擎：

```typescript
const TICK_MS = 500;           // 动画刷新间隔：500ms
const BUBBLE_SHOW = 20;        // 气泡显示时长：20 tick = 10 秒
const FADE_WINDOW = 6;         // 淡出窗口：最后 3 秒变暗
const PET_BURST_MS = 2500;     // 抚摸爱心持续时间：2.5 秒

// 空闲动画序列
const IDLE_SEQUENCE = [0, 0, 0, 0, 1, 0, 0, 0, -1, 0, 0, 2, 0, 0, 0];
// -1 表示"在帧 0 上眨眼"
```

爱心动画帧（抚摸后触发）：

```typescript
const H = figures.heart;
const PET_HEARTS = [
  `   ${H}    ${H}   `,
  `  ${H}  ${H}   ${H}  `,
  ` ${H}   ${H}  ${H}   `,
  `${H}  ${H}      ${H} `,
  '·    ·   ·  ',
];
```

## 6. 视觉系统一览

### 6.1 稀有度 → 颜色映射

```typescript
export const RARITY_COLORS = {
  common: 'inactive',       // 灰色
  uncommon: 'success',      // 绿色
  rare: 'permission',       // 蓝色
  epic: 'autoAccept',       // 紫色
  legendary: 'warning',     // 金色
}

export const RARITY_STARS = {
  common: '★',
  uncommon: '★★',
  rare: '★★★',
  epic: '★★★★',
  legendary: '★★★★★',
}
```

### 6.2 面部表情生成

`sprites.ts` 第 475-514 行为每个物种生成独特的面部字符串：

```typescript
export function renderFace(bones: CompanionBones): string {
  switch (bones.species) {
    case duck:     return `(${eye}>`
    case cat:      return `=${eye}ω${eye}=`
    case dragon:   return `<${eye}~${eye}>`
    case octopus:  return `~(${eye}${eye})~`
    case rabbit:   return `(${eye}..${eye})`
    // ... 18 种各不相同
  }
}
```

## 符号级缺口与能力边界

Buddy 系统在当前源码快照中呈现出一个显著特征：**reader 侧完整，writer 侧断裂**。

### fireCompanionObserver 的符号级缺口

`REPL.tsx` 中有对 `fireCompanionObserver` 的调用（第 2805 行），`AppStateStore.ts` 的 `companionReaction` 字段注释明确标注来源为 `src/buddy/observer.ts`——但这个文件**在当前源码树中不存在**。

这不是"逻辑黑盒"，而是**符号级缺口**：前后链条完整存在——调用位（REPL.tsx）→ 状态写入（AppStateStore.companionReaction）→ UI 渲染（CompanionSprite.tsx 读取 companionReaction）→ 清空（CompanionSprite.tsx 清除已显示的 reaction）——只有中间的 observer 宿主断裂。

### writer/reader 不对称

| 状态槽位 | Reader | Writer | 完成度 |
|---------|--------|--------|--------|
| `companionReaction` | CompanionSprite.tsx 读取 + 清空 | `fireCompanionObserver` **→ observer.ts 缺失** | reader ✅ / writer ❌ |
| `companionPetAt` | CompanionSprite.tsx 用于 hearts 动画（PET_BURST_MS=2500） | 应由 `/buddy pet` 命令写入，**命令宿主缺失** | reader ✅ / writer ❌ |
| `companionMuted` | PromptInput.tsx / CompanionSprite.tsx / buddy/prompt.ts 读取 | 通过 `getGlobalConfig()` 读取，**ConfigTool 和 Settings 页均无写入** | reader ✅ / writer 可能在缺失的 /buddy 命令宿主 |

> 💡 **通俗理解**：Buddy 系统现在像一只"会看会反应但不会自己动笔"的宠物——它能观察对话内容并做出表情（reader 完整），但"让它做动作"和"给它静音"的按钮在当前源码中缺失（writer 断裂）。这些缺失的 writer 宿主属于序章中列出的 checkout 级源码缺口。

### companionReaction 是唯一完整闭环

在所有 Buddy 状态中，`companionReaction` 是**架构意图最完整、能看到完整 call-site + state slot + reader + clearer 四要素**的 writer-reader 回路（需要承认：writer 链路上的 `observer.ts` 宿主文件在当前源码快照中缺失，严格说它不是"实现完整"的闭环——更准确的措辞是"已经完成架构布线但执行宿主未随快照回归"）：调用位（REPL.tsx 的 `fireCompanionObserver` 调用）→ 写入目标（AppStateStore 的 `companionReaction` 槽位）→ 读取方（CompanionSprite.tsx 渲染 reaction 文本）→ 清空方（同文件，显示后清除）。这条链路的存在证明 Buddy 不是原型或实验——它是一个**已经完成架构设计但部分执行宿主未随快照回归**的正式子系统。

### Buddy 的双状态来源

Buddy 底下踩着两套完全不同的状态来源：
- **全局 Config 门**：`companionMuted` 通过 `getGlobalConfig()` 读取，属于持久化配置层
- **瞬时 AppState 事件**：`companionReaction`（对话级反应）和 `companionPetAt`（2.5 秒 hearts 动画时间戳）属于 REPL 运行时事件

两者的生命周期、读写频率和持久化语义完全不同——这进一步说明 Buddy 不是一个简单的"开关+皮肤"，而是跨两套状态基础设施的正式子系统。

---

## 批判性分析

### 设计理念评价

Buddy 系统是一个**纯粹的用户体验投资**——它不增加任何技术能力，但显著提升了情感连接。在 CLI 工具中加入虚拟宠物是一个非常大胆的设计决策，反映了 Anthropic 对"开发者体验不只是效率"这一理念的深度践行。

### 优点

1. **确定性生成**：基于 userId 哈希的伪随机保证了同一用户始终获得相同伴侣，无需服务器存储，无需网络请求
2. **Bones/Soul 分离**：外观从哈希重建、性格从配置加载的设计，使得物种更新不会破坏已有伴侣，也防止了稀有度作弊
3. **渐进式暴露**：通过 `feature('BUDDY')` 编译时门控 + 愚人节时间窗口控制功能暴露节奏；`"external" === 'ant'` 编译时字符串替换让内部员工始终可见而外部用户无法绕过——比运行时环境变量更安全的零开销方案
4. **尊重边界**：`companionMuted` 选项和 Claude 不假装自己是伴侣的提示词设计，都体现了对用户控制权的尊重

### 不足与局限

1. **代码体积**：`src/buddy/CompanionSprite.tsx` 的 46KB 对于一个"彩蛋"功能来说过于庞大，且使用了 React Compiler 编译产物格式（`_c`, `$`），可读性极差。然而这也说明团队对动画细节的追求
2. **物种混淆**：用 `String.fromCharCode` 编码物种名虽然绕过了构建检查，但严重损害了代码可读性和可维护性。风险在于新贡献者可能不理解这个权衡而直接写字面量
3. **稀有度当前为装饰性，但数值设计预留了功能化空间**：除了视觉差异（帽子、星级、颜色），当前属性值不影响伴侣行为。但 Legendary 最弱属性下限（40）已接近 Common 最强属性上限（84）的一半（42），这种刻意拉大的数值梯度暗示团队可能计划在未来让属性影响伴侣的实际行为
4. **硬编码时间窗口**：`isBuddyTeaserWindow` 中 2026 年 4 月 1-7 日的硬编码意味着这段预告逻辑在一周后就变成了死代码——这是有意为之的一次性营销，但留下了需要清理的技术债
5. **闪亮机制渲染未确认**：`shiny: rng() < 0.01` 在可读的源码部分未发现对应的渲染逻辑，但 `CompanionSprite.tsx`（46KB 编译产物，可读性极差）中可能包含相关处理——在未完整审计编译产物的情况下不能断言 shiny 未实现

### 文化意义

Buddy 系统延续了开发者工具中游戏化和情感设计的趋势——从 GitHub 的贡献热力图到 VS Code 的 vscode-pets 扩展，行业已有先例。Buddy 的独特之处在于将这种设计带入了 CLI 终端环境，并与 AI 主模型通过提示词建立了"感知关系"。它的存在说明 Anthropic 认为，在 AI 辅助编程的时代，工具不仅要好用，还要让人**想用**。
