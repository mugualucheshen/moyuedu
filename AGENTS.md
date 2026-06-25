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
