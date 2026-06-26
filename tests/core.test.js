// 端到端逻辑测试 - 不依赖浏览器，提取核心函数到独立可测模块
// 直接在 Node 里跑核心函数

// ==== 模拟浏览器全局 ====
const localStorage_data = {};
const indexedDB_stores = { books: new Map(), audio: new Map() };
global.localStorage = {
  getItem: (k) => localStorage_data[k] || null,
  setItem: (k, v) => { localStorage_data[k] = String(v); },
  removeItem: (k) => { delete localStorage_data[k]; },
};
global.indexedDB = { open: () => { throw new Error('skip - we test pure functions'); } };
global.window = { innerWidth: 393, innerHeight: 852 };
global.document = { documentElement: { setAttribute: () => {}, style: { setProperty: () => {} } } };

// ==== 把 index.html 里的核心函数提取出来运行 ====

// 1. 章节解析（v2：限制标题长度 ≤ 80 字符，防贪婪吞下一个）
function parseChapters(text, pattern) {
  let regex;
  try {
    regex = new RegExp('(^|\\n)\\s*' + pattern + '[^\\n]{0,80}', 'g');
  } catch (e) {
    regex = new RegExp('(^|\\n)\\s*第[一二三四五六七八九十百千万零〇\\d]+[章节回卷集部篇][^\\n]{0,80}', 'g');
  }
  const matches = [];
  let m;
  let searchFrom = 0;
  while ((m = regex.exec(text)) !== null) {
    const raw = m[0].replace(/^[\n\s]+/, '');
    const offset = text.indexOf(raw, searchFrom);
    if (offset >= 0) {
      matches.push({ title: raw.trim(), offset });
      searchFrom = offset + raw.length;
    }
    if (matches.length > 100000) break;
  }
  if (matches.length < 2) {
    const chunkSize = 3000;
    for (let i = 0; i < text.length; i += chunkSize) {
      matches.push({ title: `第 ${Math.floor(i/chunkSize) + 1} 段`, offset: i });
    }
  }
  return matches;
}

// 2. 句子切分
function wrapSentences(text) {
  return text.replace(
    /([^。！？.!?\n]+)([。！？.!?\n])/g,
    (m, s, p) => `<span class="sentence">${s}${p}</span>`
  );
}

// 3. base64 转换
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return Buffer.from(bytes).toString('base64');
}

function base64ToBlob(b64, mime = 'audio/mp3') {
  const bin = Buffer.from(b64, 'base64');
  return new Blob([bin], { type: mime });
}

// 4. 编码检测
function detectCharset(buf) {
  // 1) BOM 检测
  if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) return 'utf-8';
  if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) return 'utf-16le';
  if (buf.length >= 2 && buf[0] === 0xFE && buf[1] === 0xFF) return 'utf-16be';

  // 2) 无 BOM：用严格 UTF-8 试探 + CJK 比例判定
  // 旧启发式 nonAscii*2>ascii 对 UTF-8 中文误判（每汉字 3 字节让非 ASCII >> ASCII），
  // 导致无 BOM 的 UTF-8 文件被当成 GBK 解码 → 乱码。
  const sample = buf.subarray(0, Math.min(buf.length, 65536));
  let utf8Text = null;
  try {
    utf8Text = new TextDecoder('utf-8', { fatal: true }).decode(sample);
  } catch {
    try {
      new TextDecoder('gbk', { fatal: true }).decode(sample);
      return 'gbk';
    } catch {
      return 'utf-8';
    }
  }
  let cjk = 0, total = 0;
  for (const ch of utf8Text) {
    const cp = ch.codePointAt(0);
    if (cp >= 0x4E00 && cp <= 0x9FFF) cjk++;
    total++;
  }
  if (total > 0 && cjk / total > 0.3) return 'utf-8';
  let ascii = 0;
  for (let i = 0; i < sample.length; i++) {
    if (sample[i] < 0x80) ascii++;
  }
  const nonAsciiRatio = 1 - ascii / sample.length;
  if (nonAsciiRatio > 0.3) return 'gbk';
  return 'utf-8';
}

// ==== 测试用例 ====
const tests = [];
const expect = (name, actual, expected) => {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  tests.push({ name, pass, actual, expected });
  console.log((pass ? '✅' : '❌') + ` ${name}`);
  if (!pass) console.log(`  期望: ${JSON.stringify(expected)}\n  实际: ${JSON.stringify(actual)}`);
};

