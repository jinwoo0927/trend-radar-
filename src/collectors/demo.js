// 데모 데이터 엔진.
// 틱톡·인스타그램·스레드는 공개 트렌딩 API가 없어(공식 API는 승인·본인 계정 데이터 중심),
// API 자격이 준비되기 전까지 현실적인 분포의 데모 데이터로 전체 파이프라인이 즉시 작동하게 한다.
// 수집을 반복 실행하면 기존 영상 지표가 성장해 시계열(급상승) 분석까지 시연된다.

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TOPICS = [
  { cat: '뷰티', items: ['물광 메이크업 5분 완성', '올리브영 세일 하울 추천템 총정리', '지성 피부 스킨케어 루틴', 'GRWM 데일리 메이크업', '퍼스널컬러별 립 추천'], tags: ['메이크업', '뷰티', '스킨케어', 'grwm', '올리브영'] },
  { cat: '패션', items: ['여름 코디 lookbook 5가지 스타일', '무신사 하울 20만원 챌린지', '키 작은 남자 코디 공식', '빈티지 쇼핑 브이로그', 'OOTD 일주일 챌린지'], tags: ['패션', '코디', 'ootd', '하울', '룩북'] },
  { cat: '푸드', items: ['편의점 신상 먹방 솔직리뷰', '자취생 5분 레시피 계란볶음밥', '성수동 카페 투어', '마라탕 먹방 도전', '에어프라이어 디저트 레시피'], tags: ['먹방', '레시피', '맛집', '카페', '요리'] },
  { cat: '테크·IT', items: ['아이폰 신형 언박싱 첫인상', 'AI로 업무 자동화하는 법', '갤럭시 vs 아이폰 카메라 비교', '개발자 데스크 셋업 투어', '무료 AI 툴 5가지 추천'], tags: ['테크', 'ai', '언박싱', '아이폰', '갤럭시'] },
  { cat: '게임', items: ['롤 챌린저의 라인전 기초', '발로란트 에임 연습법', '마인크래프트 건축 타임랩스', '스팀 할인 게임 추천', '게임 몰입 브이로그'], tags: ['게임', '롤', '발로란트', '마인크래프트', '스팀'] },
  { cat: '음악·댄스', items: ['신곡 댄스 챌린지 안무 배우기', '노래 커버 라이브 버전', 'K-POP 플레이리스트 출근용', '아이돌 안무 거울모드', '버스킹 현장 직캠'], tags: ['댄스', '챌린지', 'kpop', '커버', '플레이리스트'] },
  { cat: '운동·건강', items: ['홈트 10분 전신 루틴', '다이어트 식단 일주일 브이로그', '러닝 초보 가이드', '헬스장 등 운동 루틴', '아침 요가 스트레칭'], tags: ['홈트', '운동', '다이어트', '헬스', '러닝'] },
  { cat: '여행', items: ['제주 2박3일 여행 코스 총정리', '유럽 배낭여행 경비 공개', '캠핑 브이로그 감성 세팅', '일본 소도시 여행 추천', '호캉스 룸투어'], tags: ['여행', '제주', '캠핑', '유럽', '브이로그'] },
  { cat: '교육·지식', items: ['영어 회화 패턴 30개 암기법', '경제 뉴스 5분 요약', '역사 속 오늘의 사건', '공부 자극 스터디윗미', '책 요약 인생을 바꾼 습관'], tags: ['공부', '영어', '경제', '지식', '책'] },
  { cat: '엔터테인먼트', items: ['웃긴 순간 모음 리액션', '드라마 명장면 하이라이트', '몰카 복수전 레전드', '영화 결말 해석', '밈 근황 총정리'], tags: ['예능', '리액션', '드라마', '영화', '밈'] },
  { cat: '브이로그·라이프', items: ['자취방 인테리어 전후 비교', '고양이와 사는 일상 브이로그', '갓생 모닝루틴 6시 기상', '주말 청소 리셋 브이로그', '반려견 산책 일상'], tags: ['브이로그', '일상', '자취', '고양이', '루틴'] },
  { cat: '비즈니스·마케팅', items: ['SNS 마케팅으로 월 매출 3배 만든 법', '부업으로 시작하는 스마트스토어', '브랜딩 잘하는 브랜드 분석', '재테크 초보 포트폴리오', '광고 없이 팔리는 콘텐츠 공식'], tags: ['마케팅', '부업', '브랜딩', '재테크', '창업'] },
];

