// 제목·해시태그·설명 텍스트 기반 분야 자동 분류기.
// 유튜브는 categoryId도 함께 참고하고, 그 외 플랫폼은 키워드 매칭으로 분류한다.

export const CATEGORIES = [
  '뷰티', '패션', '푸드', '테크·IT', '게임', '음악·댄스',
  '운동·건강', '여행', '교육·지식', '엔터테인먼트', '브이로그·라이프', '비즈니스·마케팅',
];

const KEYWORDS = {
  '뷰티': ['메이크업', '화장', '스킨케어', '뷰티', '코스메틱', '립', '파운데이션', '헤어', '네일', 'makeup', 'beauty', 'skincare', 'grwm'],
  '패션': ['패션', '코디', '옷', '스타일링', '룩북', '하울', 'ootd', 'fashion', 'outfit', 'lookbook', '스트릿'],
  '푸드': ['먹방', '레시피', '요리', '맛집', '음식', '디저트', '카페', '쿠킹', 'mukbang', 'food', 'recipe', 'cooking', '베이킹'],
  '테크·IT': ['아이폰', '갤럭시', '언박싱', '리뷰', 'ai', '인공지능', '개발', '코딩', '테크', 'tech', 'iphone', 'gadget', '노트북', '앱'],
  '게임': ['게임', '롤', '배그', '마인크래프트', '발로란트', '플레이', 'game', 'gaming', 'lol', 'valorant', '스팀'],
  '음악·댄스': ['커버', '노래', '음악', '댄스', '안무', '챌린지', 'kpop', 'dance', 'music', 'cover', '플레이리스트', '아이돌'],
  '운동·건강': ['운동', '헬스', '홈트', '다이어트', '요가', '필라테스', '러닝', 'workout', 'fitness', 'gym', '루틴', '건강'],
  '여행': ['여행', '브이로그 여행', '해외', '국내여행', '캠핑', '호캉스', 'travel', 'trip', '제주', '유럽', '배낭'],
  '교육·지식': ['공부', '영어', '강의', '지식', '역사', '과학', '경제', '책', 'study', '상식', '설명', '요약', '인사이트'],
  '엔터테인먼트': ['예능', '웃긴', '몰카', '개그', '리액션', '드라마', '영화', 'funny', 'prank', '하이라이트', '밈', '짤'],
  '브이로그·라이프': ['브이로그', '일상', '루틴 브이로그', 'vlog', 'daily', '자취', '인테리어', '반려', '고양이', '강아지'],
  '비즈니스·마케팅': ['마케팅', '창업', '부업', '수익', '재테크', '주식', '브랜딩', '사업', 'marketing', 'business', '자기계발', '광고'],
};

// 유튜브 공식 categoryId → 분야 매핑(보조 신호)
const YT_CATEGORY_MAP = {
  '10': '음악·댄스', '20': '게임', '17': '운동·건강', '19': '여행',
  '26': '뷰티', '27': '교육·지식', '28': '테크·IT', '23': '엔터테인먼트',
  '24': '엔터테인먼트', '22': '브이로그·라이프',
};

// 매칭 실패 시 null 반환 (수집 시드의 분야 힌트로 대체할 수 있게)
export function classifyOrNull(video) {
  const text = [video.title, video.description, (video.hashtags || []).join(' ')]
    .join(' ')
    .toLowerCase();

  let best = null;
  let bestScore = 0;
  for (const [category, words] of Object.entries(KEYWORDS)) {
    let score = 0;
    for (const w of words) {
      if (text.includes(w.toLowerCase())) score += w.length >= 3 ? 2 : 1;
    }
    if (score > bestScore) { bestScore = score; best = category; }
  }

  if (!best && video.platform === 'youtube' && YT_CATEGORY_MAP[video.youtubeCategoryId]) {
    best = YT_CATEGORY_MAP[video.youtubeCategoryId];
  }
  return best;
}

export function classify(video) {
  return classifyOrNull(video) || video.categoryHint || '엔터테인먼트';
}
