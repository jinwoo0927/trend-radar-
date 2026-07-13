// API 키 없이 유튜브 공개 인기 페이지(HTML)를 파싱하는 수집기.
// 페이지에 내장된 ytInitialData JSON에서 영상 목록을 추출하고,
// 상위 영상은 시청 페이지를 추가 조회해 좋아요·댓글 수를 보강한다(베스트 에포트).

export const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.5',
};

export async function fetchText(url, timeoutMs = 12000, extraHeaders = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { ...HEADERS, ...extraHeaders }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

// "조회수 1,234,567회" | "123만회" | "1.9천" | "1.2억" | "1.2M views" → 숫자
export function parseCount(text) {
  if (!text) return 0;
  const m = String(text).match(/([\d,.]+)\s*(억|만|천|[KMB])?/i);
  if (!m) return 0;
  const num = parseFloat(m[1].replace(/,/g, ''));
  if (!isFinite(num)) return 0;
  const unit = (m[2] || '').toUpperCase();
  const mul = { '억': 1e8, '만': 1e4, '천': 1e3, K: 1e3, M: 1e6, B: 1e9 }[unit] || 1;
  return Math.round(num * mul);
}

// HTML 속 "marker = {...}" 형태의 JSON을 중괄호 짝 맞추기로 추출
export function extractJson(html, marker) {
  const i = html.indexOf(marker);
  if (i < 0) return null;
  const start = html.indexOf('{', i);
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let j = start; j < html.length; j++) {
    const c = html[j];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return JSON.parse(html.slice(start, j + 1));
    }
  }
  return null;
}

function* findVideoRenderers(node) {
  if (!node || typeof node !== 'object') return;
  if (node.videoRenderer) yield node.videoRenderer;
  for (const v of Object.values(node)) yield* findVideoRenderers(v);
}

// "5일 전" / "3시간 전" 같은 상대 시각을 절대 날짜(ISO)로 변환
export function parsePublishedText(text) {
  const m = String(text || '').match(/(\d+)\s*(분|시간|일|주|개월|년)\s*전/);
  if (!m) return '';
  const ms = { '분': 60e3, '시간': 3600e3, '일': 86400e3, '주': 7 * 86400e3, '개월': 30 * 86400e3, '년': 365 * 86400e3 }[m[2]];
  return new Date(Date.now() - Number(m[1]) * ms).toISOString();
}

