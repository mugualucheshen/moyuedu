# 墨阅读 · MEMORY.md

> 经验档案 / 踩坑日志（动态累积，面向过去）。
> 与 AGENTS.md 配对：AGENTS 写应该怎样，MEMORY 写曾经怎样。

---

## 2026-06-25 · 听书链式播放 epoch 双重 bug（v0.1.2 → v0.1.3）

### S - Situation
老板在 v0.1.1 基础上修了"prev/next 按钮音频叠加"（v0.1.2），但引入新副作用"播一段就停"。

### T - Task
v0.1.3 修复"播一段就停"，同时保留 v0.1.2 的"不叠加"修复。

### A - Action
写了 3 处修复 + 1 个 ad-hoc 验证脚本（用 fakeAudio 模拟整条 playSentence → playSegment → onended 链式路径）。

### R - Result
- tests/core.test.js: 81/81 通过
- ad-hoc: 5 段连播全链式 + 章节切换正常

### L - Lesson（最重要，下次不能再犯）

#### 1. **v0.1.2 我只修了"单点逻辑"，没看完整 onended 调用链**
- 看到了 `playEpoch 双重 +1` 的问题（v0.1.2 的 `playSentence` 入口既 stopTTS +1 又自己 ++playEpoch）
- **但漏了 v0.1.2 playSegment 里的隐藏 bug**：
  ```js
  audio.onended = () => {
    if (epochAtPlay !== tts.playEpoch) return;
    if (epochAtPlay !== tts.scheduler.chapterEpoch) return;  // ← 致命！
    if (tts.audio !== audio) return;
    tts.isPlaying = false;
    playSentence(nextStartIdx);
  };
  ```
  `epochAtPlay` 是用 `playEpoch` 的值（v0.1.2：`(epochAtCall != null) ? epochAtCall : tts.scheduler.chapterEpoch`），但比对时又去 check `chapterEpoch` → **永远不等 → 永远 return → 不链式 → 播一段就停**

#### 2. **chapterEpoch 和 playEpoch 是两个独立概念，不能混用**
- `chapterEpoch`：章节切换计数器（用户切章/向前跳时 +1）
- `playEpoch`：播放代次号（任何"停止旧 audio 启动新 audio"时 +1）
- 原本设计想用 `chapterEpoch` 检查章节切换，但实现里 epochAtPlay 用的是 playEpoch 值 → 逻辑错误

#### 3. **单点修复不充分时，必须 ad-hoc 模拟完整调用链**
- 单元测试只覆盖"函数级"逻辑（mock 重现），不一定覆盖"真实调用顺序"
- 真实 bug 在 onended 触发顺序里，**只有 ad-hoc 模拟整条 playSentence → playSegment → onended 链才能复现**
- v0.1.3 的 T22 测试就是这样发现的：模拟完整 onended 链 → chapterEpoch 比对失败 → 老板报的 bug 复现

#### 4. **修 v0.1.2 那个 bug 时违反了 moyuedu/AGENTS.md 第一条红线**
- moyuedu/AGENTS.md 说："复述理解 → 等对方确认 → 执行 + 复盘，不许跳步"
- v0.1.2 我直接列方案后改，没先复述"我现在的根因分析对吗"等老板确认
- **正确做法**：列 3 个根因猜测 + 老板拍板 → 再动
- **这次 v0.1.3 我先复述了，老板拍板了才动手，OK**

#### 5. **改完代码要立刻 ad-hoc 验证，不要只看静态扫描**
- v0.1.2 我跑了 8/9 静态扫描 + 15/15 动态行为（fake audio）
- 但 ad-hoc 用的是 `bumpEpoch()` 手动模拟，**没走真实 playSentence 流程**
- 所以漏掉了 chapterEpoch 比对这个真实 bug
- **正确做法**：ad-hoc 脚本里**完整复刻真实 playSentence 函数**，包括 stopTTS + epochAtCall + 创建 audio + onended

---

## 模板
每条 MEMORY 包含：日期 / 标题 / 5 段（STAR-L 框架）
