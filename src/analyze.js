// 트렌드 분석 엔진: 인게이지먼트율, 급상승 점수, 성장 속도, 키워드 추출, 인사이트 생성
import { getSnapshots, getAllSnapshots } from './store.js';

export function engagementRate(v) {
  if (!v.views) return 0;
  return (v.likes + v.comments + (v.shares || 0)) / v.views;
}

// 급상승 점수: 최근 스냅샷 구간의 조회수 증가율(%)이 주 신호, 인게이지먼트는 보조 가중
export function risingScore(v) {
  const snaps = getSnapshots(v.key);
  let growth = 0;
  if (snaps.length >= 2) {
    const prev = snaps[Math.max(0, snaps.length - 3)];
    const last = snaps[snaps.length - 1];
    if (prev.views > 0) growth = (last.views - prev.views) / prev.views;
  }
  return growth * 100 + engagementRate(v) * 30;
}

export function withMetrics(videos) {
  return videos.map(v => ({
    ...v,
    engagementRate: engagementRate(v),
    risingScore: risingScore(v),
  }));
}

const STOPWORDS = new Set([
  '그리고', '하는', '있는', '이거', '진짜', '완전', '너무', '정말', '요즘', '오늘',
  'the', 'and', 'for', 'with', 'this', 'that', 'how', 'you', 'my', 'is', 'in', 'of', 'to', 'a',
  '영상', '채널', '구독', '좋아요', 'shorts', 'video', 'ep', 'vs', '1편', '2편', 'feat',
]);