// T1: 章节解析 - 常规"第X章"
{
  const text = '序章 缘起\n从前有座山...。\n\n第一章 出山\n主角走出山门。\n\n第二章 江湖\n他来到集市。\n\n第三章 归来\n回到故乡。\n';
  const chs = parseChapters(text, '第[一二三四五六七八九十百千万零〇\\d]+[章节回卷集部篇]');
  expect('T1.1 解析出 3 章', chs.length, 3);
  expect('T1.2 第一个是 第一章', chs[0].title, '第一章 出山');
  expect('T1.3 第二个 offset 正确', chs[1].offset > chs[0].offset, true);
}

// T2: 章节解析 - 没章节时回退分段
{
  const text = 'a'.repeat(10000);
  const chs = parseChapters(text, '第[一二三四五六七八九十百千万零〇\\d]+[章节回卷集部篇]');
  expect('T2.1 无章节时分段', chs.length >= 3, true);
}

// T3: 句子切分
{
  const text = '今天天气很好。明天可能下雨！后天呢？\n第四天晴天。';
  const html = wrapSentences(text);
  expect('T3.1 句数正确', (html.match(/class="sentence"/g) || []).length, 4);
}

// T4: base64
{
  const data = new Uint8Array([0, 1, 2, 3, 255, 254, 253]);
  const b64 = arrayBufferToBase64(data);
  const back = Buffer.from(b64, 'base64');
  expect('T4.1 base64 往返', Array.from(back), Array.from(data));
}

// T5: 编码检测
{
  const utf8BOM = new Uint8Array([0xEF, 0xBB, 0xBF, 0xE4, 0xB8, 0xAD]);
  expect('T5.1 UTF-8 BOM 识别', detectCharset(utf8BOM), 'utf-8');
  const utf16le = new Uint8Array([0xFF, 0xFE, 0x2D, 0x4E]);
  expect('T5.2 UTF-16LE 识别', detectCharset(utf16le), 'utf-16le');
  const utf16be = new Uint8Array([0xFE, 0xFF, 0x4E, 0x2D]);
  expect('T5.3 UTF-16BE 识别', detectCharset(utf16be), 'utf-16be');

  // UTF-8 无 BOM：中文（之前会被误判为 GBK 的核心场景）
  const utf8NoBOM = new Uint8Array(Buffer.from('第一章 出山\n\n主角走出山门，踏上江湖。\n', 'utf-8'));
  expect('T5.4 UTF-8 无 BOM 中文', detectCharset(utf8NoBOM), 'utf-8');
  // 验证解码后是中文（不是乱码）
  const utf8Decoded = new TextDecoder('utf-8').decode(utf8NoBOM);
  expect('T5.5 UTF-8 无 BOM 解码正确', utf8Decoded.includes('第一章') && utf8Decoded.includes('江湖'), true);

  // GBK 无 BOM：中文（"你好世界" 的 GBK 字节是 C4 E3 BA C3 CA C0 BD E7）
  const gbkNoBOM = new Uint8Array([0xC4, 0xE3, 0xBA, 0xC3, 0xCA, 0xC0, 0xBD, 0xE7]);
  expect('T5.6 GBK 无 BOM 识别', detectCharset(gbkNoBOM), 'gbk');
  // 验证 GBK 解码后是中文
  const gbkDecoded = new TextDecoder('gbk').decode(gbkNoBOM);
  expect('T5.7 GBK 解码正确', gbkDecoded, '你好世界');

  // GBK 长文本（防短文本启发式不稳定）。手写 GBK 字节避免依赖 iconv：
  //   "墨阅读 · 你的私人 TXT 书架\n\n第一章 出山\n主角走出山门，踏上江湖。\n"
  const gbkLong = new Uint8Array([
    0xC4, 0xA4, 0xD2, 0xC1, 0xCB, 0xC4,           // 墨阅读
    0xA1, 0xA7,                                  // ·
    0xC4, 0xE3, 0xBA, 0xC3,                       // 你好
    0xB5, 0xC4,                                  // 的
    0xCB, 0xBF, 0xC8, 0xCB,                       // 私人
    0x20,                                         // (空格)
    0x54, 0x58, 0x54,                             // TXT
    0x20,                                         // (空格)
    0xCA, 0xD5, 0xBC, 0xDB,                       // 书架
    0x0A, 0x0A,                                   // \n\n
    0xB5, 0xDA, 0xD2, 0xBB, 0xD6, 0xAE,           // 第一章
    0x20, 0xB3, 0xF6, 0xC9, 0xBD,                 //  出山
    0x0A,                                         // \n
    0xD6, 0xF7, 0xBD, 0xE7, 0xD7, 0xB3, 0xC9, 0xCF, // 主角走出山
    0xA3, 0xAC,                                  // ，
    0xCC, 0xE1, 0xC9, 0xCF,                       // 踏上
    0xBD, 0xAD, 0xBA, 0xFE,                       // 江湖
    0xA1, 0xA3,                                  // 。
    0x0A,                                         // \n
  ]);
  expect('T5.8 GBK 长文本识别', detectCharset(gbkLong), 'gbk');

  // 纯 ASCII
  const asciiBuf = new Uint8Array(Buffer.from('Hello, world! This is plain ASCII.', 'utf-8'));
  expect('T5.10 纯 ASCII 识别', detectCharset(asciiBuf), 'utf-8');

  // 端到端：模拟乱码文件 → 解码修复（之前会返回 'gbk'，现在正确返回 'utf-8'）
  // 这是用户报告的核心场景
  expect('T5.11 回归测试：UTF-8 中文不返回 gbk', detectCharset(utf8NoBOM) !== 'gbk', true);
}