// 시청 페이지에서 조회수·좋아요·댓글·게시일 보강 (실패해도 무시)
export async function enrichFromWatchPage(video) {
  try {
    const html = await fetchText(`https://www.youtube.com/watch?v=${video.id}`, 9000);
    const vc = html.match(/"viewCount":"(\d+)"/);
    if (vc) video.views = Number(vc[1]);
    const pd = html.match(/"publishDate":"([\d-T:+.Z]+)"/) || html.match(/"uploadDate":"([\d-T:+.Z]+)"/);
    if (pd) video.publishedAt = new Date(pd[1]).toISOString();
    const lk = html.match(/"likeCountIfIndifferent":"(\d+)"/) || html.match(/"likeCount":"(\d+)"/);
    if (lk) video.likes = Number(lk[1]);
    else {
      const la = html.match(/([\d,.]+[만억]?)\s*명[^"]{0,40}좋아/);
      if (la) video.likes = parseCount(la[1]);
    }
    // 댓글 수: 최신 유튜브는 댓글 패널 제목 헤더의 contextualInfo에 노출 ("788" | "1.9천" | "244만")
    const cm = html.match(/"commentCount":\{"simpleText":"([^"]+)"/)
      || html.match(/"commentCount":"(\d+)"/)
      || html.match(/"engagementPanelTitleHeaderRenderer":\{[\s\S]{0,800}?"contextualInfo":\{"runs":\[\{"text":"([^"]+)"/);
    if (cm) {
      const n = parseCount(cm[1]);
      if (n > 0) video.comments = n;
    }
    // 전체 설명 (AI 구조 분석 재료)
    const desc = html.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/);
    if (desc) {
      try {
        const full = JSON.parse('"' + desc[1] + '"');
        if (full && full.length > (video.description || '').length) video.description = full.slice(0, 1500);
      } catch { /* 무시 */ }
    }
  } catch {
    // 보강 실패는 치명적이지 않음
  }
  return video;
}

// 분야별 시드 쿼리. 2025년 유튜브 트렌딩 페이지 폐지 이후,
// 공개 검색(이번 주 업로드 + 조회수순)이 API 키 없는 인기 영상 수집의 정공법이다.
const SEED_QUERIES = [
  { category: '뷰티', q: '메이크업' },
  { category: '패션', q: '패션 코디' },
  { category: '푸드', q: '먹방' },
  { category: '테크·IT', q: '테크 리뷰' },
  { category: '게임', q: '게임' },
  { category: '음악·댄스', q: '케이팝' },
  { category: '운동·건강', q: '홈트 운동' },
  { category: '여행', q: '여행 브이로그' },
  { category: '교육·지식', q: '경제 지식' },
  { category: '엔터테인먼트', q: '예능 하이라이트' },
  { category: '브이로그·라이프', q: '일상 브이로그' },
  { category: '비즈니스·마케팅', q: '마케팅' },
];

// sp=CAMSBAgDEAE= : 정렬=조회수순, 업로드=이번 주, 유형=동영상
const SP_WEEK_TOP_VIEWS = 'CAMSBAgDEAE=';

function mapVideoRenderer(vr, categoryHint) {
  const id = vr.videoId;
  const title = vr.title?.runs?.map(r => r.text).join('') || vr.title?.simpleText || '';
  if (!id || !title) return null;
  // 채널 핸들/ID — 아웃라이어 점수(채널 평균 대비 배수) 계산에 사용
  const owner = vr.ownerText?.runs?.[0] || vr.shortBylineText?.runs?.[0] || {};
  const browse = owner.navigationEndpoint?.browseEndpoint || {};
  return {
    id,
    platform: 'youtube',
    title,
    channel: owner.text || '',
    channelHandle: (browse.canonicalBaseUrl || '').replace(/^\//, ''), // "@handle"
    channelId: browse.browseId || '',                                   // "UC..."
    description: (vr.detailedMetadataSnippets?.[0]?.snippetText?.runs || vr.descriptionSnippet?.runs || [])
      .map(r => r.text).join('').slice(0, 300),
    hashtags: [],
    categoryHint,
    publishedAt: parsePublishedText(vr.publishedTimeText?.simpleText),
    publishedText: vr.publishedTimeText?.simpleText || '',
    thumbnail: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
    url: `https://www.youtube.com/watch?v=${id}`,
    views: parseCount(
      vr.viewCountText?.simpleText ||
      (vr.viewCountText?.runs || []).map(r => r.text).join('') ||
      vr.shortViewCountText?.simpleText
    ),
    likes: 0,
    comments: 0,
    shares: 0,
  };
}

// 임의 키워드 공개 검색 — "오늘의 소재"·키워드 탐색기에서 사용
export async function searchYoutube(q, { limit = 6, sp = SP_WEEK_TOP_VIEWS, minViews = 0 } = {}) {
  const url = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(q)
    + (sp ? '&sp=' + encodeURIComponent(sp) : '');
  const data = extractJson(await fetchText(url), 'ytInitialData');
  if (!data) return [];
  const out = [];
  const seen = new Set();
  for (const vr of findVideoRenderers(data)) {
    const v = mapVideoRenderer(vr, '');
    if (!v || seen.has(v.id) || v.views < minViews) continue;
    seen.add(v.id);
    out.push(v);
    if (out.length >= limit) break;
  }
  return out;
}

export async function collectYoutubeWeb({ perQuery = 5, enrichTop = 24 } = {}) {
  const seen = new Set();
  const videos = [];

  // 분야별 시드 쿼리를 동시 3개씩 실행
  let qi = 0;
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (qi < SEED_QUERIES.length) {
      const seed = SEED_QUERIES[qi++];
      try {
        const url = 'https://www.youtube.com/results?search_query=' +
          encodeURIComponent(seed.q) + '&sp=' + encodeURIComponent(SP_WEEK_TOP_VIEWS);
        const data = extractJson(await fetchText(url), 'ytInitialData');
        if (!data) continue;
        let taken = 0;
        for (const vr of findVideoRenderers(data)) {
          if (taken >= perQuery) break;
          const v = mapVideoRenderer(vr, seed.category);
          if (!v || seen.has(v.id) || v.views < 1000) continue;
          seen.add(v.id);
          videos.push(v);
          taken++;
        }
      } catch {
        // 개별 쿼리 실패는 무시하고 계속
      }
    }
  }));

  if (!videos.length) throw new Error('공개 검색에서 영상을 찾지 못함 (네트워크/구조 변경 확인 필요)');

  // 조회수 상위 N개만 좋아요·댓글 보강 (동시 4개)
  const targets = [...videos].sort((a, b) => b.views - a.views).slice(0, enrichTop);
  let idx = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (idx < targets.length) {
      const v = targets[idx++];
      await enrichFromWatchPage(v);
    }
  }));
  return videos;
}
