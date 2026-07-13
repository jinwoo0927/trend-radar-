// URL 등록 수집기: 사용자가 붙여넣은 영상 URL에서 API 키 없이 실지표를 수집한다.
// 실측으로 검증된 각 플랫폼의 공개 데이터 노출 범위:
// - 유튜브: oEmbed(제목·작성자) + 시청 페이지 파싱으로 조회수·좋아요·댓글·게시일 보강
// - 틱톡:  oEmbed(썸네일) + 영상 페이지 stats JSON에서 조회수·좋아요·댓글·공유·저장수·게시일 전부
// - 인스타: facebookexternalhit 봇 UA로 og:description 파싱 → 좋아요·댓글·작성자·게시일·캡션 (조회수·공유 미제공)
// - 스레드: 봇 UA로 og 파싱 → 작성자·본문·썸네일 (수치 지표는 공식 API 필요, 0 유지)
import { parseCount, enrichFromWatchPage } from './youtube-web.js';

// 일반 브라우저 UA (유튜브·틱톡용)
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
// Meta(인스타·스레드)는 이 봇 UA에만 og 메타데이터를 노출한다
const FB_UA = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';

const HEADERS = { 'User-Agent': CHROME_UA, 'Accept-Language': 'ko-KR,ko;q=0.9' };

async function fetchText(url, { ua = CHROME_UA, timeoutMs = 9000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': ua, 'Accept-Language': 'en-US,en;q=0.9,ko;q=0.8' },
      redirect: 'follow',
      signal: ctrl.signal,
    });
    return { ok: res.ok, status: res.status, url: res.url, text: await res.text() };
  } finally {
    clearTimeout(t);
  }
}

