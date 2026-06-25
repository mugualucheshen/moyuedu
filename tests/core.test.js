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
  if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) return 'utf-8';
  if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) return 'utf-16le';
  if (buf.length >= 2 && buf[0] === 0xFE && buf[1] === 0xFF) return 'utf-16be';
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
  // UTF-8 BOM
  const utf8BOM = new Uint8Array([0xEF, 0xBB, 0xBF, 0xE4, 0xB8, 0xAD]);
  expect('T5.1 UTF-8 BOM 识别', detectCharset(utf8BOM), 'utf-8');
  // UTF-16 LE BOM
  const utf16le = new Uint8Array([0xFF, 0xFE, 0x2D, 0x4E]);
  expect('T5.2 UTF-16LE 识别', detectCharset(utf16le), 'utf-16le');
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

console.log('\n==========');
const pass = tests.filter(t => t.pass).length;
console.log(`通过: ${pass}/${tests.length}`);
process.exit(pass === tests.length ? 0 : 1);
