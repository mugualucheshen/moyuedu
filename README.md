# 墨阅读 · 你的私人 TXT 书架

> 静心 · 阅世 · 听书
>
> 纯 HTML 单文件阅读器，iPhone Safari 完美适配，集成小米 MiMo TTS 三模式听书。

![GitHub stars](https://img.shields.io/github/stars/mugualucheshen/moyuedu)
![License](https://img.shields.io/badge/license-MIT-green)

## ✨ 功能

- 📚 **私人书架**：上传/管理/搜索/排序 TXT，全部存在本地浏览器
- 📖 **舒适阅读器**：4 主题（白天/夜间/护眼/羊皮卷）+ 字号/行距可调 + 自动断点续读
- 🎙️ **小米 MiMo TTS 三模式**：
  - ① **预置音色**（8 种精品音色 + 自定义风格标签）
  - ② **声音设计**（一句话定制专属声线）
  - ③ **声音克隆**（上传参考音频复刻任意人声）
- 📍 **位置记忆**：自动保存阅读进度，下次打开无缝续读
- 🔍 **智能章节识别**：默认正则 `第X章/回/卷/集/部/篇`，可自定义
- 🎨 **设计语言**：苹果极简 + 新中式书卷气，朱砂红/沉香褐/墨黑配色

## 🚀 快速开始

### 方式 A：直接打开（零部署）

1. 下载 `index.html`
2. iPhone 用 "文件" App 打开，或电脑双击
3. 首次进入配置小米 API Key（也可稍后配置，只用阅读功能）

### 方式 B：本地服务（推荐，支持 PWA）

```bash
# 电脑端
cd moyuedu
python -m http.server 8765

# iPhone Safari 访问
http://<电脑 IP>:8765/index.html

# iPhone Safari 底部分享 → "添加到主屏幕" → 像 App 一样用
```

## 📱 iPhone 适配

- ✅ viewport-fit=cover（适配刘海屏）
- ✅ env(safe-area-inset-*)（安全区域）
- ✅ PWA（添加到主屏幕像原生 App）
- ✅ 触控优化（毛玻璃、点击高亮关闭）
- ✅ MediaSession（锁屏控制播放）

## 🛠️ 技术栈

- **纯 HTML + CSS + JS**（无任何依赖）
- **localStorage**：设置 + API Key + 书架元数据
- **IndexedDB**：TXT 内容 + 克隆参考音频
- **小米 MiMo TTS API**：`https://api.xiaomimimo.com/v1/chat/completions`

## 🔐 隐私

**所有书、Key、设置都只存在你的浏览器本地**，不上传任何服务器。
只有在使用听书功能时，文本片段会发送到小米 MiMo TTS 接口合成语音。

## 📝 许可

MIT

---

🌟 如果觉得好用，给个 Star 呗~
