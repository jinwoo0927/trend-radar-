// 유튜브 채널 수집기 (API 키 불필요)
// 채널 페이지(/@handle/videos, /channel/UC../videos)의 ytInitialData에서
// 구독자 수 + 최근 영상 목록(조회수)을 파싱한다.
// → 아웃라이어 점수(영상 조회수 ÷ 채널 최근 영상 중앙값)의 재료.
// 2026 마크업: 영상 목록은 lockupViewModel(신형)이며 videoRenderer(구형)도 폴백 지원.
import { fetchText, extractJson, parseCount, parsePublishedText } from './youtube-web.js';

// EU 동의 리다이렉트 우회 — 이 쿠키가 없으면 758바이트 안내 페이지만 온다 (실측)
const CONSENT = { cookie: 'CONSENT=YES+cb.20240101-01-p0.ko+FX+000; SOCS=CAI' };

const cache = new Map(); // key(handle|UC id) → { at, data }
const TTL_MS = 12 * 3600e3;

function channelUrl(idOrHandle, tab = 'videos') {
  const s = String(idOrHandle).trim().replace(/^https?:\/\/(www\.)?youtube\.com\//, '').replace(/\/.*$/, '');
  if (/^UC[\w-]{10,}$/.test(s)) return `https://www.youtube.com/channel/${s}/${tab}`;
  const handle = s.startsWith('@') ? s : '@' + s;
  return `https://www.youtube.com/${encodeURIComponent(handle)}/${tab}`;
}

// ytInitialData 트리에서 영상(신형 lockupViewModel / 구형 videoRenderer)을 재귀 탐색
function* findChannelVideos(node) {
  if (!node || typeof node !== 'object') return;
  if (node.lockupViewModel?.contentId && node.lockupViewModel?.contentType?.includes('VIDEO')) {
    yield { type: 'lockup', v: node.lockupViewModel };
  }
  if (node.videoRenderer?.videoId) yield { type: 'renderer', v: node.videoRenderer };
  if (node.reelItemRenderer?.videoId) yield { type: 'reel', v: node.reelItemRenderer };
  if (node.shortsLockupViewModel?.onTap) yield { type: 'shortsLockup', v: node.shortsLockupViewModel };
  for (const val of Object.values(node)) yield* findChannelVideos(val);
}

// lockupViewModel 내부의 메타 텍스트("조회수 52만회" / "3일 전")를 재귀로 긁어온다
function collectTexts(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (typeof node.content === 'string') out.push(node.content);
  if (typeof node.text === 'string') out.push(node.text);
  for (const val of Object.values(node)) {
    if (val && typeof val === 'object') collectTexts(val, out);
  }
  return out;
}

function mapEntry(entry) {
  if (entry.type === 'lockup') {
    const lv = entry.v;
    const texts = collectTexts(lv.metadata);
    const viewText = texts.find(t => /조회수|views?/i.test(t)) || '';
    const whenText = texts.find(t => /전$|ago/i.test(t)) || '';
    const title = lv.metadata?.lockupMetadataViewModel?.title?.content
      || collectTexts(lv.metadata)[0] || '';
    return {
      id: lv.contentId,
      title: String(title).slice(0, 200),
      views: parseCount(viewText.replace(/조회수\s*/, '')),
      publishedText: whenText,
      publishedAt: parsePublishedText(whenText),
    };
  }
  if (entry.type === 'renderer') {
    const vr = entry.v;
    return {
      id: vr.videoId,
      title: vr.title?.runs?.map(r => r.text).join('') || vr.title?.simpleText || '',
      views: parseCount(vr.viewCountText?.simpleText || ''),
      publishedText: vr.publishedTimeText?.simpleText || '',
      publishedAt: parsePublishedText(vr.publishedTimeText?.simpleText),
    };
  }
  if (entry.type === 'reel') {
    const rr = entry.v;
    return {
      id: rr.videoId,
      title: rr.headline?.simpleText || '',
      views: parseCount(rr.viewCountText?.simpleText || rr.viewCountText?.accessibility?.accessibilityData?.label || ''),
      publishedText: '', publishedAt: '',
    };
  }
  if (entry.type === 'shortsLockup') {
    const sl = entry.v;
    const id = sl.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId
      || sl.inlinePlayerData?.onVisible?.innertubeCommand?.watchEndpoint?.videoId || '';
    const texts = collectTexts(sl.overlayMetadata);
    const viewText = texts.find(t => /조회수|views?/i.test(t)) || '';
    return {
      id,
      title: sl.overlayMetadata?.primaryText?.content || texts[0] || '',
      views: parseCount(viewText.replace(/조회수\s*/, '')),
      publishedText: '', publishedAt: '',
    };
  }
  return null;
}

function median(nums) {
  const arr = nums.filter(n => n > 0).sort((a, b) => a - b);
  if (!arr.length) return 0;
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[mid] : Math.round((arr[mid - 1] + arr[mid]) / 2);
}

// 채널 프로필: { handle, name, subscribers, videos[], medianViews, medianShorts, fetchedAt }
export async function fetchChannelProfile(idOrHandle, { withShorts = true } = {}) {
  const key = String(idOrHandle).toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;

  const html = await fetchText(channelUrl(idOrHandle, 'videos'), 15000, CONSENT);
  if (html.length < 5000) throw new Error('채널 페이지 로드 실패(동의 페이지/404 추정)');
  const data = extractJson(html, 'ytInitialData');
  if (!data) throw new Error('ytInitialData 없음');

  // 구독자 수: 신형 헤더(pageHeaderRenderer) 텍스트 또는 HTML 원문에서 추출
  let subscribers = 0;
  const headerTexts = collectTexts(data.header || {});
  const subText = headerTexts.find(t => /구독자|subscribers?/i.test(t)) || '';
  if (subText) subscribers = parseCount(subText.replace(/구독자\s*/, ''));
  if (!subscribers) {
    const m = html.match(/구독자\s*([\d,.]+[만억천]?)명/);
    if (m) subscribers = parseCount(m[1]);
  }
  const name = data.metadata?.channelMetadataRenderer?.title
    || html.match(/<meta property="og:title" content="([^"]+)"/)?.[1] || '';
  const handle = data.metadata?.channelMetadataRenderer?.vanityChannelUrl?.split('/').pop()
    || (String(idOrHandle).startsWith('@') ? idOrHandle : '');

  // 최근 영상 목록 (중복 제거, 최대 30개)
  const seen = new Set();
  const videos = [];
  for (const entry of findChannelVideos(data)) {
    const v = mapEntry(entry);
    if (!v?.id || seen.has(v.id)) continue;
    seen.add(v.id);
    videos.push(v);
    if (videos.length >= 30) break;
  }

  // 쇼츠 탭 (선택) — 쇼츠/롱폼은 조회수 분포가 달라 중앙값을 분리 계산
  let shorts = [];
  if (withShorts) {
    try {
      const sHtml = await fetchText(channelUrl(idOrHandle, 'shorts'), 15000, CONSENT);
      const sData = extractJson(sHtml, 'ytInitialData');
      if (sData) {
        const sSeen = new Set();
        for (const entry of findChannelVideos(sData)) {
          const v = mapEntry(entry);
          if (!v?.id || sSeen.has(v.id)) continue;
          sSeen.add(v.id);
          shorts.push(v);
          if (shorts.length >= 30) break;
        }
      }
    } catch { /* 쇼츠 탭이 없는 채널은 무시 */ }
  }

  const profile = {
    handle: handle || String(idOrHandle),
    channelId: data.metadata?.channelMetadataRenderer?.externalId || '',
    name,
    subscribers,
    videos,
    shorts,
    medianViews: median(videos.map(v => v.views)),
    medianShorts: median(shorts.map(v => v.views)),
    fetchedAt: new Date().toISOString(),
  };
  cache.set(key, { at: Date.now(), data: profile });
  return profile;
}

// 아웃라이어 배수 → 등급 브래킷 (vidIQ 색상 관례)
export function outlierBracket(mult) {
  if (mult >= 10) return { level: 'mega', label: `${Math.round(mult)}x 초대박` };
  if (mult >= 5) return { level: 'high', label: `${mult.toFixed(1)}x 대박` };
  if (mult >= 2) return { level: 'mid', label: `${mult.toFixed(1)}x 준수` };
  return { level: 'base', label: `${mult.toFixed(1)}x` };
}
