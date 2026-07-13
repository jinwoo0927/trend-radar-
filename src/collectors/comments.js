// 유튜브 댓글 수집기 — youtubei/v1/next POST, API 키 완전 불필요 (실측 검증됨).
// 상위 댓글 + 댓글 좋아요 수를 얻어 "시청자가 반응한 포인트" 분석 재료로 쓴다.
import { parseCount } from './youtube-web.js';

const CLIENT = { clientName: 'WEB', clientVersion: '2.20260701.00.00', hl: 'ko', gl: 'KR' };

async function innertube(body) {
  const res = await fetch('https://www.youtube.com/youtubei/v1/next?prettyPrint=false', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0' },
    body: JSON.stringify({ context: { client: CLIENT }, ...body }),
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`innertube HTTP ${res.status}`);
  return res.json();
}

// JSON 트리에서 조건에 맞는 노드를 재귀 탐색
function* walk(node) {
  if (!node || typeof node !== 'object') return;
  yield node;
  for (const v of Object.values(node)) yield* walk(v);
}

const cache = new Map(); // videoId → { at, comments }
const TTL = 6 * 3600e3;

// 상위 댓글 최대 20개: [{ text, author, likes }]
export async function fetchTopComments(videoId) {
  const hit = cache.get(videoId);
  if (hit && Date.now() - hit.at < TTL) return hit.comments;

  // 1차: 워치 응답에서 댓글 섹션 continuation 토큰 추출
  const first = await innertube({ videoId });
  let token = '';
  for (const n of walk(first)) {
    if (n.sectionIdentifier === 'comment-item-section' || n.targetId === 'comments-section') {
      for (const m of walk(n)) {
        const t = m.continuationCommand?.token;
        if (t) { token = t; break; }
      }
      if (token) break;
    }
  }
  if (!token) {
    // 폴백: 응답 어디든 comment 관련 continuation
    for (const n of walk(first)) {
      const t = n.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
      if (t && /comment/i.test(JSON.stringify(n).slice(0, 400))) { token = t; break; }
    }
  }
  if (!token) return [];

  // 2차: 댓글 페이지 로드 — 신형(commentEntityPayload)·구형(commentRenderer) 모두 지원
  const page = await innertube({ continuation: token });
  const comments = [];
  const seen = new Set();
  for (const n of walk(page)) {
    // 신형: frameworkUpdates 뮤테이션의 commentEntityPayload
    if (n.commentEntityPayload) {
      const p = n.commentEntityPayload;
      const text = p.properties?.content?.content || '';
      if (!text || seen.has(text)) continue;
      seen.add(text);
      comments.push({
        text: text.slice(0, 300),
        author: p.author?.displayName || '',
        likes: parseCount(p.toolbar?.likeCountNotliked || p.toolbar?.likeCountA11y || '0'),
      });
    }
    // 구형: commentRenderer
    else if (n.commentRenderer?.contentText) {
      const text = (n.commentRenderer.contentText.runs || []).map(r => r.text).join('');
      if (!text || seen.has(text)) continue;
      seen.add(text);
      comments.push({
        text: text.slice(0, 300),
        author: n.commentRenderer.authorText?.simpleText || '',
        likes: parseCount(n.commentRenderer.voteCount?.simpleText || '0'),
      });
    }
    if (comments.length >= 20) break;
  }
  comments.sort((a, b) => b.likes - a.likes);
  cache.set(videoId, { at: Date.now(), comments });
  return comments;
}
