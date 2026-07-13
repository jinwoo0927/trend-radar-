// 수집 오케스트레이터: 플랫폼별 수집기를 실행하고 분류 후 저장한다.
// 실데이터 우선 원칙:
//   - 유튜브: ① 공식 Data API(키 설정 시) → ② 공개 인기 페이지 파싱(키 불필요). 자동 수집.
//   - 틱톡/인스타그램/스레드: 트렌딩 자동 크롤링은 서명된 XHR·로그인 벽·약관으로 불가.
//     → URL 등록(register.js)으로 개별 영상의 실지표를 수집.
//   - 데모 데이터는 기본 비활성(DEMO_DATA=1 일 때만 생성). 가짜가 실제 트렌드로 표시되지 않도록.
import { collectYoutube } from './youtube.js';
import { collectYoutubeWeb } from './youtube-web.js';
import { generateDemoVideos, evolveDemoVideos } from './demo.js';
import { classify } from '../classify.js';
import * as store from '../store.js';

let demoTick = 0;

const isDemo = v => v.url === '#';
// 데모는 명시적 opt-in(DEMO_DATA=1|true)일 때만. 기본은 100% 실데이터.
const DEMO_ENABLED = /^(1|true|yes)$/i.test(process.env.DEMO_DATA || '');

export async function collectAll({ demoOnly = false } = {}) {
  const startedAt = Date.now();
  const apiKey = process.env.YOUTUBE_API_KEY;
  const results = { collected: 0, sources: {}, errors: {} };

  let videos = [];
  let youtubeLive = false;

  if (!demoOnly) {
    // 1) 유튜브 공식 API (키가 있을 때)
    if (apiKey) {
      try {
        const yt = await collectYoutube({ apiKey, regionCode: process.env.YOUTUBE_REGION || 'KR' });
        if (yt) {
          videos.push(...yt);
          youtubeLive = true;
          results.sources.youtube = `실데이터 ${yt.length}건 (공식 Data API)`;
        }
      } catch (e) {
        results.errors.youtubeApi = e.message;
      }
    }
    // 2) 키가 없거나 실패하면 공개 인기 페이지 파싱
    if (!youtubeLive) {
      try {
        const yt = await collectYoutubeWeb();
        videos.push(...yt);
        youtubeLive = true;
        results.sources.youtube = `실데이터 ${yt.length}건 (주간 인기 공개 검색, API 키 불필요)`;
      } catch (e) {
        results.errors.youtubeWeb = e.message;
      }
    }
    // 실데이터 확보 시 남아있던 유튜브 데모 영상 제거
    if (youtubeLive) store.removeWhere(v => v.platform === 'youtube' && isDemo(v));
  }

  // 3) 데모 데이터: 명시적으로 켠 경우에만 생성/성장
  const hasLiveYoutubeStored = store.getVideos().some(v => v.platform === 'youtube' && !isDemo(v));
  if (DEMO_ENABLED) {
    const needDemoYoutube = !youtubeLive && !hasLiveYoutubeStored;
    const existing = store.getVideos().filter(isDemo);
    let demo = existing.length ? evolveDemoVideos(existing, ++demoTick) : generateDemoVideos();
    if (!needDemoYoutube) demo = demo.filter(v => v.platform !== 'youtube');
    videos.push(...demo);
    for (const p of ['tiktok', 'instagram', 'threads', ...(needDemoYoutube ? ['youtube'] : [])]) {
      results.sources[p] ??= '데모(샘플) 데이터 — DEMO_DATA=1';
    }
  } else {
    // 데모 꺼짐: 혹시 남아있는 데모 영상 제거해 대시보드를 100% 실데이터로 유지
    store.removeWhere(isDemo);
    for (const p of ['tiktok', 'instagram', 'threads']) {
      results.sources[p] ??= 'URL 등록으로 실지표 수집';
    }
  }

  // 4) 분류 후 저장
  videos = videos.map(v => ({ ...v, category: v.category || classify(v) }));
  if (videos.length) store.upsertVideos(videos);
  const anyLive = youtubeLive || hasLiveYoutubeStored;
  store.setMode(anyLive ? 'live' : 'empty');
  results.collected = videos.length;
  store.addCollectLog({
    at: new Date().toISOString(),
    collected: videos.length,
    live: videos.filter(v => !isDemo(v)).length,
    sources: results.sources,
    errors: results.errors,
    durationMs: Date.now() - startedAt,
  });
  return results;
}
