// 유튜브 공식 Data API v3 수집기 (mostPopular 차트)
// .env 에 YOUTUBE_API_KEY 를 설정하면 실데이터가 수집된다.
const API = 'https://www.googleapis.com/youtube/v3/videos';

export async function collectYoutube({ apiKey, regionCode = 'KR', maxResults = 50 }) {
  if (!apiKey) return null;

  const url = new URL(API);
  url.search = new URLSearchParams({
    part: 'snippet,statistics',
    chart: 'mostPopular',
    regionCode,
    maxResults: String(maxResults),
    key: apiKey,
  }).toString();

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`YouTube API ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = await res.json();

  return (json.items || []).map(item => ({
    id: item.id,
    platform: 'youtube',
    title: item.snippet.title,
    channel: item.snippet.channelTitle,
    description: (item.snippet.description || '').slice(0, 300),
    hashtags: (item.snippet.tags || []).slice(0, 10),
    youtubeCategoryId: item.snippet.categoryId,
    publishedAt: item.snippet.publishedAt,
    thumbnail: item.snippet.thumbnails?.medium?.url || '',
    url: `https://www.youtube.com/watch?v=${item.id}`,
    views: Number(item.statistics.viewCount || 0),
    likes: Number(item.statistics.likeCount || 0),
    comments: Number(item.statistics.commentCount || 0),
    shares: 0, // 유튜브 API는 공유 수를 제공하지 않음
  }));
}