// 제목·해시태그에서 인게이지먼트 가중 키워드 추출
export function extractKeywords(videos, limit = 30) {
  const scores = {};
  for (const v of videos) {
    const weight = 1 + Math.log10(1 + v.views) + engagementRate(v) * 20;
    const tokens = [
      ...String(v.title || '').split(/[\s\[\]().,!?~|#/"'‘’“”:;-]+/),
      ...(v.hashtags || []),
    ];
    for (let t of tokens) {
      t = t.replace(/^#/, '').trim().toLowerCase();
      if (t.length < 2 || STOPWORDS.has(t) || /^\d+$/.test(t)) continue;
      scores[t] ??= { keyword: t, score: 0, count: 0, platforms: new Set() };
      scores[t].score += weight;
      scores[t].count += 1;
      scores[t].platforms.add(v.platform);
    }
  }
  return Object.values(scores)
    .filter(k => k.count >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(k => ({ ...k, platforms: [...k.platforms], score: Math.round(k.score) }));
}

export function categoryStats(videos) {
  const stats = {};
  for (const v of videos) {
    const s = (stats[v.category] ??= {
      category: v.category, count: 0, views: 0, likes: 0, comments: 0, shares: 0, engagementSum: 0,
    });
    s.count++;
    s.views += v.views; s.likes += v.likes; s.comments += v.comments; s.shares += v.shares || 0;
    s.engagementSum += engagementRate(v);
  }
  return Object.values(stats)
    .map(s => ({ ...s, avgEngagement: s.count ? s.engagementSum / s.count : 0 }))
    .sort((a, b) => b.views - a.views);
}

export function platformStats(videos) {
  const stats = {};
  for (const v of videos) {
    const s = (stats[v.platform] ??= { platform: v.platform, count: 0, views: 0, engagementSum: 0 });
    s.count++; s.views += v.views; s.engagementSum += engagementRate(v);
  }
  return Object.values(stats)
    .map(s => ({ ...s, avgEngagement: s.count ? s.engagementSum / s.count : 0 }))
    .sort((a, b) => b.views - a.views);
}

// 상위 영상들의 시계열 성장 곡선
export function growthSeries(videos, top = 5) {
  const sorted = [...videos].sort((a, b) => b.risingScore - a.risingScore).slice(0, top);
  return sorted.map(v => ({
    key: v.key,
    title: v.title,
    platform: v.platform,
    points: getSnapshots(v.key).map(s => ({ at: s.at, views: s.views })),
  }));
}

// 수집 배치(같은 수집 시각)별 전체 조회수 추이 — 소규모 배치(URL 등록 등)는 제외
export function viewsTimeline(minBatchSize = 10, limit = 30) {
  const byAt = {};
  for (const s of getAllSnapshots()) (byAt[s.at] ??= []).push(s);
  return Object.entries(byAt)
    .filter(([, list]) => list.length >= minBatchSize)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([at, list]) => ({
      at,
      totalViews: list.reduce((x, s) => x + s.views, 0),
      totalEngagements: list.reduce((x, s) => x + s.likes + s.comments + (s.shares || 0), 0),
      count: list.length,
    }))
    .slice(-limit);
}

const PLATFORM_LABEL = { youtube: '유튜브', tiktok: '틱톡', instagram: '인스타그램', threads: '스레드' };

// ── 콘텐츠 아이디어 엔진 ─────────────────────────────────────────────
// 공유·좋아요가 잘 되는 실제 영상에서 "잘 먹히는 형식·주제·해시태그"를 역산해
// 크리에이터가 바로 쓸 수 있는 구체적 아이디어를 만든다. 모든 아이디어는 실영상 근거를 동반한다.

// 크리에이터 콘텐츠 형식 사전 (제목·해시태그·설명에서 탐지)
const FORMATS = [
  { name: '챌린지', kw: ['챌린지', 'challenge'] },
  { name: 'GRWM·준비', kw: ['grwm', '겟레디', '준비하는', '준비 하는', 'get ready'] },
  { name: '브이로그', kw: ['브이로그', 'vlog', '일상', '하루'] },
  { name: '꿀팁·하우투', kw: ['꿀팁', '방법', '하는법', '하는 법', 'how to', 'howto', '튜토리얼', '가이드', '노하우', '팁'] },
  { name: '리뷰·후기', kw: ['리뷰', 'review', '후기', '내돈내산', '솔직'] },
  { name: '하울·추천', kw: ['하울', 'haul', '추천템', '추천', '템 추천', '꿀템'] },
  { name: '먹방·ASMR', kw: ['먹방', 'mukbang', 'asmr', '시식', '먹어보', '먹어봄'] },
  { name: '언박싱', kw: ['언박싱', 'unboxing', '개봉', '첫인상'] },
  { name: '비교·대결', kw: ['비교', ' vs ', '대결', '대회', '차이'] },
  { name: '랭킹·모음', kw: ['랭킹', 'top', 'best', '모음', '총정리', '정리', '베스트'] },
  { name: '반전·충격', kw: ['반전', '충격', '레전드', '소름', '대참사', '난리'] },
  { name: '커버·따라하기', kw: ['커버', 'cover', '따라', '안무', '거울모드'] },
];

const IDEA_STOP = new Set([...STOPWORDS,
  '5분', '완성', '레전드', '총정리', '추천', '리뷰', '먹방', '브이로그', '챌린지', '하울', '커버', '언박싱',
  'mukbang', 'vlog', 'grwm', 'asmr', 'lookbook', 'ootd', 'official', 'video', 'm', 'v', 'mv',
  '만들기', '해봤', '해보기', '보기', '하기', '하는', '되는', 'ver', '2026',
  // 플랫폼 일반 해시태그·영어 필러 (주제로 부적합)
  'foryoupage', 'foryou', 'fyp', 'viral', 'trending', 'trend', 'explore', 'reels', 'reel',
  'tiktok', 'instagram', 'youtube', 'insta', 'petsoftiktok', 'aesthetic', 'funny', 'follow',
  'like', 'love', 'up', 'ur', 'me', 'it', 'the', 'name', 'guess', 'try', 'scramble', 'your',
  // 한국어 조사·용언·수량어 필러
  '없는', '있는', '생기는', '그런', '이런', '저런', '그냥', '근데', '아니', '대박', '첫째', '둘째',
  '이거', '저거', '그거', '해서', '하고', '한테', '까지', '부터', '에서', '으로', '보다', '했더니',
  '거의', '다들', '내가', '너가', '우리', '이제', '다시', '결국', '갑자기', '드디어',
]);

function likeRate(v) { return v.views ? v.likes / v.views : 0; }
function shareRate(v) { return v.views ? (v.shares || 0) / v.views : 0; }

function detectFormats(v) {
  const text = `${v.title} ${v.description || ''} ${(v.hashtags || []).join(' ')}`.toLowerCase();
  const hit = FORMATS.filter(f => f.kw.some(k => text.includes(k.toLowerCase()))).map(f => f.name);
  // 숫자형 제목도 하나의 형식 신호
  if (/\d+\s*(가지|개|위|선|종|분|초|일|주)/.test(v.title)) hit.push('랭킹·모음');
  return [...new Set(hit)];
}

// 형식별 성과 집계 (목표: '공유' → 공유율, '좋아요' → 좋아요율 기준 정렬)
export function formatBoard(videos, goal = '좋아요') {
  const rated = videos.filter(v => v.views > 1000); // 비율 계산 가능한 실데이터만
  const board = {};
  for (const v of rated) {
    for (const name of detectFormats(v)) {
      const b = (board[name] ??= { name, count: 0, likeSum: 0, shareSum: 0, samples: [], platforms: new Set() });
      b.count++; b.likeSum += likeRate(v); b.shareSum += shareRate(v);
      b.platforms.add(v.platform); b.samples.push(v);
    }
  }
  const key = goal === '공유' ? 'avgShare' : 'avgLike';
  return Object.values(board)
    .filter(b => b.count >= 2)
    .map(b => ({
      name: b.name, count: b.count,
      avgLike: b.likeSum / b.count, avgShare: b.shareSum / b.count,
      platforms: [...b.platforms],
      samples: b.samples
        .sort((a, c) => (goal === '공유' ? shareRate(c) - shareRate(a) : likeRate(c) - likeRate(a)))
        .slice(0, 3)
        .map(s => ({ key: s.key, title: s.title, platform: s.platform, url: s.url,
          views: s.views, likes: s.likes, shares: s.shares || 0,
          rate: goal === '공유' ? shareRate(s) : likeRate(s) })),
    }))
    .sort((a, c) => c[key] - a[key]);
}

// 주제로 부적합한 토큰 필터 (영어 짧은 조각·숫자·일반어)
function badTopic(t) {
  const low = t.toLowerCase();
  if (t.length < 2 || IDEA_STOP.has(low)) return true;
  if (/\d/.test(t)) return true;                       // 숫자 포함(3가지·2편 등) 제외
  if (/^[a-z]+$/i.test(t) && t.length < 4) return true; // 영어 짧은 조각 제외
  // 흔한 용언 어미로 끝나는 토큰 제외 (명사 우선)
  if (/(는|은|을|를|이|가|의|에|도|만|고|서|서요|네요|어요|아요|더니|하다|되다)$/.test(t) && t.length <= 4) return true;
  return false;
}

// 고성과 영상에서 주제 키워드 추출.
// 한 아웃라이어가 지배하지 않도록 "여러 영상에 반복 등장" 을 1순위로,
// 목표 지표는 보조 가중으로만 사용한다.
function hotTopics(videos, goal, limit = 12) {
  const rated = videos.filter(v => v.views > 1000);
  const metric = goal === '공유' ? shareRate : likeRate;
  const sorted = [...rated].sort((a, b) => metric(b) - metric(a));
  const top = sorted.slice(0, Math.max(8, Math.ceil(sorted.length * 0.6)));
  const scores = {};
  for (const v of top) {
    const tokens = new Set([
      ...String(v.title || '').split(/[\s\[\]().,!?~|#/"'‘’“”:;&·\-]+/),
      ...(v.hashtags || []),
    ].map(t => t.replace(/^#/, '').trim()).filter(t => t && !badTopic(t)));
    for (const t of tokens) {
      scores[t] ??= { topic: t, videos: 0, score: 0, platforms: new Set() };
      scores[t].videos += 1;                 // 등장 영상 수 (1순위)
      scores[t].score += 1 + metric(v) * 8;  // 지표 보조 가중 (상한 효과)
      scores[t].platforms.add(v.platform);
    }
  }
  let list = Object.values(scores);
  // 2개 이상 영상에 등장한 주제 우선. 너무 적으면 완화.
  const repeated = list.filter(t => t.videos >= 2);
  if (repeated.length >= 5) list = repeated;
  return list
    .sort((a, b) => (b.videos - a.videos) || (b.score - a.score))
    .slice(0, limit)
    .map(t => ({ topic: t.topic, platforms: [...t.platforms] }));
}

// 형식별 추천 해시태그 힌트
const FORMAT_TAGS = {
  '챌린지': ['챌린지', '챌린지스타그램'],
  'GRWM·준비': ['grwm', '겟레디윗미'],
  '브이로그': ['브이로그', '일상스타그램'],
  '꿀팁·하우투': ['꿀팁', '정보공유'],
  '리뷰·후기': ['리뷰', '내돈내산'],
  '하울·추천': ['하울', '추천템'],
  '먹방·ASMR': ['먹방', '먹스타그램'],
  '언박싱': ['언박싱', '신상'],
  '비교·대결': ['비교', '뭐살까'],
  '랭킹·모음': ['모음', '총정리'],
  '반전·충격': ['반전', '레전드'],
  '커버·따라하기': ['커버', '따라하기'],
};

// 형식별 구체적 제목 템플릿 (주제 + 형식 → 바로 쓸 수 있는 제안 제목)
function ideaTitle(topic, formatName) {
  const n = [3, 5, 7, 10][topic.length % 4];
  const t = {
    '챌린지': `${topic} ${n}일 챌린지 — 마지막 날 결과 공개`,
    'GRWM·준비': `${topic} 준비하는 날 같이 GRWM 해요`,
    '브이로그': `${topic}에 진심인 사람의 하루 브이로그`,
    '꿀팁·하우투': `아무도 안 알려주는 ${topic} 꿀팁 ${n}가지`,
    '리뷰·후기': `${topic} 솔직후기 — 내돈내산 ${n}일 써봄`,
    '하울·추천': `${topic} 추천템 ${n}개 총정리`,
    '먹방·ASMR': `${topic} 먹방 — ${n}종 다 먹어봤습니다`,
    '언박싱': `${topic} 언박싱 & 첫인상`,
    '비교·대결': `${topic} ${n}종 비교 — 1등은?`,
    '랭킹·모음': `${topic} TOP ${n} 모음`,
    '반전·충격': `${topic} 하다가 생긴 충격적인 일`,
    '커버·따라하기': `${topic} 따라해봤습니다`,
  };
  return t[formatName] || `${topic} — ${formatName}`;
}

// 아이디어 카드 생성: (고성과 형식 × 뜨는 주제) 조합을 근거와 함께 제시
export function generateIdeas(videos, { goal = '좋아요', limit = 8 } = {}) {
  const board = formatBoard(videos, goal);
  const topics = hotTopics(videos, goal);
  const kwHash = extractKeywords(videos.filter(v => v.views > 1000), 40);
  const ratedCount = videos.filter(v => v.views > 1000).length;

  const ideas = [];
  let ti = 0;
  for (const fmt of board) {
    if (ideas.length >= limit) break;
    // 이 형식이 강한 플랫폼에서 잘 맞는 주제를 하나 고른다
    const topic = topics[ti % Math.max(1, topics.length)];
    ti++;
    if (!topic) break;
    // 해시태그: 주제 + 형식 기반으로 아이디어마다 맞게 생성
    const topicTag = topic.topic.replace(/\s+/g, '');
    const hashtags = [...new Set([
      topicTag,
      ...(FORMAT_TAGS[fmt.name] || [fmt.name.split('·')[0]]),
      ...kwHash.slice(0, 2).map(k => k.keyword).filter(k => !/^(foryoupage|petsoftiktok|aesthetic|fyp)$/i.test(k)),
    ])].filter(Boolean).slice(0, 4);
    ideas.push({
      title: ideaTitle(topic.topic, fmt.name),
      format: fmt.name,
      topic: topic.topic,
      goal,
      metricPct: (goal === '공유' ? fmt.avgShare : fmt.avgLike) * 100,
      metricLabel: goal === '공유' ? '평균 공유율' : '평균 좋아요율',
      bestPlatform: fmt.platforms[0],
      hashtags,
      evidence: fmt.samples,
    });
  }

  return {
    goal,
    basis: { ratedCount, hasShareData: videos.some(v => (v.shares || 0) > 0 && v.views > 1000) },
    formats: board.slice(0, 8).map(b => ({
      name: b.name, count: b.count,
      avgLikePct: b.avgLike * 100, avgSharePct: b.avgShare * 100, platforms: b.platforms,
    })),
    topics: topics.slice(0, 10),
    ideas,
  };
}

// AI 프롬프트용: 실데이터 트렌드 요약 (Claude에 넘길 근거)
export function ideaContext(videos, goal, niche) {
  const board = formatBoard(videos, goal).slice(0, 6);
  const topics = hotTopics(videos, goal, 10);
  const top = [...videos].filter(v => v.views > 1000)
    .sort((a, b) => (goal === '공유' ? shareRate(b) - shareRate(a) : likeRate(b) - likeRate(a)))
    .slice(0, 12)
    .map(v => ({
      title: v.title, platform: PLATFORM_LABEL[v.platform] || v.platform, category: v.category,
      views: v.views, likes: v.likes, shares: v.shares || 0,
      likeRatePct: +(likeRate(v) * 100).toFixed(1), shareRatePct: +(shareRate(v) * 100).toFixed(2),
      hashtags: (v.hashtags || []).slice(0, 5),
    }));
  return {
    goal, niche: niche || '전체',
    winningFormats: board.map(b => ({ format: b.name, count: b.count,
      avgLikePct: +(b.avgLike * 100).toFixed(1), avgSharePct: +(b.avgShare * 100).toFixed(2) })),
    hotTopics: topics.map(t => t.topic),
    topVideos: top,
  };
}

// 자동 텍스트 인사이트 생성
export function insights(videos) {
  const out = [];
  if (!videos.length) return out;
  const cats = categoryStats(videos);
  const plats = platformStats(videos);

  if (cats[0]) {
    const share = cats[0].views / cats.reduce((a, c) => a + c.views, 0);
    out.push(`현재 조회수 기준 가장 뜨거운 분야는 **${cats[0].category}** — 전체 조회수의 ${(share * 100).toFixed(1)}%를 차지합니다.`);
  }
  const bestEng = [...cats].sort((a, b) => b.avgEngagement - a.avgEngagement)[0];
  if (bestEng) {
    out.push(`인게이지먼트율(좋아요+댓글+공유/조회수)이 가장 높은 분야는 **${bestEng.category}** (평균 ${(bestEng.avgEngagement * 100).toFixed(2)}%) — 팬덤 반응이 가장 활발합니다.`);
  }
  // 특정 영상을 지목하는 인사이트는 실데이터(url!=='#')만 사용 — 데모가 실제 트렌드로 오인되지 않도록
  const realVideos = videos.filter(v => v.url && v.url !== '#');
  const rising = [...realVideos].sort((a, b) => b.risingScore - a.risingScore)[0];
  if (rising) {
    out.push(`지금 가장 급상승 중인 콘텐츠는 ${PLATFORM_LABEL[rising.platform] || rising.platform}의 「${rising.title}」 (${rising.category}) 입니다.`);
  }
  const platEng = [...plats].sort((a, b) => b.avgEngagement - a.avgEngagement)[0];
  if (platEng) {
    out.push(`플랫폼별 평균 인게이지먼트는 **${PLATFORM_LABEL[platEng.platform] || platEng.platform}**가 최고 (${(platEng.avgEngagement * 100).toFixed(2)}%) — 참여 유도형 캠페인에 유리합니다.`);
  }
  // 이전 수집 대비 전체 조회수 증감
  const tl = viewsTimeline();
  if (tl.length >= 2) {
    const prev = tl[tl.length - 2];
    const last = tl[tl.length - 1];
    if (prev.totalViews > 0) {
      const diff = ((last.totalViews - prev.totalViews) / prev.totalViews) * 100;
      const prevDate = new Date(prev.at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      out.push(`이전 수집(${prevDate}) 대비 전체 조회수가 **${diff >= 0 ? '+' : ''}${diff.toFixed(1)}%** ${diff >= 0 ? '증가' : '감소'}했습니다.`);
    }
  }
  // 인게이지먼트 1위 영상 (실데이터·조회수 있는 것만)
  const bestVideo = realVideos.filter(v => v.views >= 1000).sort((a, b) => engagementRate(b) - engagementRate(a))[0];
  if (bestVideo) {
    out.push(`인게이지먼트율 1위 영상: ${PLATFORM_LABEL[bestVideo.platform] || bestVideo.platform} 「${bestVideo.title.slice(0, 40)}」 — ${(engagementRate(bestVideo) * 100).toFixed(2)}%`);
  }
  // 데모가 섞여 있으면 정직하게 고지
  const demoCount = videos.length - realVideos.length;
  if (demoCount > 0) {
    out.push(`⚠️ 현재 데모(샘플) ${demoCount}개가 포함되어 있습니다. 분야·플랫폼 통계에는 반영되지만 위 지목형 인사이트는 실데이터만 사용합니다.`);
  }
  const kw = extractKeywords(videos, 5);
  if (kw.length) {
    out.push(`이번 수집 기준 상위 트렌드 키워드: ${kw.map(k => `#${k.keyword}`).join(' ')}`);
  }
  return out;
}