// T6: 自定义章节规则 - 用"卷"识别
{
  const text = '卷一 起源\n...\n卷二 发展\n...\n卷三 高潮\n';
  // 用户可写: 卷[一二三四五六七八九十]+  (不含"第")
  const chs = parseChapters(text, '卷[一二三四五六七八九十百千万零〇\\d]+');
  expect('T6.1 卷识别', chs.length, 3);
  expect('T6.2 第一卷标题', chs[0]?.title, '卷一 起源');
}

// T7: 异常章节规则
{
  const text = '随便什么文本';
  try {
    const chs = parseChapters(text, '[unclosed');
    // 应该走默认 fallback，不会崩
    expect('T7.1 坏正则不崩', chs.length >= 1, true);
  } catch (e) {
    console.log('❌ T7 异常章节规则崩了:', e.message);
  }
}

// T8: 大量章节性能
{
  const t0 = Date.now();
  const text = '前导内容\n'.repeat(1000) +
    Array.from({length: 500}, (_, i) => `第${i+1}章 内容`).join('\n');
  const chs = parseChapters(text, '第[一二三四五六七八九十百千万零〇\\d]+章');
  const dt = Date.now() - t0;
  expect('T8.1 500 章节 < 200ms', chs.length === 500 && dt < 200, true);
  console.log(`  实际耗时: ${dt}ms`);
}

// T9: HTML escape
{
  const esc = (s) => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  expect('T9.1 < 转义', esc('<script>'), '&lt;script&gt;');
  expect('T9.2 & 转义', esc('a & b'), 'a &amp; b');
}

// T10: 大文本分章内存不爆（真实场景：TXT 有 \n 分段）
{
  // 1000 章节，每章 10000 字 = ~10MB
  const big = Array.from({length: 1000}, (_, i) => `第${i+1}章 标题\n${'A'.repeat(10000)}\n`).join('');
  const t0 = Date.now();
  const chs = parseChapters(big, '第[一二三四五六七八九十百千万零〇\\d]+章');
  const dt = Date.now() - t0;
  expect('T10.1 10MB 分章 < 2s 且 1000 章', chs.length === 1000 && dt < 2000, true);
  console.log(`  实际耗时: ${dt}ms, 文本 ${(big.length/1e6).toFixed(1)}MB, ${chs.length} 章`);
}

// ===== v1.1 合成与缓存系统：纯函数测试 =====