async function fetchJson(url, timeoutMs = 9000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: HEADERS, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

// HTML의 og:/description/title 메타 태그를 속성 순서 무관하게 추출
function ogMeta(html) {
  const out = {};
  const re = /<meta[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const prop = (m[0].match(/(?:property|name)=["']([^"']+)["']/i) || [])[1];
    const content = (m[0].match(/content=["']([^"']*)["']/i) || [])[1];
    if (prop && content && /^(og:|twitter:|description)/i.test(prop)) out[prop] = decodeEntities(content);
  }
  return out;
}

// og 콘텐츠의 수치·기호 HTML 엔티티 복원 (&#064; → @, &#x2022; → •, &quot; → " 등)
function decodeEntities(s) {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

// 제목·캡션에서 해시태그 추출 (중복 제거)
function extractHashtags(text) {
  const tags = [...String(text || '').matchAll(/#([\w가-힣]+)/g)].map(m => m[1]);
  return [...new Set(tags)].slice(0, 10);
}

function base(platform, id, url) {
  return {
    id, platform, url,
    title: '', channel: '', description: '', hashtags: [],
    publishedAt: '', thumbnail: '',
    views: 0, likes: 0, comments: 0, shares: 0,
    source: 'registered',
  };
}

// ── 유튜브 ──────────────────────────────────────────────
async function registerYoutube(url) {
  const m = url.match(/(?:v=|youtu\.be\/|\/shorts\/|\/embed\/)([\w-]{11})/);
  if (!m) throw new Error('유튜브 영상 ID를 찾을 수 없음');
  const id = m[1];
  const v = base('youtube', id, `https://www.youtube.com/watch?v=${id}`);
  v.thumbnail = `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
  try {
    const o = await fetchJson(`https://www.youtube.com/oembed?url=${encodeURIComponent(v.url)}&format=json`);
    v.title = o.title || '';
    v.channel = o.author_name || '';
  } catch { /* oEmbed 실패해도 계속 */ }
  await enrichFromWatchPage(v); // 조회수·좋아요·댓글·게시일 보강
  v.hashtags = extractHashtags(v.title);
  if (!v.title) v.title = `유튜브 영상 (${id})`;
  return v;
}

// ── 틱톡 ────────────────────────────────────────────────
// 영상 페이지 HTML의 stats/statsV2 JSON에서 실지표를 그대로 추출
async function registerTiktok(rawUrl) {
  let url = rawUrl;
  // 단축 링크(vt.tiktok.com 등)면 리다이렉트를 따라가 원본 URL 확보
  if (!/\/video\/\d+/.test(url)) {
    try {
      const r = await fetchText(url, { timeoutMs: 8000 });
      url = r.url || url;
    } catch { /* 그대로 진행 */ }
  }
  const m = url.match(/\/video\/(\d+)/);
  if (!m) throw new Error('틱톡 영상 ID를 찾을 수 없음');
  const v = base('tiktok', m[1], url.split('?')[0]);

  // oEmbed: 제목·작성자·썸네일 (가장 안정적)
  try {
    const o = await fetchJson(`https://www.tiktok.com/oembed?url=${encodeURIComponent(v.url)}`);
    v.title = o.title || '';
    v.channel = o.author_name || '';
    v.thumbnail = o.thumbnail_url || '';
  } catch { /* 계속 */ }

  // 페이지 HTML에서 실지표 파싱
  try {
    const { text: html } = await fetchText(v.url, { timeoutMs: 10000 });
    const num = re => { const x = html.match(re); return x ? Number(x[1]) : 0; };
    v.views = num(/"playCount":"?(\d+)"?/);
    v.likes = num(/"diggCount":"?(\d+)"?/);
    v.comments = num(/"commentCount":"?(\d+)"?/);
    v.shares = num(/"shareCount":"?(\d+)"?/);
    const saves = num(/"collectCount":"?(\d+)"?/);
    if (saves) v.saves = saves;
    const ct = html.match(/"createTime":"?(\d+)"?/);
    if (ct) v.publishedAt = new Date(Number(ct[1]) * 1000).toISOString();
    const desc = html.match(/"desc":"([^"]*)"/);
    if (desc && desc[1]) v.description = desc[1].slice(0, 300);
  } catch { /* HTML 파싱 실패해도 oEmbed 결과는 유지 */ }

  v.hashtags = extractHashtags(`${v.title} ${v.description}`);
  if (!v.title) v.title = `틱톡 영상 (${v.id})`;
  return v;
}

// ── 인스타그램 ──────────────────────────────────────────
// 봇 UA로 공개 게시물 og:description 파싱: "60M likes, 4M comments - user on DATE: caption"
async function registerInstagram(url) {
  const m = url.match(/instagram\.com\/(?:p|reel|reels)\/([\w-]+)/);
  if (!m) throw new Error('인스타그램 게시물 코드를 찾을 수 없음');
  const isReel = /\/(reel|reels)\//.test(url);
  const canonical = `https://www.instagram.com/${isReel ? 'reel' : 'p'}/${m[1]}/`;
  const v = base('instagram', m[1], canonical);

  try {
    const { text: html } = await fetchText(canonical, { ua: FB_UA, timeoutMs: 9000 });
    const og = ogMeta(html);
    if (og['og:image']) v.thumbnail = og['og:image'];

    const desc = og['og:description'] || '';
    // 좋아요·댓글
    const likeM = desc.match(/([\d.,]+[KMB]?)\s+likes?/i);
    const cmtM = desc.match(/([\d.,]+[KMB]?)\s+comments?/i);
    if (likeM) v.likes = parseCount(likeM[1]);
    if (cmtM) v.comments = parseCount(cmtM[1]);
    // 작성자 · 날짜 · 캡션:  "... - author on Month D, YYYY: caption"
    // 캡션에 줄바꿈이 있을 수 있어 [\s\S] 사용
    const meta = desc.match(/-\s*(.+?)\s+on\s+([A-Za-z]+\s+\d{1,2},\s*\d{4}):\s*([\s\S]*)$/);
    if (meta) {
      v.channel = meta[1].trim();
      const d = new Date(meta[2]);
      if (!isNaN(d)) v.publishedAt = d.toISOString();
      v.description = meta[3].trim().replace(/^["“]|["”][.\s]*$/g, '').slice(0, 300);
    }
    // 작성자 폴백: og:title "Name (@handle) on Instagram" 또는 "Name on Instagram: ..."
    if (!v.channel) {
      const t = og['og:title'] || '';
      const h = t.match(/\(@([\w.]+)\)/) || t.match(/^([^:]+?)\s+on\s+Instagram/i);
      if (h) v.channel = h[1];
    }
    v.title = v.description
      ? v.description.slice(0, 60)
      : (og['og:title'] || '').replace(/\s+on\s+Instagram.*$/i, '') || `인스타그램 ${isReel ? '릴스' : '게시물'} (${m[1]})`;
    v.hashtags = extractHashtags(v.description);
  } catch { /* 파싱 실패 시 최소 등록으로 폴백 */ }

  if (!v.title) v.title = `인스타그램 ${isReel ? '릴스' : '게시물'} (${m[1]})`;
  return v;
}

// ── 스레드 ──────────────────────────────────────────────
// 봇 UA로 og 파싱: 작성자·본문·썸네일. 수치 지표는 공개 노출 안 되어 0 유지.
async function registerThreads(url) {
  const m = url.match(/threads\.(?:net|com)\/(@[\w.]+)\/post\/([\w-]+)/);
  if (!m) throw new Error('스레드 게시물 주소 형식이 아님 (threads.net/@계정/post/코드)');
  const v = base('threads', m[2], `https://www.threads.net/${m[1]}/post/${m[2]}`);
  v.channel = m[1];

  try {
    const { text: html } = await fetchText(v.url, { ua: FB_UA, timeoutMs: 9000 });
    const og = ogMeta(html);
    if (og['og:image']) v.thumbnail = og['og:image'];
    const desc = og['og:description'] || '';
    if (desc) v.description = desc.slice(0, 300);
    // og:title 예: "이름 (@handle) • Threads"
    const title = og['og:title'] || '';
    const handle = title.match(/\(@([\w.]+)\)/);
    if (handle) v.channel = `@${handle[1]}`;
    v.title = v.description ? v.description.slice(0, 60) : `스레드 게시물 ${v.channel}`;
    v.hashtags = extractHashtags(v.description);
  } catch { /* 폴백 */ }

  if (!v.title) v.title = `스레드 게시물 ${v.channel}`;
  return v;
}

export async function registerUrls(urls) {
  const videos = [];
  const errors = [];
  for (const raw of urls.map(u => u.trim()).filter(Boolean)) {
    try {
      let v;
      if (/youtu\.be|youtube\.com/.test(raw)) v = await registerYoutube(raw);
      else if (/tiktok\.com/.test(raw)) v = await registerTiktok(raw);
      else if (/instagram\.com/.test(raw)) v = await registerInstagram(raw);
      else if (/threads\.(net|com)/.test(raw)) v = await registerThreads(raw);
      else throw new Error('지원하지 않는 URL (유튜브·틱톡·인스타그램·스레드만 가능)');
      videos.push(v);
    } catch (e) {
      errors.push({ url: raw, error: e.message });
    }
  }
  return { videos, errors };
}
