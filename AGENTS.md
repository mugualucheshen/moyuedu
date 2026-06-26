# moyuedu · AGENTS.md

## 工作流规则（最高优先级）

每次接到需求，严格按三步走，**不许跳步**：

1. **复述理解** —— 把需求用自己的话讲一遍，列出所有歧义点
2. **等对方确认** —— 必须看到明确指令（"OK" / "改吧" / "按 A" / "继续" 等）才动手
3. **执行 + 复盘** —— 改完简短说明做了什么、怎么验证

### 红线

- 复述完直接说"我先动手"就改 = 严重违规
- 自作主张把"假设 X"当默认走 = 严重违规
- 任何带歧义的点（哪怕看起来很小）必须停手等回话

### 可以省略第 2 步直接动手的少数情况

- 对方贴了具体报错 / 行号 / 明确方案
- 对方明示"直接改" / "按这个改" / "继续"
- 纯机械性 follow-up（A 改完后对方说"顺便把同类项 B 也改了"，B 与 A 同质）

---

## 项目

墨阅读 · 单文件 HTML TXT 小说阅读器，iPhone Safari 适配。

### 文件

- `index.html` —— 主程序（HTML + CSS + JS，单文件）
- `tests/core.test.js` —— 单元测试
- `tests/demo.txt` —— 测试用 UTF-8 小说
- `审计报告.md` —— v1.0 审计

### 本地启动

```bash
cd /Users/longxia/Projects/moyuedu
python3 -m http.server 8765 --bind 127.0.0.1
```

访问 http://127.0.0.1:8765/index.html

### 测试

```bash
node tests/core.test.js    # 期望 23/23
```

### 关键代码位置

- `detectCharset` —— `index.html` ~1216 行
  - 识别顺序：BOM → 严格 UTF-8 解码 + CJK 比例判定（>30% → UTF-8）→ 非 ASCII 字节占比（>30% → GBK）
- 阅读器翻页点击区 —— `index.html` ~449-465（CSS）/ ~797-805（HTML）/ ~1924-1955（JS）
  - 上 22% `#tapTop` = 上一章
  - 下 22% `#tapBottom` = 下一章
  - 左 30% `#tapLeft` = 上一屏
  - 中 40% `#tapCenter` = 切换工具栏
  - 右 30% `#tapRight` = 下一屏
  - `.reader-content` 用 `touch-action: none` + `wheel` 事件拦截禁用手动滚动
- 上传入口 —— `index.html` ~1590 行附近
  - `uploadFile.arrayBuffer()` 必须包 `new Uint8Array(...)`，否则 `.subarray()` / `.length` 不可用

### v0.2.0 阅读器交互重构（2026-06-26 · feat/reader-free-scroll）

砍掉 3 个点击分区（`tapLeft` `tapCenter` `tapRight`），阅读器改为自然滚动 + 4 项新功能：

| 功能 | 实现位置 | 说明 |
|---|---|---|
| **进度条拖动** | `setupProgressDrag` ~2785 行 | pointerdown/move/up，拖动时暂停朗读滚动跟随 |
| **选区浮动按钮** | `setupSelectionFab` ~2830 行 | 选中文字上方出现"从此处朗读"按钮 |
| **句级高亮** | `.sentence.speaking` / `.past` CSS + `highlightSentence` ~2395 行 | 当前朗读句红色背景，之前的灰显 |
| **滚动跟随** | `maybeScrollToCurrentSentence` ~2402 行 | 快出视口（top<80 / bottom>vh-120）才滚，保守策略 |

**保留**：底部工具栏所有按钮（prev/play/next/mode）不动；进度条点击跳转保留作 fallback。

**键盘兼容**：选区 fab 在 iOS Safari 长按选中 + 桌面鼠标拖选都能触发。

**测试**：tests/core.test.js 新增 T30~T33 共 18 个测试，全部通过（120/120）。

### v0.2.1 工具栏呼出入口（2026-06-26 · feat/reader-free-scroll）

砍掉 3 个点击分区后，**工具栏没有入口呼出**了（之前 tapCenter 兼任）。补 3 个入口：

| 入口 | 实现位置 | 行为 |
|---|---|---|
| **顶部 12px 触发条** | `#readerTopGrip` ~2847 行 + CSS ~566 行 | 常驻透明条，点 / 下滑 30px → 呼出 |
| **滚到顶自动呼出** | scroll listener ~2841 行 | scrollTop=0 + 隐藏状态 → 自动显示（让用户换章）|
| **8 秒自动收** | `chromeHideTimer` ~1913 行 | 呼出后 8 秒不动 → 自动隐藏；点工具栏按钮重置计时 |

**已显示时往下滚** → 立即收（用户开始读就不打扰）。

**测试**：tests/core.test.js 新增 T34.1~T34.7 共 11 个测试，全部通过（131/131）。

### v0.2.2 刷新跳书架 bug 修复（2026-06-26 · feat/reader-free-scroll）

**症状**：正在阅读某本书时刷新浏览器 → 自动跳回书架页（不是回到阅读器）。

**根因**：当前页/当前书的状态在内存里，刷新后丢失；启动时默认进 `page-home`。

**修法**：URL hash 路由（深链接顺便支持）

| 行为 | 实现 |
|---|---|
| `openBook(id)` 写 hash | `location.hash = '#reader=' + encodeURIComponent(meta.id)` |
| `switchPage(library/settings)` 写 hash | `#library` / `#settings` |
| `switchPage(home)` 清 hash | `location.hash = ''` |
| 启动读 hash | `init()` 末尾调 `handleHashRoute()` |
| 浏览器前进/后退 | `window.addEventListener('hashchange', handleHashRoute)` |
| 找不到书兜底 | `state.books.find(b => b.id === bookId)` 失败 → 清 hash + 切 home |
| 特殊字符 bookId | `encodeURIComponent` / `decodeURIComponent` 双向处理 |

**测试**：tests/core.test.js 新增 T35.1~T35.5 共 16 个测试，全部通过（147/147）。