// djb2 hash
function djb2(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// 字符过滤（与 index.html 中 filterTtsText 逻辑一致）
function filterTtsText(text, filterChars) {
  if (!filterChars) return text;
  let out = '';
  for (const ch of text) if (!filterChars.includes(ch)) out += ch;
  return out;
}

// 段落组合并（与 index.html 中 buildSegment 逻辑一致）
// 输入 sentences 数组（[{textContent}]），startIdx, N, M
function buildSegment(sentences, startIdx, n, maxChars) {
  const items = [];
  let chars = 0;
  const end = Math.min(sentences.length, startIdx + n);
  for (let i = startIdx; i < end; i++) {
    const text = (sentences[i]?.textContent || '').trim();
    if (!text) continue;
    if (chars > 0 && chars + text.length > maxChars) break;
    items.push({ text, idx: i });
    chars += text.length;
  }
  if (items.length === 0) {
    for (let i = startIdx; i < sentences.length; i++) {
      const text = (sentences[i]?.textContent || '').trim();
      if (text) { items.push({ text, idx: i }); chars = text.length; break; }
    }
  }
  return { items, totalChars: chars, endIdx: items.length ? items[items.length - 1].idx + 1 : startIdx + 1 };
}

// T11: 段落组合并
{
  // 模拟 5 个句子，每个 60 字
  const sents = Array.from({length: 5}, (_, i) => ({
    textContent: '字'.repeat(60),
  }));
  // N=2, M=120 → 取 2 段共 120 字
  const a = buildSegment(sents, 0, 2, 120);
  expect('T11.1 正常合并 2 段 120 字', a.items.length, 2);
  expect('T11.2 totalChars=120', a.totalChars, 120);
  expect('T11.3 endIdx=2', a.endIdx, 2);

  // N=2 但只剩 1 段（不强凑）
  const b = buildSegment(sents, 4, 2, 120);
  expect('T11.4 末尾不强凑', b.items.length, 1);
  expect('T11.5 末尾 endIdx=5', b.endIdx, 5);

  // M 软上限：下一句会超 120 → 停止
  // 句子长 [80, 80, 80]，N=3, M=120 → 取 [80]，加下一个 80 超 → 只取 1 段
  const sents2 = [{textContent:'字'.repeat(80)}, {textContent:'字'.repeat(80)}, {textContent:'字'.repeat(80)}];
  const c = buildSegment(sents2, 0, 3, 120);
  expect('T11.6 字数软上限不切句子', c.items.length, 1);
  expect('T11.7 不切句子（80字）', c.totalChars, 80);

  // 空句跳过
  const sents3 = [{textContent:''}, {textContent:'有内容'}, {textContent:'',}, {textContent:'第二句'}];
  const d = buildSegment(sents3, 0, 4, 100);
  expect('T11.8 跳过空句', d.items.length, 2);

  // 兜底：startIdx 是空句，循环往后找首个非空
  const sents4 = [{textContent:''}, {textContent:''}, {textContent:'找到你了'}];
  const e = buildSegment(sents4, 0, 3, 100);
  expect('T11.9 跳过空句找到首个非空', e.items.length, 1);
  expect('T11.9b 拿到的是 idx=2 的句子', e.items[0]?.idx, 2);
}

// T12: 字符过滤
{
  expect('T12.1 默认 / []', filterTtsText('你好/世界 [测试]', '/ []'), '你好世界测试');
  expect('T12.2 空字符集=原样', filterTtsText('hello', ''), 'hello');
  expect('T12.3 null=原样', filterTtsText('hello', null), 'hello');
  expect('T12.4 中文场景', filterTtsText('第1章 / 楔子', '/ '), '第1章楔子');
  expect('T12.5 重复字符只删一次', filterTtsText('aaa', 'a'), '');
}

// T13: cacheKey hash（djb2 一致性 + 不同输入产出不同 hash）
{
  const a = djb2('text-a');
  const b = djb2('text-a');
  const c = djb2('text-b');
  expect('T13.1 同输入同 hash', a === b, true);
  expect('T13.2 异输入异 hash', a !== c, true);

  // 模拟 voiceConfig hash：ttsMode + presetVoice + speed
  const v1 = djb2(['preset', '冰糖', '', '', '', '1'].join('||'));
  const v2 = djb2(['preset', '磁性', '', '', '', '1'].join('||'));
  expect('T13.3 不同音色 hash 不同', v1 !== v2, true);

  const v3 = djb2(['preset', '冰糖', '', '', '', '1'].join('||'));
  expect('T13.4 同样配置 hash 一致', v1 === v3, true);
}

// T14: LRU 清理逻辑（mock 一个简化版的 IndexedDB）
{
  // 模拟 store: 数组，按 lastUsedAt 排序淘汰
  const store = new Map(); // key -> {size, lastUsedAt}
  function put(key, size) {
    store.set(key, { size, lastUsedAt: Date.now() + Math.random() });
  }
  function totalSize() {
    let s = 0; for (const v of store.values()) s += v.size; return s;
  }
  function prune(limitBytes) {
    let total = totalSize();
    if (total <= limitBytes) return 0;
    const sorted = [...store.entries()].sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt);
    let freed = 0;
    const need = total - limitBytes;
    let n = 0;
    for (const [k, v] of sorted) {
      if (freed >= need) break;
      store.delete(k);
      freed += v.size;
      n++;
    }
    return n;
  }

  // 写 5 个各 30MB，超 100MB 限制应清掉旧的
  put('a', 30 * 1024 * 1024);
  put('b', 30 * 1024 * 1024);
  put('c', 30 * 1024 * 1024);
  put('d', 30 * 1024 * 1024);
  put('e', 30 * 1024 * 1024);
  expect('T14.1 5个30MB=150MB', totalSize(), 150 * 1024 * 1024);
  // 现在手动设置 lastUsedAt 让 a < b < c < d < e
  const entries = [...store.entries()];
  entries.sort((x, y) => x[0].localeCompare(y[0])); // a,b,c,d,e
  entries.forEach(([k], i) => store.get(k).lastUsedAt = i);
  const pruned = prune(100 * 1024 * 1024); // 限制 100MB
  expect('T14.2 超限清理', pruned >= 1, true);
  expect('T14.3 清理后剩余 ≤ 100MB', totalSize() <= 100 * 1024 * 1024, true);
  expect('T14.4 最旧的被清', !store.has('a'), true);
  expect('T14.5 最新的 e 保留', store.has('e'), true);

  // 未超限不清理
  store.clear();
  put('x', 10 * 1024 * 1024);
  expect('T14.6 未超限不清理', prune(100 * 1024 * 1024), 0);
}

