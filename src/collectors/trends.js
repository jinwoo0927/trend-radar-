// 오늘의 소재 수집기 (API 키 불필요)
// ① 구글 트렌드 KR 실시간 급상승 검색어 (RSS, approx_traffic 포함)
// ② 유튜브 검색 자동완성 (키워드 확장 트리)
// 실측 검증: 2026-07 두 엔드포인트 모두 무인증 작동 확인.
import { fetchText } from './youtube-web.js';

let trendsCache = { at: 0, items: [] };
const TRENDS_TTL = 30 * 60e3;

function decodeEntities(s) {
  return s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}
function xmlField(block, tag) {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return m ? decodeEntities(m[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim()) : '';
}

// 구글 트렌드 KR 급상승 검색어 → [{ keyword, traffic, trafficNum, news: [{title, source}] }]
export async function fetchGoogleTrendsKR() {
  if (Date.now() - trendsCache.at < TRENDS_TTL && trendsCache.items.length) return trendsCache.items;
  const xml = await fetchText('https://trends.google.com/trending/rss?geo=KR', 12000);
  const items = [];
  for (const block of xml.split('<item>').slice(1)) {
    const keyword = xmlField(block, 'title');
    if (!keyword) continue;
    const traffic = xmlField(block, 'ht:approx_traffic');           // "5000+" 등
    const news = [];
    for (const nb of block.split('<ht:news_item>').slice(1, 4)) {
      const t = xmlField(nb, 'ht:news_item_title');
      if (t) news.push({ title: t, source: xmlField(nb, 'ht:news_item_source') });
    }
    items.push({
      keyword,
      traffic,
      trafficNum: parseInt(String(traffic).replace(/[^\d]/g, ''), 10) || 0,
      news,
    });
  }
  const sorted = items.sort((a, b) => b.trafficNum - a.trafficNum).slice(0, 20);
  trendsCache = { at: Date.now(), items: sorted };
  return sorted;
}

// 유튜브 검색 자동완성 — 시청자가 실제로 검색하는 문구 (수요 신호)
export async function fetchYoutubeSuggestions(q) {
  const url = 'https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&hl=ko&oe=utf-8&q='
    + encodeURIComponent(q);
  const raw = await fetchText(url, 8000);
  try {
    const arr = JSON.parse(raw);
    return (arr[1] || []).map(String).filter(s => s && s !== q).slice(0, 10);
  } catch { return []; }
}

// 키워드 확장 트리: 원 키워드 자동완성 + 상위 결과 3개를 한 번 더 확장
export async function expandKeyword(q) {
  const first = await fetchYoutubeSuggestions(q);
  const children = {};
  await Promise.all(first.slice(0, 3).map(async k => {
    children[k] = await fetchYoutubeSuggestions(k).catch(() => []);
  }));
  return { query: q, suggestions: first, children };
}