const CHANNELS = ['크리에이터랩', '데일리무드', '트렌드픽', '소소한스튜디오', '하이라이트TV', '모먼트로그', '캐치업', '온에어클립', '루틴메이커', '픽미디어'];

// 플랫폼별 지표 스케일(플랫폼 특성 반영: 틱톡은 공유↑, 인스타는 좋아요↑, 스레드는 규모↓·댓글 비중↑)
const PLATFORM_PROFILE = {
  youtube:   { viewScale: 900_000, likeRate: 0.035, commentRate: 0.004, shareRate: 0.002 },
  tiktok:    { viewScale: 1_400_000, likeRate: 0.08, commentRate: 0.005, shareRate: 0.015 },
  instagram: { viewScale: 600_000, likeRate: 0.09, commentRate: 0.006, shareRate: 0.008 },
  threads:   { viewScale: 120_000, likeRate: 0.05, commentRate: 0.012, shareRate: 0.01 },
};

export function generateDemoVideos() {
  const rand = mulberry32(20260707);
  const videos = [];
  const platforms = Object.keys(PLATFORM_PROFILE);

  for (const platform of platforms) {
    const p = PLATFORM_PROFILE[platform];
    for (const topic of TOPICS) {
      // 플랫폼×분야당 2~3개
      const n = 2 + Math.floor(rand() * 2);
      for (let i = 0; i < n; i++) {
        const title = topic.items[Math.floor(rand() * topic.items.length)];
        const heat = Math.pow(rand(), 1.6); // 소수의 대박 영상, 다수의 평범한 영상
        const views = Math.max(3000, Math.round(p.viewScale * heat * (0.3 + rand())));
        const daysAgo = 1 + Math.floor(rand() * 13);
        const id = `${platform.slice(0, 2)}-${topic.cat}-${i}-${Math.floor(rand() * 1e6)}`;
        videos.push({
          id,
          platform,
          title,
          channel: CHANNELS[Math.floor(rand() * CHANNELS.length)],
          description: `${topic.cat} 관련 인기 콘텐츠`,
          hashtags: topic.tags.slice(0, 3 + Math.floor(rand() * 3)),
          publishedAt: new Date(Date.now() - daysAgo * 86400_000).toISOString(),
          thumbnail: '',
          url: '#',
          views,
          likes: Math.round(views * p.likeRate * (0.6 + rand() * 0.8)),
          comments: Math.round(views * p.commentRate * (0.6 + rand() * 0.8)),
          shares: Math.round(views * p.shareRate * (0.6 + rand() * 0.8)),
        });
      }
    }
  }
  return videos;
}

// 재수집 시 기존 데모 영상의 지표를 성장시켜 시계열 데이터를 만든다.
// 일부 영상은 '급상승'으로 크게 점프한다.
export function evolveDemoVideos(existing, tick) {
  const rand = mulberry32(987654 + tick * 7919);
  return existing.map(v => {
    const isViral = rand() < 0.12;
    const growth = isViral ? 1.15 + rand() * 0.6 : 1.01 + rand() * 0.07;
    return {
      ...v,
      views: Math.round(v.views * growth),
      likes: Math.round(v.likes * (growth * (0.95 + rand() * 0.1))),
      comments: Math.round(v.comments * (growth * (0.9 + rand() * 0.2))),
      shares: Math.round((v.shares || 0) * (growth * (0.9 + rand() * 0.3))),
    };
  });
}