// T15: 软上限行为——一合并就超 M，允许不切
{
  // 句子长 200 字，N=1, M=120 → 取 1 段 200 字（不切）
  const sents = [{textContent:'字'.repeat(200)}];
  const seg = buildSegment(sents, 0, 1, 120);
  expect('T15.1 单段超字数不切', seg.items.length, 1);
  expect('T15.2 保留完整 200 字', seg.totalChars, 200);
}

// === v1.1.1 回归测试：prev/next 不再叠加音频 ===
// 复现老板报的 bug：点"下一句"后老 audio 没停，导致两句叠加
// 修复：stopTTS 彻底清理 + playEpoch 代次号 + 200ms 节流

// T16: stopTTS 彻底解绑 audio 回调
{
  const fakeAudio = {
    pause: () => { fakeAudio._paused = true; },
    onended: () => {},
    onerror: () => {},
    ontimeupdate: () => {},
    removeAttribute: () => {},
    load: () => {},
  };
  // 模拟修复后的 stopTTS 行为（提取为纯函数）
  function stopTTSClean(audio) {
    if (!audio) return;
    try { audio.pause(); } catch {}
    try { audio.onended = null; } catch {}
    try { audio.onerror = null; } catch {}
    try { audio.ontimeupdate = null; } catch {}
    try { audio.removeAttribute('src'); audio.load(); } catch {}
  }
  stopTTSClean(fakeAudio);
  expect('T16.1 旧 audio 已 pause', fakeAudio._paused, true);
  expect('T16.2 onended 已解绑', fakeAudio.onended, null);
  expect('T16.3 onerror 已解绑', fakeAudio.onerror, null);
  expect('T16.4 ontimeupdate 已解绑', fakeAudio.ontimeupdate, null);
}

// T17: playEpoch 代次号防旧链式触发
{
  let playEpoch = 0;
  function newPlay() { return ++playEpoch; }
  // 模拟：audioA 在 epoch=1 时启动，user 点 next 触发 newPlay（epoch=2），
  // audioA 播完时 onended 触发：epochAtPlay(1) !== tts.playEpoch(2) → return
  const epochAtPlay_A = newPlay();   // = 1
  const epochAtPlay_B = newPlay();   // = 2（用户点 next）
  let chainedA = false, chainedB = false;
  const onendedA = () => { if (epochAtPlay_A !== playEpoch) return; chainedA = true; };
  const onendedB = () => { if (epochAtPlay_B !== playEpoch) return; chainedB = true; };
  onendedA();  // A 播完 → 应该 return
  onendedB();  // B 播完 → 应该 true
  expect('T17.1 旧 onended 不链式', chainedA, false);
  expect('T17.2 新 onended 正常链式', chainedB, true);
}

// T18: 200ms 节流防双击
{
  let _navThrottle = 0;
  function navThrottleGuard() {
    const now = Date.now();
    if (now - _navThrottle < 200) return false;
    _navThrottle = now;
    return true;
  }
  expect('T18.1 第一次放行', navThrottleGuard(), true);
  expect('T18.2 1ms 后点被节流', navThrottleGuard(), false);
  expect('T18.3 50ms 后点被节流', navThrottleGuard(), false);
  // 模拟 201ms 后
  const origNow = Date.now;
  Date.now = () => origNow() + 201;
  expect('T18.4 201ms 后放行', navThrottleGuard(), true);
  Date.now = origNow;
}

// === v0.1.3 回归测试：epoch 单一来源，链式播放必须正常 ===
// 复现老板报：v0.1.2 修好"叠加"后新副作用 —— 播一段就停
// 根因：playSentence 入口既 stopTTS（+1）又自己 ++playEpoch（又+1）
//       导致 audio.onended 触发时 epochAtPlay 永远落后 1 步
// 修法：playSentence 只 stopTTS（不动 epoch），epochAtCall = tts.playEpoch（只读）

