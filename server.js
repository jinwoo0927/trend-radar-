import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import * as store from './src/store.js';
import { collectAll } from './src/collectors/index.js';
import { registerUrls } from './src/collectors/register.js';
import {
  withMetrics, extractKeywords, categoryStats, platformStats, growthSeries, insights, viewsTimeline,
  generateIdeas, ideaContext,
} from './src/analyze.js';
import { CATEGORIES, classify as classifyVideo } from './src/classify.js';
import { callClaude, aiEnabled, aiModel, aiInfo } from './src/ai.js';
import { fetchYoutubeTranscript, ytDlpAvailable } from './src/collectors/transcript.js';
import { fetchChannelProfile, outlierBracket } from './src/collectors/channel.js';

const PLATFORM_LABEL = { youtube: '유튜브', tiktok: '틱톡', instagram: '인스타그램', threads: '스레드' };
const isScriptPlatform = p => p === 'youtube' || p === 'tiktok'; // 대본형 vs 글형

// AI 분석에 넘길 콘텐츠 텍스트+지표 요약. 유튜브는 실제 대본(자막)을 포함.
async function analyzable(v, { withTranscript = false } = {}) {
  const base = {
    platform: PLATFORM_LABEL[v.platform] || v.platform,
    category: v.category,
    title: v.title,
    channel: v.channel || '',
    text: (v.description || '').slice(0, 1500),  // 캡션·글·설명 (스레드/인스타/틱톡은 콘텐츠 본문)
    hashtags: (v.hashtags || []).slice(0, 10),
    views: v.views, likes: v.likes, comments: v.comments, shares: v.shares || 0,
    likeRatePct: v.views ? +((v.likes / v.views) * 100).toFixed(2) : null,
    shareRatePct: v.views ? +(((v.shares || 0) / v.views) * 100).toFixed(2) : null,
  };
  if (withTranscript && v.platform === 'youtube') {
    const script = await fetchYoutubeTranscript(v.id).catch(() => '');
    if (script) base.script = script; // 실제 발화 대본
  }
  return base;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3600;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 헬스체크 (Render 등 배포 플랫폼용)
app.get('/api/health', (req, res) => res.json({ ok: true, storage: store.storageMode(), ai: aiInfo().provider || 'none' }));

function filtered(query) {
  let videos = withMetrics(store.getVideos());
  if (query.platform && query.platform !== 'all') videos = videos.filter(v => v.platform === query.platform);
  if (query.category && query.category !== 'all') videos = videos.filter(v => v.category === query.category);
  if (query.q) {
    const q = String(query.q).toLowerCase();
    videos = videos.filter(v =>
      String(v.title).toLowerCase().includes(q) ||
      String(v.channel).toLowerCase().includes(q) ||
      (v.hashtags || []).some(h => String(h).toLowerCase().includes(q))
    );
  }
  return videos;
}

function sorted(videos, sortKey) {
  if (sortKey === 'publishedAt') {
    return [...videos].sort((a, b) => String(b.publishedAt || '').localeCompare(String(a.publishedAt || '')));
  }
  if (sortKey === 'outlier') {
    return [...videos].sort((a, b) => (b.outlier?.mult ?? 0) - (a.outlier?.mult ?? 0));
  }
  return [...videos].sort((a, b) => (b[sortKey] ?? 0) - (a[sortKey] ?? 0));
}

// 영상 목록 (필터 + 검색 + 정렬)
app.get('/api/videos', (req, res) => {
  const videos = sorted(filtered(req.query), req.query.sort || 'views')
    .slice(0, Number(req.query.limit) || 50);
  res.json(videos);
});

// 대시보드 종합 데이터
app.get('/api/dashboard', (req, res) => {
  const videos = filtered(req.query);
  const totalViews = videos.reduce((a, v) => a + v.views, 0);
  const totalLikes = videos.reduce((a, v) => a + v.likes, 0);
  const totalComments = videos.reduce((a, v) => a + v.comments, 0);
  const totalShares = videos.reduce((a, v) => a + (v.shares || 0), 0);
  // 평균 인게이지먼트율은 조회수가 있는 영상만으로 계산 (인스타 등 조회수 미공개 영상이 비율을 왜곡하지 않도록)
  const engViewed = videos.filter(v => v.views > 0);
  const engViews = engViewed.reduce((a, v) => a + v.views, 0);
  const engActions = engViewed.reduce((a, v) => a + v.likes + v.comments + (v.shares || 0), 0);
  const liveCount = videos.filter(v => v.url && v.url !== '#').length;
  const registeredCount = videos.filter(v => v.source === 'registered').length;

  // 이전 수집 대비 조회수 증감(%) — 전체 배치 기준
  const timeline = viewsTimeline();
  let viewsDelta = null;
  if (timeline.length >= 2) {
    const prev = timeline[timeline.length - 2];
    const last = timeline[timeline.length - 1];
    if (prev.totalViews > 0) viewsDelta = ((last.totalViews - prev.totalViews) / prev.totalViews) * 100;
  }

  res.json({
    meta: { ...store.getMeta(), nextAutoCollectAt: nextAutoCollectAt(), intervalMin: INTERVAL_MIN },
    summary: {
      videoCount: videos.length,
      liveCount,
      registeredCount,
      demoCount: videos.length - liveCount,
      totalViews, totalLikes, totalComments, totalShares,
      avgEngagement: engViews ? engActions / engViews : 0,
      risingCount: videos.filter(v => v.risingScore > 15).length,
      outlierCount: videos.filter(v => (v.outlier?.mult || 0) >= 2).length,
      acceleratingCount: videos.filter(v => v.accelerating).length,
      viewsDelta,
    },
    categories: CATEGORIES,
    categoryStats: categoryStats(videos),
    platformStats: platformStats(videos),
    keywords: extractKeywords(videos, 24),
    growth: growthSeries(videos, 5),
    timeline,
    collectLog: [...(store.getMeta().collectLog || [])].reverse().slice(0, 10),
    insights: insights(videos),
  });
});

// CSV 내보내기 (현재 필터·정렬 반영, 엑셀 한글 호환 BOM 포함)
app.get('/api/export.csv', (req, res) => {
  const videos = sorted(filtered(req.query), req.query.sort || 'views');
  const header = ['순위', '제목', '채널', '플랫폼', '분야', '조회수', '좋아요', '댓글', '공유',
    '인게이지먼트율(%)', '급상승점수', '게시일', '수집일시', 'URL', '데이터'];
  const rows = videos.map((v, i) => [
    i + 1, v.title, v.channel || '', v.platform, v.category,
    v.views, v.likes, v.comments, v.shares || 0,
    (v.engagementRate * 100).toFixed(2), v.risingScore.toFixed(1),
    v.publishedAt ? v.publishedAt.slice(0, 10) : '',
    v.updatedAt ? v.updatedAt.replace('T', ' ').slice(0, 16) : '',
    v.url === '#' ? '' : v.url,
    v.url === '#' ? '데모' : (v.source === 'registered' ? '등록' : '실데이터'),
  ]);
  const csv = '﻿' + [header, ...rows]
    .map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))
    .join('\r\n');
  const stamp = new Date().toISOString().slice(0, 10);
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="trend-radar-${stamp}.csv"`);
  res.send(csv);
});

// 썸네일 프록시 (유튜브·틱톡 CDN 화이트리스트) — 클라이언트 환경의 외부 요청 제한을 우회
app.get('/api/thumb', async (req, res) => {
  const url = String(req.query.url || '');
  // 알려진 미디어 CDN만 허용 (유튜브·틱톡·인스타그램/스레드)
  if (!/^https:\/\/([\w-]+\.)*(ytimg\.com|tiktokcdn[\w.-]*\.com|cdninstagram\.com|fbcdn\.net)\//.test(url)) {
    return res.status(400).end();
  }
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.google.com/' } });
    if (!r.ok) return res.status(502).end();
    res.set('Content-Type', r.headers.get('content-type') || 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(Buffer.from(await r.arrayBuffer()));
  } catch {
    res.status(502).end();
  }
});

// 콘텐츠 아이디어 (분석 기반, 키 불필요) — 공유·좋아요 잘 되는 형식·주제 역산
app.get('/api/ideas', (req, res) => {
  const goal = req.query.goal === '공유' ? '공유' : '좋아요';
  const videos = filtered(req.query); // platform·category·q 필터 자동 적용
  res.json(generateIdeas(videos, { goal, limit: 8 }));
});

// AI 상태 (프론트가 버튼 활성/안내를 미리 표시) + yt-dlp(대본) 가용 여부
app.get('/api/ai-status', async (req, res) => {
  res.json({ ...aiInfo(), transcript: await ytDlpAvailable().catch(() => false) });
});

// AI 콘텐츠 아이디어 (선택) — ANTHROPIC_API_KEY 설정 시에만 활성
app.post('/api/ideas/ai', async (req, res) => {
  const goal = req.body?.goal === '공유' ? '공유' : '좋아요';
  const niche = String(req.body?.niche || req.body?.q || '').slice(0, 60);
  const videos = filtered({ platform: req.body?.platform, category: req.body?.category, q: niche });
  const ctx = ideaContext(videos, goal, niche);

  const prompt = `당신은 한국 SNS 숏폼 콘텐츠 전략가입니다. 아래는 지금 실제로 ${goal}가 잘 되는 영상들의 데이터입니다.\n` +
    `이 데이터를 근거로, ${niche ? `"${niche}" 분야` : '이 트렌드'}에서 ${goal}가 극대화되는 **새 콘텐츠 아이디어 5개**를 만들어 주세요.\n` +
    `각 아이디어는 반드시: 훅(첫 3초 대사), 제목, 한 줄 콘텐츠 개요, 추천 해시태그 3개, 왜 통하는지(근거 데이터 연결)를 포함하세요.\n\n` +
    `[실데이터]\n${JSON.stringify(ctx, null, 2)}`;

  const schema = {
    type: 'object', additionalProperties: false,
    properties: {
      ideas: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          properties: {
            hook: { type: 'string' }, title: { type: 'string' }, outline: { type: 'string' },
            hashtags: { type: 'array', items: { type: 'string' } }, why: { type: 'string' },
          },
          required: ['hook', 'title', 'outline', 'hashtags', 'why'],
        },
      },
    },
    required: ['ideas'],
  };

  const out = await callClaude(prompt, schema, { maxTokens: 2200, effort: 'low' });
  if (!out.enabled) return res.json({ enabled: false, message: out.message });
  if (out.error) return res.status(502).json({ enabled: true, error: out.error });
  res.json({ enabled: true, model: out.model, goal, niche, ideas: out.data.ideas || [] });
});

// 🔬 콘텐츠 해부 — 인기 콘텐츠의 구조·바이럴 요인을 AI가 분석
app.post('/api/deconstruct', async (req, res) => {
  if (!aiEnabled()) return res.json({ enabled: false, message: '무료 AI를 쓰려면 GEMINI_API_KEY(구글, 무료) 또는 OPENAI_API_KEY(Groq 등)를, 유료는 ANTHROPIC_API_KEY를 .env에 설정하세요.' });
  const key = String(req.body?.key || '');
  const v = store.getVideos().find(x => x.key === key);
  if (!v) return res.status(404).json({ error: '영상을 찾을 수 없습니다.' });

  const item = await analyzable(v, { withTranscript: true });
  const kind = isScriptPlatform(v.platform) ? '영상(대본형)' : '글(텍스트형)';
  const prompt =
    `당신은 한국 SNS 바이럴 콘텐츠 분석가입니다. 아래는 실제로 인기를 얻은 ${item.platform} ${kind} 콘텐츠와 그 지표입니다.\n` +
    `이 콘텐츠가 "왜" 좋아요·공유·조회가 잘 되었는지 구조적으로 해부해 주세요. ` +
    `${item.script ? '특히 script(실제 발화 대본)의 오프닝 훅·전개·마무리 구조를 문장 단위로 분석하고, ' : '제목/캡션/본문 텍스트와 지표를 근거로 '}` +
    `내가 같은 성공 요소를 재현할 수 있도록 실전 팁을 주세요. 추측이 아니라 주어진 텍스트·대본·지표에 근거하세요.\n` +
    `또한 바이럴 점수 3축(scores)을 채점하세요 — hook(첫 부분이 스크롤을 멈추게 하는 힘), flow(끝까지 보게 하는 전개·완급), trend(현재 트렌드·검증된 포맷과의 정합성). ` +
    `각 축은 0~99 정수이며, reason에는 반드시 이 콘텐츠의 실제 문장·지표를 인용한 근거를 쓰세요. 점수는 냉정하게: 평범하면 40~60, 뛰어나야 80+.\n\n` +
    `[콘텐츠 데이터]\n${JSON.stringify(item, null, 2)}`;

  const schema = {
    type: 'object', additionalProperties: false,
    properties: {
      summary: { type: 'string' },                       // 한 줄 핵심 요약
      hook: { type: 'object', additionalProperties: false,
        properties: { text: { type: 'string' }, type: { type: 'string' }, why: { type: 'string' } },
        required: ['text', 'type', 'why'] },              // 훅 분석
      structure: { type: 'array', items: { type: 'object', additionalProperties: false,
        properties: { part: { type: 'string' }, detail: { type: 'string' } }, required: ['part', 'detail'] } },
      viralFactors: { type: 'array', items: { type: 'object', additionalProperties: false,
        properties: { factor: { type: 'string' }, detail: { type: 'string' } }, required: ['factor', 'detail'] } },
      targetEmotion: { type: 'string' },                 // 겨냥한 감정/심리
      formula: { type: 'string' },                       // 재현 공식 한 문장
      applyTips: { type: 'array', items: { type: 'string' } }, // 내 콘텐츠 적용법
      scores: { type: 'object', additionalProperties: false,  // 바이럴 3축 점수 (Opus Clip 방식)
        properties: {
          hook: { type: 'object', additionalProperties: false,
            properties: { score: { type: 'integer' }, reason: { type: 'string' } }, required: ['score', 'reason'] },
          flow: { type: 'object', additionalProperties: false,
            properties: { score: { type: 'integer' }, reason: { type: 'string' } }, required: ['score', 'reason'] },
          trend: { type: 'object', additionalProperties: false,
            properties: { score: { type: 'integer' }, reason: { type: 'string' } }, required: ['score', 'reason'] },
        },
        required: ['hook', 'flow', 'trend'] },
    },
    required: ['summary', 'hook', 'structure', 'viralFactors', 'targetEmotion', 'formula', 'applyTips', 'scores'],
  };

  const out = await callClaude(prompt, schema, { maxTokens: 2500, effort: 'medium' });
  if (!out.enabled) return res.json({ enabled: false, message: out.message });
  if (out.error) return res.status(502).json({ enabled: true, error: out.error });
  res.json({ enabled: true, model: out.model, video: { key: v.key, title: v.title, platform: v.platform, url: v.url }, analysis: out.data });
});

// ✍️ 콘텐츠 스튜디오 — 내 주제/초안 + 참고 인기 콘텐츠 → 대본 생성 또는 내 글 바이럴 변환
app.post('/api/studio', async (req, res) => {
  if (!aiEnabled()) return res.json({ enabled: false, message: '무료 AI를 쓰려면 GEMINI_API_KEY(구글, 무료) 또는 OPENAI_API_KEY(Groq 등)를, 유료는 ANTHROPIC_API_KEY를 .env에 설정하세요.' });
  const mode = req.body?.mode === 'rewrite' ? 'rewrite' : 'create';
  const platform = ['youtube', 'tiktok', 'instagram', 'threads'].includes(req.body?.platform) ? req.body.platform : 'threads';
  const topic = String(req.body?.topic || '').slice(0, 400);
  const draft = String(req.body?.draft || '').slice(0, 2000);
  const refKeys = Array.isArray(req.body?.referenceKeys) ? req.body.referenceKeys.slice(0, 4) : [];

  if (mode === 'create' && !topic) return res.status(400).json({ error: '주제나 간단한 내용을 입력해 주세요.' });
  if (mode === 'rewrite' && !draft) return res.status(400).json({ error: '변환할 내 글/초안을 입력해 주세요.' });

  // 참고 콘텐츠: 지정된 것 우선. 없으면 주제와 관련된 인기작을 우선 선택(관련 없으면 상위 인기작).
  let refs = store.getVideos().filter(x => refKeys.includes(x.key));
  if (!refs.length) {
    const words = (topic + ' ' + draft).toLowerCase().split(/[\s,·]+/).filter(w => w.length >= 2);
    const cand = withMetrics(store.getVideos().filter(x => x.platform === platform && x.views > 0));
    const relevance = v => {
      const t = `${v.title} ${v.category} ${(v.hashtags || []).join(' ')}`.toLowerCase();
      return words.reduce((n, w) => n + (t.includes(w) ? 1 : 0), 0);
    };
    refs = cand
      .map(v => ({ v, rel: relevance(v) }))
      .sort((a, b) => (b.rel - a.rel) || (b.v.engagementRate - a.v.engagementRate))
      .slice(0, 3).map(x => x.v);
  }
  const refData = await Promise.all(refs.map(r => analyzable(r, { withTranscript: true })));
  const scriptMode = isScriptPlatform(platform);
  const outType = scriptMode ? '영상 대본' : '게시글';

  let prompt, schema;
  if (mode === 'create') {
    prompt =
      `당신은 한국 SNS 바이럴 ${outType} 작가입니다. 아래 [참고 인기 콘텐츠]는 지금 ${PLATFORM_LABEL[platform]}에서 실제로 잘 되는 콘텐츠와 지표입니다.\n` +
      `이들의 훅·구조·성공 패턴을 흡수해서, 제가 주는 [내 주제]로 ${PLATFORM_LABEL[platform]}용 ${outType}을 완성해 주세요.\n` +
      (scriptMode
        ? `숏폼 기준으로 첫 3초 훅부터 마지막 CTA까지 실제로 촬영·낭독할 수 있는 대본을 쓰세요. 장면/자막 지시를 대괄호로 넣어도 됩니다.\n`
        : `스레드/인스타 글 형식으로, 스크롤을 멈추게 하는 첫 문장부터 저장·공유를 부르는 마무리까지 바로 올릴 수 있는 완성된 글을 쓰세요.\n`) +
      `참고 콘텐츠를 베끼지 말고 성공 "구조"만 적용하세요.\n\n` +
      `[내 주제]\n${topic}\n\n[참고 인기 콘텐츠]\n${JSON.stringify(refData, null, 2)}`;
    schema = {
      type: 'object', additionalProperties: false,
      properties: {
        title: { type: 'string' },
        hook: { type: 'string' },
        body: { type: 'string' },        // 대본 전문 또는 글 전문
        hashtags: { type: 'array', items: { type: 'string' } },
        cta: { type: 'string' },
        tips: { type: 'array', items: { type: 'string' } },  // 이 콘텐츠를 더 잘 되게 하는 팁
        appliedPatterns: { type: 'array', items: { type: 'string' } }, // 참고작에서 가져온 성공 패턴
      },
      required: ['title', 'hook', 'body', 'hashtags', 'cta', 'tips', 'appliedPatterns'],
    };
  } else {
    prompt =
      `당신은 한국 SNS 바이럴 카피 편집자입니다. 아래 [참고 인기 콘텐츠]는 지금 ${PLATFORM_LABEL[platform]}에서 잘 되는 콘텐츠입니다.\n` +
      `제가 쓴 [내 초안]을, 참고작의 훅·구조·심리 자극을 적용해 ${PLATFORM_LABEL[platform]}에서 좋아요·공유가 잘 되도록 다시 써 주세요.\n` +
      `원래 메시지·사실은 유지하되 표현·구조·훅을 바이럴하게 바꾸고, 무엇을 왜 바꿨는지 알려주세요.\n\n` +
      `[내 초안]\n${draft}\n\n[참고 인기 콘텐츠]\n${JSON.stringify(refData, null, 2)}`;
    schema = {
      type: 'object', additionalProperties: false,
      properties: {
        rewritten: { type: 'string' },   // 바이럴하게 다시 쓴 글/대본
        hook: { type: 'string' },
        hashtags: { type: 'array', items: { type: 'string' } },
        changes: { type: 'array', items: { type: 'object', additionalProperties: false,
          properties: { change: { type: 'string' }, why: { type: 'string' } }, required: ['change', 'why'] } },
      },
      required: ['rewritten', 'hook', 'hashtags', 'changes'],
    };
  }

  const out = await callClaude(prompt, schema, { maxTokens: 3200, effort: 'medium' });
  if (!out.enabled) return res.json({ enabled: false, message: out.message });
  if (out.error) return res.status(502).json({ enabled: true, error: out.error });
  res.json({
    enabled: true, model: out.model, mode, platform,
    references: refs.map(r => ({ key: r.key, title: r.title, platform: r.platform, url: r.url })),
    result: out.data,
  });
});

// 📡 채널 분석 — 구독자·최근 영상·중앙값·영상별 아웃라이어 배수 (키 불필요)
app.get('/api/channel', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: '채널 @핸들 또는 URL을 입력해 주세요.' });
  try {
    const p = await fetchChannelProfile(q);
    store.upsertChannel(p.handle || q, p);
    const withOutlier = list => list.map(v => ({
      ...v,
      outlier: p.medianViews || p.medianShorts
        ? { mult: +(v.views / ((list === p.shorts ? p.medianShorts : p.medianViews) || p.medianViews || p.medianShorts)).toFixed(1) }
        : null,
      url: `https://www.youtube.com/watch?v=${v.id}`,
      thumbnail: `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`,
    }));
    res.json({
      handle: p.handle, name: p.name, subscribers: p.subscribers,
      medianViews: p.medianViews, medianShorts: p.medianShorts,
      videos: withOutlier(p.videos), shorts: withOutlier(p.shorts),
      fetchedAt: p.fetchedAt,
    });
  } catch (e) {
    res.status(502).json({ error: `채널을 불러오지 못했습니다: ${e.message}` });
  }
});