// T19: 模拟真实 playSentence 路径：连播 3 段，每段都该链式成功
{
  let playEpoch = 0;
  const tts = { audio: null, isPlaying: false, isLoading: false, playEpoch: 0 };
  const fakeAudioProto = {
    pause() {}, onended: null, onerror: null, ontimeupdate: null,
    removeAttribute() {}, load() {}, play() {},
  };
  const makeAudio = () => Object.create(fakeAudioProto);

  // 复刻修复后的 stopTTS
  function stopTTS() {
    if (tts.audio) {
      const a = tts.audio;
      try { a.pause(); } catch {}
      try { a.onended = null; } catch {}
      try { a.onerror = null; } catch {}
      try { a.ontimeupdate = null; } catch {}
      try { a.removeAttribute('src'); a.load(); } catch {}
      tts.audio = null;
    }
    tts.playEpoch = ++playEpoch;  // 单一来源 +1
  }

  // 复刻修复后的 playSentence 入口
  function playSentenceStart() {
    if (tts.audio) stopTTS();
    const epochAtCall = tts.playEpoch || 0;  // 只读不写
    const audio = makeAudio();
    tts.audio = audio;
    audio._epochAtPlay = epochAtCall;
    audio.onended = () => {
      if (audio._epochAtPlay !== tts.playEpoch) return 'STALE_EPOCH';
      if (tts.audio !== audio) return 'STALE_AUDIO';
      return 'CHAINED';
    };
    return audio;
  }

  // 段 1
  const a1 = playSentenceStart();
  // 段 1 播完
  const r1 = a1.onended();
  expect('T19.1 第 1 段播完应该链式', r1, 'CHAINED');

  // 段 2: 模拟链式自动播下一段
  const a2 = playSentenceStart();
  // 注意：a1 的 onended 在 stopTTS 里已经解绑了（onended=null）
  expect('T19.2 段 1 的 audio 在 stopTTS 时被解绑 onended', a1.onended, null);
  // a1 的 onended 已经解绑，再调一次应该 null
  expect('T19.3 段 1 onended 已 null（不会再链式）', a1.onended, null);
  // a2 自己的 onended
  expect('T19.4 段 2 应该是新的 audio 引用', tts.audio, a2);
  // 段 2 播完
  const r2 = a2.onended();
  expect('T19.5 第 2 段播完应该链式', r2, 'CHAINED');

  // 段 3
  const a3 = playSentenceStart();
  const r3 = a3.onended();
  expect('T19.6 第 3 段播完应该链式', r3, 'CHAINED');
}

// T20: 用户点 prev 打断当前段，旧 audio 不应再链式
{
  let playEpoch = 0;
  const tts = { audio: null, playEpoch: 0 };
  const fakeAudioProto = {
    pause() {}, onended: null, onerror: null, ontimeupdate: null,
    removeAttribute() {}, load() {},
  };
  const makeAudio = () => Object.create(fakeAudioProto);
  function stopTTS() {
    if (tts.audio) {
      const a = tts.audio;
      try { a.pause(); } catch {}
      try { a.onended = null; } catch {}
      try { a.removeAttribute('src'); a.load(); } catch {}
      tts.audio = null;
    }
    tts.playEpoch = ++playEpoch;
  }
  function playSentenceStart() {
    if (tts.audio) stopTTS();
    const epochAtCall = tts.playEpoch || 0;
    const audio = makeAudio();
    tts.audio = audio;
    audio._epochAtPlay = epochAtCall;
    audio.onended = () => {
      if (audio._epochAtPlay !== tts.playEpoch) return 'STALE_EPOCH';
      if (tts.audio !== audio) return 'STALE_AUDIO';
      return 'CHAINED';
    };
    return audio;
  }
  const a1 = playSentenceStart();
  // 用户点 prev：a1 的 onended 在 stopTTS 里被解绑
  const a2 = playSentenceStart();
  expect('T20.1 旧 audio.onended 已 null（prev 打断）', a1.onended, null);
  // 模拟 a1 的 onended 再次触发（不应该，但浏览器偶尔会延迟）
  // 因为 onended 已被解绑，所以调用 null → TypeError，浏览器已不触发
  expect('T20.2 新 audio 引用', tts.audio, a2);
}

// T21: 验证 v0.1.3 修复的核心 —— 正在播的 audio.onended 不应被解绑
// v0.1.2 坏代码：playSentence 入口 stopTTS + 自己 ++
//   后果：a1 创建后立即被 stopTTS 解绑 onended → a1 播完时无回调 → 不链式
// v0.1.3 修复：playSentence 入口 stopTTS + 只读 epochAtCall
//   但 stopTTS 只在 tts.audio != null 时触发
//   a1 创建后 tts.audio = a1，下次 playSentence 进来才 stopTTS
//   所以 a1 播放期间 onended 一直存在 → 播完时正常链式
{
  // 模拟 v0.1.3 修复后的真实流程
  let playEpoch = 0;
  const tts = { audio: null, playEpoch: 0 };
  const makeAudio = () => {
    const a = {
      pause() {}, removeAttribute() {}, load() {},
      _epochAtPlay: 0, onended: null, onerror: null, ontimeupdate: null,
    };
    return a;
  };

  // v0.1.3 stopTTS
  function stopTTS() {
    if (tts.audio) {
      const a = tts.audio;
      try { a.pause(); } catch {}
      try { a.onended = null; } catch {}
      try { a.onerror = null; } catch {}
      try { a.ontimeupdate = null; } catch {}
      try { a.removeAttribute('src'); a.load(); } catch {}
      tts.audio = null;
    }
    tts.playEpoch = ++playEpoch;
  }

  // v0.1.3 playSentence
  function playSentence() {
    if (tts.audio) stopTTS();
    // 只读
    const epochAtCall = tts.playEpoch || 0;
    const audio = makeAudio();
    audio._epochAtPlay = epochAtCall;
    tts.audio = audio;
    audio.onended = () => {
      if (audio._epochAtPlay !== tts.playEpoch) return 'STALE_EPOCH';
      if (tts.audio !== audio) return 'STALE_AUDIO';
      return 'CHAINED';
    };
    return audio;
  }

  // === 关键场景：a1 正在播放时，onended 必须存在 ===
  const a1 = playSentence();
  expect('T21.1 a1 创建后 onended 存在（v0.1.2 坏代码这里会 null）', typeof a1.onended, 'function');
  // 模拟 a1 播完，onended 触发
  const r1 = a1.onended();
  // 此时 tts.playEpoch 还是 a1 创建时的值 → 应该 CHAINED
  expect('T21.2 a1 播完应能链式', r1, 'CHAINED');
  // 链式调用 playSentence 启动 a2（这时 stopTTS 才解绑 a1.onended）
  const a2 = playSentence();
  expect('T21.3 链式后 a1.onended 被解绑', a1.onended, null);
  expect('T21.4 a2 是新 audio', tts.audio, a2);
  // a2 播放中 onended 必须存在
  expect('T21.5 a2 播放中 onended 存在', typeof a2.onended, 'function');
  // a2 播完
  const r2 = a2.onended();
  expect('T21.6 a2 播完应能链式', r2, 'CHAINED');
  // 链式 a3
  const a3 = playSentence();
  const r3 = a3.onended();
  expect('T21.7 a3 播完应能链式（连续 3 段）', r3, 'CHAINED');
}

// T22: 对照组 —— v0.1.2 坏代码，a1 播放中 onended 应是 null（bug）
{
  let playEpoch = 0;
  const tts = { audio: null, playEpoch: 0 };
  const makeAudio = () => ({
    pause() {}, onended: null,
    _epochAtPlay: 0,
  });

  // v0.1.2 坏代码
  function stopTTS_BUGGY() {
    if (tts.audio) { tts.audio.pause(); tts.audio.onended = null; tts.audio = null; }
    tts.playEpoch = ++playEpoch;
  }
  function playSentence_BUGGY() {
    if (tts.audio) stopTTS_BUGGY();
    // 坏代码：又 +1
    const epochAtCall = (tts.playEpoch || 0) + 1;
    tts.playEpoch = epochAtCall;
    const audio = makeAudio();
    audio._epochAtPlay = epochAtCall;
    tts.audio = audio;
    audio.onended = () => {
      if (audio._epochAtPlay !== tts.playEpoch) return 'STALE_EPOCH';
      return 'CHAINED';
    };
    return audio;
  }

  // 模拟老板描述的场景：
  // 第 1 次点播放
  const a1 = playSentence_BUGGY();
  // a1 创建时 tts.audio=null，跳过 stopTTS_BUGGY
  // (0||0)+1=1 → epochAtCall=1
  // 但真实的 v0.1.2 playSegment 还有一个隐藏检查：
  //   if (epochAtPlay !== tts.scheduler.chapterEpoch) return;
  // epochAtPlay 是 playEpoch（=1），chapterEpoch 是 0 → 1 !== 0 → return
  // 老板报"播一段就停"就是这个检查在搞鬼
  expect('T22.1 坏代码 a1 创建', typeof a1.onended, 'function');
  // 模拟 onended：epochAtPlay(1) !== tts.playEpoch(1) → false（不 return）
  // 但 epochAtPlay(1) !== tts.scheduler.chapterEpoch(0) → true → return
  // 加上 chapterEpoch 检查模拟真正的 v0.1.2
  const chapterEpoch = 0;
  let chained = true;
  const audio = a1;
  const epochAtPlay = audio._epochAtPlay;
  if (epochAtPlay !== tts.playEpoch) chained = false;
  if (epochAtPlay !== chapterEpoch) chained = false;
  if (tts.audio !== audio) chained = false;
  expect('T22.2 坏代码：chapterEpoch 检查拦截 → 播一段就停',
    chained, false);
  // 关键发现：v0.1.2 真正 bug 是 chapterEpoch 比对，不只是 playEpoch 双重 +1
  // v0.1.3 修复核心：playSentence 不再 ++playEpoch，且 playSegment 用 chapterEpoch（而不是 playEpoch）作 epochAtPlay
}