// 수집 실행 (수동 트리거)
app.post('/api/collect', async (req, res) => {
  try {
    const result = await collectAll();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 영상 URL 등록 (유튜브·틱톡·인스타그램·스레드, API 키 불필요)
app.post('/api/register', async (req, res) => {
  const urls = Array.isArray(req.body?.urls)
    ? req.body.urls
    : String(req.body?.urls || '').split(/\s+/);
  if (!urls.filter(u => u.trim()).length) {
    return res.status(400).json({ error: 'URL을 입력해 주세요.' });
  }
  try {
    const { videos, errors } = await registerUrls(urls);
    const classified = videos.map(v => ({ ...v, category: classifyVideo(v) }));
    if (classified.length) store.upsertVideos(classified);
    res.json({ registered: classified.length, errors });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const INTERVAL_MIN = Number(process.env.COLLECT_INTERVAL_MIN || 60);
let schedulerStartedAt = null;

function nextAutoCollectAt() {
  if (!schedulerStartedAt) return null;
  const intervalMs = INTERVAL_MIN * 60_000;
  const elapsed = Date.now() - schedulerStartedAt;
  const k = Math.floor(elapsed / intervalMs) + 1;
  return new Date(schedulerStartedAt + k * intervalMs).toISOString();
}

async function start() {
  await store.load(); // 저장소(파일 또는 Supabase) 로드 후 기동
  app.listen(PORT, async () => {
    console.log(`TrendRadar 실행: http://localhost:${PORT} · 저장소: ${store.storageMode()}`);
    // 데이터가 없으면 최초 실데이터 수집
    if (store.getVideos().length === 0) {
      console.log('초기 데이터 수집 중...');
      const r = await collectAll();
      console.log('초기 수집 완료:', JSON.stringify(r.sources), Object.keys(r.errors).length ? JSON.stringify(r.errors) : '');
    }
    // 자동 수집: 기본 60분 간격
    schedulerStartedAt = Date.now();
    setInterval(() => collectAll().catch(e => console.error('수집 실패:', e.message)), INTERVAL_MIN * 60_000);
  });
}

// 종료 시그널에 데이터 즉시 저장 (배포 재시작 대비)
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, async () => { await store.flushNow(); process.exit(0); });
}

start();