// T23: 章节切换（向前跳）必须让旧 audio 不再链式
{
  // 模拟 v0.1.3 修复后的 playSentence：章节切换时也 +1 playEpoch
  let playEpoch = 0;
  const tts = {
    audio: null, playEpoch: 0,
    scheduler: { chapterEpoch: 0, currentSegment: null, prefetchSet: new Set() },
  };
  const makeAudio = () => ({
    pause() {}, removeAttribute() {}, load() {},
    _epochAtPlay: 0, onended: null, onerror: null, ontimeupdate: null,
  });

  function stopTTS() {
    if (tts.audio) {
      const a = tts.audio;
      try { a.onended = null; } catch {}
      tts.audio = null;
    }
    tts.playEpoch = ++playEpoch;
  }
  function playSentence(idx) {
    if (tts.audio) stopTTS();
    // 章节内向前跳 → playEpoch 也 +1
    const curStart = tts.scheduler.currentSegment?.startIdx ?? -1;
    if (idx < curStart) {
      tts.scheduler.chapterEpoch++;
      tts.playEpoch = (tts.playEpoch || 0) + 1;
    }
    const epochAtCall = tts.playEpoch || 0;
    const audio = makeAudio();
    audio._epochAtPlay = epochAtCall;
    tts.audio = audio;
    audio.onended = () => {
      if (audio._epochAtPlay !== tts.playEpoch) return 'STALE_EPOCH';
      if (tts.audio !== audio) return 'STALE_AUDIO';
      return 'CHAINED';
    };
    return audio;
  }

  // 正常播 a1
  const a1 = playSentence(0);
  tts.scheduler.currentSegment = { items: [], startIdx: 0, endIdx: 5 };
  // 用户点 prev（idx=2 < curStart=0 不成立，idx=2 > curStart=0）
  // 实际"章节切换"通常是跳到下一章，curStart 在新章节里重新设
  // 模拟：用户切到下一章，curStart=100，idx=2 < 100
  tts.scheduler.currentSegment = { items: [], startIdx: 100, endIdx: 105 };
  const a2 = playSentence(2);
  // a1 创建时 stopTTS 不进 if（tts.audio=null），epoch=0
  // a2 创建时 stopTTS（a1 在）→ +1 → epoch=1
  // 然后 idx=2 < curStart=100 → +1 → epoch=2
  // 所以 tts.playEpoch 应该是 2，a1._epochAtPlay=0
  expect('T23.1 章节切换后 playEpoch 已 +2（stopTTS + 章节切换）',
    tts.playEpoch, 2);
  expect('T23.1b a1 自己的 epoch', a1._epochAtPlay, 0);
  // a1 还在内存中，它的 onended 触发时 epochAtPlay(=a1 创建时的 epoch) !== tts.playEpoch(新值)
  // 但实际播放时 a1.onended 在 stopTTS 里已经被解绑了
  expect('T23.2 a1.onended 已被 stopTTS 解绑', a1.onended, null);
  // 关键：a2 创建后，章节切换的效果通过 stopTTS 传递（a1.onended=null）
  // 然后 playEpoch +1，新 audio 的 epoch 跟上
  // a2.onended 触发时应该能正常链式
  const r2 = a2.onended();
  expect('T23.3 a2 章节切换后仍能链式', r2, 'CHAINED');
}

console.log('\n==========');
const pass = tests.filter(t => t.pass).length;
console.log(`通过: ${pass}/${tests.length}`);
process.exit(pass === tests.length ? 0 : 1);
