const state = { platform: 'all', category: 'all', sort: 'views', q: '', limit: 50, ideaGoal: '좋아요', ideaNiche: '' };
const charts = {};
let nextCollectAt = null;

const PLATFORM_LABEL = { youtube: '유튜브', tiktok: '틱톡', instagram: '인스타그램', threads: '스레드' };
const PLATFORM_COLOR = { youtube: '#ff4e45', tiktok: '#25d0ca', instagram: '#e1306c', threads: '#8b94a8' };

const fmt = n => {
  if (n >= 100_000_000) return (n / 100_000_000).toFixed(1) + '억';
  if (n >= 10_000) return (n / 10_000).toFixed(1) + '만';
  return n.toLocaleString('ko-KR');
};
const pct = x => (x * 100).toFixed(2) + '%';
const d2 = n => String(n).padStart(2, '0');
const fmtDate = iso => {
  if (!iso) return '–';
  const d = new Date(iso);
  if (isNaN(d)) return '–';
  return `${d.getFullYear()}.${d2(d.getMonth() + 1)}.${d2(d.getDate())}`;
};
const fmtDateTime = iso => {
  if (!iso) return '–';
  const d = new Date(iso);
  if (isNaN(d)) return '–';
  return `${fmtDate(iso)} ${d2(d.getHours())}:${d2(d.getMinutes())}`;
};
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

Chart.defaults.color = '#8b94a8';
Chart.defaults.borderColor = '#262f45';
Chart.defaults.font.family = "'Pretendard', 'Malgun Gothic', sans-serif";

async function fetchJSON(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

function query() {
  return new URLSearchParams({
    platform: state.platform, category: state.category, sort: state.sort, q: state.q,
  });
}

let lastVideos = [];

async function refresh() {
  const [dash, videos] = await Promise.all([
    fetchJSON('/api/dashboard?' + query()),
    fetchJSON('/api/videos?' + query() + '&limit=' + state.limit),
  ]);
  lastVideos = videos;
  renderMeta(dash.meta);
  renderKPI(dash.summary);
  renderCategoryOptions(dash.categories);
  renderCards(videos.slice(0, 12));
  renderInsights(dash.insights);
  renderCategoryChart(dash.categoryStats);
  renderPlatformChart(dash.platformStats);
  renderEngagementChart(dash.categoryStats);
  renderTimelineChart(dash.timeline);
  renderGrowthChart(dash.growth);
  renderKeywords(dash.keywords);
  renderTable(videos);
  renderCollectLog(dash.collectLog);
  renderIdeas();

  // 섹션별 수집 기준일 표시
  const stamp = dash.meta.lastCollectedAt ? fmtDateTime(dash.meta.lastCollectedAt) + ' 수집분' : '';
  document.getElementById('preview-date').textContent = stamp;
  document.getElementById('insight-date').textContent = stamp;
  document.getElementById('rank-count').textContent =
    `${videos.length}개 표시 (전체 ${dash.summary.videoCount}개)` + (state.q ? ` · 검색: "${state.q}"` : '');
}

function renderMeta(meta) {
  const badge = document.getElementById('mode-badge');
  if (meta.mode === 'live' || meta.mode === 'hybrid') {
    badge.textContent = '● 실데이터 수집 중 (유튜브 자동 · 틱톡/인스타/스레드 URL 등록)';
    badge.classList.add('live');
  } else {
    badge.textContent = '실데이터 없음 — "지금 수집"으로 유튜브 수집 또는 URL 등록';
    badge.classList.remove('live');
  }
  document.getElementById('last-collected').textContent =
    meta.lastCollectedAt ? '마지막 수집: ' + fmtDateTime(meta.lastCollectedAt) : '';
  nextCollectAt = meta.nextAutoCollectAt || null;
  tickCountdown();
}

// 다음 자동 수집까지 남은 시간 (1초마다 갱신)
function tickCountdown() {
  const el = document.getElementById('next-collect');
  if (!nextCollectAt) { el.textContent = ''; return; }
  const remain = Math.max(0, new Date(nextCollectAt) - Date.now());
  const m = Math.floor(remain / 60000), s = Math.floor((remain % 60000) / 1000);
  el.textContent = `다음 자동 수집: ${m}분 ${d2(s)}초 후`;
}
setInterval(tickCountdown, 1000);

function renderKPI(s) {
  document.getElementById('kpi-count').textContent = s.videoCount.toLocaleString('ko-KR') + '개';
  document.getElementById('kpi-count-sub').textContent =
    `실데이터 ${s.liveCount} · 데모 ${s.demoCount}` + (s.registeredCount ? ` · URL등록 ${s.registeredCount}` : '');

  document.getElementById('kpi-views').textContent = fmt(s.totalViews);
  const vs = document.getElementById('kpi-views-sub');
  if (s.viewsDelta !== null && s.viewsDelta !== undefined) {
    const up = s.viewsDelta >= 0;
    vs.innerHTML = `이전 수집 대비 <span class="${up ? 'up' : 'down'}">${up ? '▲' : '▼'} ${Math.abs(s.viewsDelta).toFixed(1)}%</span>`;
  } else {
    vs.textContent = '증감 비교는 2회 수집 후 표시';
  }

  document.getElementById('kpi-eng').textContent = pct(s.avgEngagement);
  document.getElementById('kpi-eng-sub').textContent =
    `좋아요 ${fmt(s.totalLikes)} · 댓글 ${fmt(s.totalComments)} · 공유 ${fmt(s.totalShares)}`;

  document.getElementById('kpi-rising').textContent = s.risingCount + '개 🔥';
  document.getElementById('kpi-rising-sub').textContent = '직전 수집 대비 조회수 성장률 기준';
}

function renderCategoryOptions(categories) {
  const sel = document.getElementById('category-filter');
  if (sel.options.length > 1) return; // 최초 1회만
  for (const c of categories) {
    const opt = document.createElement('option');
    opt.value = c; opt.textContent = c;
    sel.appendChild(opt);
  }
}

function renderInsights(items) {
  document.getElementById('insights').innerHTML = items
    .map(t => `<li>${esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/「(.+?)」/g, '<b>「$1」</b>')}</li>`)
    .join('');
}

function upsertChart(id, config) {
  if (charts[id]) { charts[id].data = config.data; charts[id].update(); return; }
  charts[id] = new Chart(document.getElementById(id), config);
}

function renderCategoryChart(stats) {
  upsertChart('chart-category', {
    type: 'bar',
    data: {
      labels: stats.map(s => s.category),
      datasets: [{
        label: '조회수',
        data: stats.map(s => s.views),
        backgroundColor: 'rgba(91,140,255,0.75)',
        borderRadius: 6,
      }],
    },
    options: {
      indexAxis: 'y',
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ' ' + fmt(c.raw) + ' 회' } } },
      scales: { x: { ticks: { callback: v => fmt(v) } } },
    },
  });
}

function renderPlatformChart(stats) {
  upsertChart('chart-platform', {
    type: 'doughnut',
    data: {
      labels: stats.map(s => PLATFORM_LABEL[s.platform] || s.platform),
      datasets: [{
        data: stats.map(s => s.views),
        backgroundColor: stats.map(s => PLATFORM_COLOR[s.platform] || '#5b8cff'),
        borderColor: '#161b26',
        borderWidth: 3,
      }],
    },
    options: {
      plugins: {
        legend: { position: 'bottom' },
        tooltip: { callbacks: { label: c => ' ' + c.label + ': ' + fmt(c.raw) + ' 회' } },
      },
      cutout: '62%',
    },
  });
}

function renderEngagementChart(stats) {
  upsertChart('chart-engagement', {
    type: 'bar',
    data: {
      labels: stats.map(s => s.category),
      datasets: [{
        label: '평균 인게이지먼트율(%)',
        data: stats.map(s => +(s.avgEngagement * 100).toFixed(2)),
        backgroundColor: 'rgba(139,92,246,0.75)',
        borderRadius: 6,
      }],
    },
    options: {
      indexAxis: 'y',
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ' ' + c.raw + '%' } } },
      scales: { x: { ticks: { callback: v => v + '%' } } },
    },
  });
}

function renderTimelineChart(timeline) {
  upsertChart('chart-timeline', {
    type: 'line',
    data: {
      labels: timeline.map(t => fmtDateTime(t.at)),
      datasets: [{
        label: '전체 조회수',
        data: timeline.map(t => t.totalViews),
        borderColor: '#5b8cff',
        backgroundColor: 'rgba(91,140,255,0.15)',
        tension: 0.3,
        fill: true,
        pointRadius: 3,
      }],
    },
    options: {
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: {
          label: c => ` 조회수 ${fmt(c.raw)} (영상 ${timeline[c.dataIndex].count}개)`,
        } },
      },
      scales: { y: { ticks: { callback: v => fmt(v) } }, x: { ticks: { maxTicksLimit: 8, font: { size: 10 } } } },
    },
  });
}

function renderCollectLog(log) {
  document.getElementById('log-rows').innerHTML = (log || []).map(l => {
    const others = Object.entries(l.sources || {})
      .filter(([p]) => p !== 'youtube')
      .map(([p, desc]) => `${PLATFORM_LABEL[p] || p}: ${desc.startsWith('데모') ? '데모' : desc}`)
      .join(' · ');
    const errText = Object.keys(l.errors || {}).length ? ' ⚠' : '';
    return `<tr>
      <td>${fmtDateTime(l.at)}${errText}</td>
      <td class="num">${l.collected}</td>
      <td class="num">${l.live ?? '–'}</td>
      <td>${esc((l.sources || {}).youtube || '–')}</td>
      <td>${esc(others || '–')}</td>
      <td class="num">${l.durationMs != null ? (l.durationMs / 1000).toFixed(1) + '초' : '–'}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="6" class="muted">수집 이력이 아직 없습니다.</td></tr>';
}

function renderGrowthChart(series) {
  const palette = ['#5b8cff', '#8b5cf6', '#34d399', '#fbbf24', '#f472b6'];
  upsertChart('chart-growth', {
    type: 'line',
    data: {
      labels: (series[0]?.points || []).map(p =>
        new Date(p.at).toLocaleTimeString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })),
      datasets: series.map((s, i) => ({
        label: `[${PLATFORM_LABEL[s.platform] || s.platform}] ${s.title.slice(0, 22)}`,
        data: s.points.map(p => p.views),
        borderColor: palette[i % palette.length],
        backgroundColor: palette[i % palette.length] + '33',
        tension: 0.35,
        fill: false,
        pointRadius: 3,
      })),
    },
    options: {
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } },
      scales: { y: { ticks: { callback: v => fmt(v) } } },
    },
  });
}

function renderKeywords(keywords) {
  const max = Math.max(...keywords.map(k => k.score), 1);
  document.getElementById('keywords').innerHTML = keywords.map(k => {
    const size = 12 + (k.score / max) * 14;
    const active = state.q && k.keyword === state.q.toLowerCase() ? ' active' : '';
    return `<span class="kw${active}" data-kw="${esc(k.keyword)}"
      title="${k.platforms.map(p => PLATFORM_LABEL[p] || p).join(', ')}에서 등장 · 클릭하면 필터링">
      <span style="font-size:${size.toFixed(1)}px;font-weight:${k.score / max > 0.4 ? 700 : 400};">#${esc(k.keyword)}</span>
      <span class="kw-count">${k.count}</span>
    </span>`;
  }).join('');
}

const CAT_EMOJI = {
  '뷰티': '💄', '패션': '👗', '푸드': '🍜', '테크·IT': '📱', '게임': '🎮', '음악·댄스': '🎵',
  '운동·건강': '💪', '여행': '✈️', '교육·지식': '📚', '엔터테인먼트': '🎭', '브이로그·라이프': '🌿', '비즈니스·마케팅': '📈',
};

const PLATFORM_EMPTY = {
  tiktok: '틱톡은 트렌딩 자동 수집이 불가합니다. 상단에 틱톡 영상 URL을 등록하면 조회수·좋아요·댓글·공유·저장까지 실지표가 수집됩니다.',
  instagram: '인스타그램은 트렌딩 자동 수집이 불가합니다. 게시물/릴스 URL을 등록하면 좋아요·댓글·작성자·게시일이 수집됩니다.',
  threads: '스레드는 트렌딩 자동 수집이 불가합니다. 게시물 URL을 등록하면 작성자·본문이 수집됩니다.',
  youtube: '유튜브 실데이터가 아직 없습니다. "지금 수집"을 눌러 주간 인기 영상을 수집하세요.',
  all: '수집된 영상이 없습니다. "지금 수집"으로 유튜브 인기 영상을 가져오거나, 상단에 영상 URL을 등록하세요.',
};

function renderCards(videos) {
  if (!videos.length) {
    const msg = PLATFORM_EMPTY[state.platform] || PLATFORM_EMPTY.all;
    document.getElementById('cards').innerHTML = `<div class="empty-state">${esc(msg)}</div>`;
    return;
  }
  document.getElementById('cards').innerHTML = videos.map(v => {
    const isDemo = !v.url || v.url === '#';
    const thumbSrc = v.thumbnail ? '/api/thumb?url=' + encodeURIComponent(v.thumbnail) : '';
    const thumb = thumbSrc
      ? `<img src="${esc(thumbSrc)}" alt=""
           onerror="this.outerHTML='<span class=&quot;thumb-emoji&quot;>${CAT_EMOJI[v.category] || '🎬'}</span>'">`
      : `<span class="thumb-emoji">${CAT_EMOJI[v.category] || '🎬'}</span>`;
    return `<div class="card ${isDemo ? '' : 'clickable'}" data-key="${esc(v.key)}">
      <div class="thumb">
        ${thumb}
        <span class="pf-chip pf-badge pf-${v.platform}">${PLATFORM_LABEL[v.platform] || v.platform}</span>
        ${isDemo ? '<span class="demo-chip">데모</span>' : '<div class="play">▶️</div>'}
      </div>
      <div class="card-body">
        <div class="card-title" title="${esc(v.title)}">${esc(v.title)}</div>
        <div class="card-meta">
          <span>${esc(v.channel || '')}</span>
          <span>${v.views ? '조회 ' + fmt(v.views) : (v.likes ? '♥ ' + fmt(v.likes) : '')}</span>
        </div>
        <div class="card-meta">
          <span>게시 ${fmtDate(v.publishedAt) !== '–' ? fmtDate(v.publishedAt) : esc(v.publishedText || '–')}</span>
          <span>수집 ${fmtDateTime(v.updatedAt)}</span>
        </div>
      </div>
    </div>`;
  }).join('');
}

// 플랫폼별 공식 임베드 주소
function embedFor(v) {
  if (v.platform === 'youtube') return { src: `https://www.youtube-nocookie.com/embed/${v.id}?autoplay=1`, mode: 'wide' };
  if (v.platform === 'tiktok') return { src: `https://www.tiktok.com/embed/v2/${v.id}`, mode: 'vert' };
  if (v.platform === 'instagram') return { src: v.url.replace(/\/?$/, '/') + 'embed/', mode: 'vert' };
  if (v.platform === 'threads') return { src: v.url.replace(/\/$/, '') + '/embed', mode: 'vert' };
  return null;
}

function openModal(v) {
  const emb = embedFor(v);
  if (!emb) return;
  document.getElementById('modal-title').textContent = v.title;
  const box = document.getElementById('modal-embed');
  box.className = 'modal-embed ' + emb.mode;
  box.innerHTML = `<iframe src="${esc(emb.src)}" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`;
  document.getElementById('modal-link').href = v.url;
  document.getElementById('modal').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('modal').classList.add('hidden');
  document.getElementById('modal-embed').innerHTML = ''; // 재생 중지
}

function renderTable(videos) {
  if (!videos.length) {
    document.getElementById('video-rows').innerHTML =
      '<tr><td colspan="12" class="muted" style="text-align:center;padding:24px;">표시할 영상이 없습니다. 유튜브를 수집하거나 URL을 등록하세요.</td></tr>';
    return;
  }
  document.getElementById('video-rows').innerHTML = videos.map((v, i) => {
    const playable = v.url && v.url !== '#';
    return `
    <tr class="${playable ? 'playable' : ''}" data-key="${esc(v.key)}" ${playable ? 'title="클릭하면 미리보기 재생"' : ''}>
      <td>${i + 1}</td>
      <td class="title-cell">
        ${esc(v.title)}
        <div class="muted">${esc(v.channel || '')}
          <button class="deconstruct-btn" data-key="${esc(v.key)}" title="AI가 이 콘텐츠의 구조·성공요인 분석">🔬 해부</button>
        </div>
      </td>
      <td><span class="pf-badge pf-${v.platform}">${PLATFORM_LABEL[v.platform] || v.platform}</span></td>
      <td><span class="cat-badge">${esc(v.category)}</span></td>
      <td class="num">${fmt(v.views)}</td>
      <td class="num">${v.likes ? fmt(v.likes) : '–'}</td>
      <td class="num">${v.comments ? fmt(v.comments) : '–'}</td>
      <td class="num">${v.shares ? fmt(v.shares) : '–'}</td>
      <td class="num">${v.views ? pct(v.engagementRate) : '–'}</td>
      <td class="num">${v.risingScore > 15 ? `<span class="rise-badge">▲ ${v.risingScore.toFixed(0)}</span>` : v.risingScore.toFixed(0)}</td>
      <td>${fmtDate(v.publishedAt) !== '–' ? fmtDate(v.publishedAt) : esc(v.publishedText || '–')}</td>
      <td class="muted">${fmtDateTime(v.updatedAt)}</td>
    </tr>`;
  }).join('');
}

// ── 콘텐츠 아이디어 스튜디오 ──
async function renderIdeas() {
  const qs = new URLSearchParams({ platform: state.platform, category: state.category, q: state.ideaNiche, goal: state.ideaGoal });
  let d;
  try { d = await fetchJSON('/api/ideas?' + qs); } catch { return; }

  document.getElementById('idea-basis').textContent =
    `분석 대상: 조회수 있는 실영상 ${d.basis.ratedCount}개` +
    (state.ideaGoal === '공유' && !d.basis.hasShareData ? ' · ⚠ 공유수는 틱톡 URL 등록 시 더 정확해집니다' : '');

  document.getElementById('idea-formats').innerHTML = d.formats.map(f => {
    const pct = state.ideaGoal === '공유' ? f.avgSharePct : f.avgLikePct;
    return `<span class="fmt-chip"><b>${esc(f.name)}</b> ${pct.toFixed(1)}%<span class="fmt-n">·${f.count}편</span></span>`;
  }).join('') || '<span class="muted">형식 데이터가 부족합니다. 영상을 더 수집하거나 URL을 등록하세요.</span>';

  const cards = document.getElementById('idea-cards');
  if (!d.ideas.length) {
    cards.innerHTML = '<div class="ai-note">아이디어를 만들 실영상이 부족합니다. "지금 수집"으로 유튜브를 수집하거나 틱톡·인스타 URL을 등록하세요.</div>';
    return;
  }
  cards.innerHTML = d.ideas.map(i => {
    const ev = i.evidence.map(e => {
      const label = `${PLATFORM_LABEL[e.platform] || e.platform} · ${e.title.slice(0, 24)} (${(e.rate * 100).toFixed(1)}%)`;
      return e.url && e.url !== '#'
        ? `<a href="${esc(e.url)}" target="_blank" rel="noopener" title="${esc(e.title)}">▸ ${esc(label)}</a>`
        : `<span>▸ ${esc(label)}</span>`;
    }).join('');
    return `<div class="idea-card">
      <span class="idea-badge">${esc(i.format)}</span>
      <div class="idea-title">💡 ${esc(i.title)}</div>
      <div class="idea-metric">${esc(i.metricLabel)} ${i.metricPct.toFixed(1)}% · 추천 ${PLATFORM_LABEL[i.bestPlatform] || i.bestPlatform}</div>
      <div class="idea-tags">${i.hashtags.map(h => `<span>#${esc(h)}</span>`).join('')}</div>
      <div class="idea-evidence">근거(실제 영상)<br>${ev}</div>
    </div>`;
  }).join('');
}

document.getElementById('goal-toggle').addEventListener('click', e => {
  const btn = e.target.closest('button[data-goal]');
  if (!btn) return;
  document.querySelectorAll('#goal-toggle button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  state.ideaGoal = btn.dataset.goal;
  document.getElementById('ai-ideas').innerHTML = '';
  renderIdeas();
});

let nicheTimer = null;
document.getElementById('niche-input').addEventListener('input', e => {
  clearTimeout(nicheTimer);
  nicheTimer = setTimeout(() => { state.ideaNiche = e.target.value.trim(); renderIdeas(); }, 300);
});

document.getElementById('ai-idea-btn').addEventListener('click', async e => {
  const btn = e.target;
  const box = document.getElementById('ai-ideas');
  btn.disabled = true; btn.textContent = '✨ AI 생성 중...';
  box.innerHTML = '<div class="ai-note">Claude가 실데이터를 분석해 아이디어를 만들고 있습니다...</div>';
  try {
    const r = await fetchJSON('/api/ideas/ai', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goal: state.ideaGoal, niche: state.ideaNiche, platform: state.platform, category: state.category }),
    });
    if (r.enabled === false) {
      box.innerHTML = `<div class="ai-note">🔑 ${esc(r.message)}</div>`;
    } else if (r.error) {
      box.innerHTML = `<div class="ai-note">AI 오류: ${esc(r.error)}</div>`;
    } else if (!r.ideas?.length) {
      box.innerHTML = `<div class="ai-note">${esc(r.note || 'AI가 아이디어를 생성하지 못했습니다.')}</div>`;
    } else {
      box.innerHTML = `<h2 style="font-size:14px;margin:8px 0;">✨ AI 생성 아이디어 <span class="h-sub">${esc(r.model || '')} · 실데이터 기반 제안</span></h2>` +
        r.ideas.map(i => `<div class="ai-idea">
          <div class="ai-hook">🎬 훅: ${esc(i.hook)}</div>
          <div class="idea-title">${esc(i.title)}</div>
          <div>${esc(i.outline)}</div>
          <div class="idea-tags" style="margin-top:8px;">${(i.hashtags || []).map(h => `<span>#${esc(String(h).replace(/^#/, ''))}</span>`).join('')}</div>
          <div class="ai-why">왜 통하나: ${esc(i.why)}</div>
        </div>`).join('');
    }
  } catch (err) {
    box.innerHTML = `<div class="ai-note">AI 요청 실패: ${esc(err.message)}</div>`;
  } finally {
    btn.disabled = false; btn.textContent = '✨ AI로 더 받기';
  }
});

// ── 🔬 콘텐츠 해부 ──
const analysisModal = document.getElementById('analysis-modal');
function closeAnalysis() { analysisModal.classList.add('hidden'); document.getElementById('analysis-body').innerHTML = ''; }
document.getElementById('analysis-close').addEventListener('click', closeAnalysis);
analysisModal.addEventListener('click', e => { if (e.target.id === 'analysis-modal') closeAnalysis(); });

async function openDeconstruct(key) {
  const body = document.getElementById('analysis-body');
  document.getElementById('analysis-title').textContent = '🔬 콘텐츠 해부';
  body.innerHTML = '<div class="ai-note">Claude가 이 콘텐츠의 구조와 성공 요인을 분석하고 있습니다...</div>';
  analysisModal.classList.remove('hidden');
  let r;
  try {
    r = await fetchJSON('/api/deconstruct', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) });
  } catch (err) { body.innerHTML = `<div class="ai-note">요청 실패: ${esc(err.message)}</div>`; return; }
  if (r.enabled === false) { body.innerHTML = `<div class="ai-note">🔑 ${esc(r.message)}</div>`; return; }
  if (r.error) { body.innerHTML = `<div class="ai-note">분석 오류: ${esc(r.error)}</div>`; return; }
  const a = r.analysis;
  document.getElementById('analysis-title').textContent = `🔬 ${r.video.title.slice(0, 40)}`;
  body.innerHTML = `
    <div class="an-summary">${esc(a.summary)}</div>
    <h4>🎣 훅 분석</h4>
    <div class="an-hook"><span class="hk-text">${esc(a.hook.text)}</span><span class="hk-type">${esc(a.hook.type)}</span>
      <div class="muted" style="margin-top:6px;">${esc(a.hook.why)}</div></div>
    <h4>🧱 콘텐츠 구조</h4>
    <ol>${a.structure.map(s => `<li class="an-step"><b>${esc(s.part)}</b> — ${esc(s.detail)}</li>`).join('')}</ol>
    <h4>🔥 왜 터졌나 (바이럴 요인)</h4>
    <ul>${a.viralFactors.map(f => `<li class="an-factor"><b>${esc(f.factor)}</b> — ${esc(f.detail)}</li>`).join('')}</ul>
    <h4>💭 겨냥한 감정·심리</h4><div class="muted">${esc(a.targetEmotion)}</div>
    <h4>🧪 재현 공식</h4><div class="an-formula">${esc(a.formula)}</div>
    <h4>✅ 내 콘텐츠에 적용하기</h4>
    <ul>${a.applyTips.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
    <div class="an-model">${esc(r.model || '')}</div>`;
}

// ── ✍️ 콘텐츠 스튜디오 ──
let studioMode = 'create';
document.getElementById('studio-mode').addEventListener('click', e => {
  const btn = e.target.closest('button[data-mode]');
  if (!btn) return;
  document.querySelectorAll('#studio-mode button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  studioMode = btn.dataset.mode;
  document.getElementById('studio-topic').style.display = studioMode === 'create' ? '' : 'none';
  document.getElementById('studio-draft').style.display = studioMode === 'rewrite' ? '' : 'none';
  document.getElementById('studio-btn').textContent = studioMode === 'create' ? '✨ 생성' : '✨ 변환';
});

document.getElementById('studio-btn').addEventListener('click', async e => {
  const btn = e.target;
  const platform = document.getElementById('studio-platform').value;
  const topic = document.getElementById('studio-topic').value.trim();
  const draft = document.getElementById('studio-draft').value.trim();
  const out = document.getElementById('studio-result');
  if (studioMode === 'create' && !topic) { out.innerHTML = '<div class="ai-note">주제나 간단한 내용을 입력해 주세요.</div>'; return; }
  if (studioMode === 'rewrite' && !draft) { out.innerHTML = '<div class="ai-note">변환할 내 글/초안을 입력해 주세요.</div>'; return; }
  btn.disabled = true; btn.textContent = '✨ 생성 중...';
  out.innerHTML = '<div class="ai-note">Claude가 인기 콘텐츠 구조를 적용해 작성하고 있습니다...</div>';
  try {
    const r = await fetchJSON('/api/studio', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: studioMode, platform, topic, draft }),
    });
    if (r.enabled === false) { out.innerHTML = `<div class="ai-note">🔑 ${esc(r.message)}</div>`; return; }
    if (r.error) { out.innerHTML = `<div class="ai-note">오류: ${esc(r.error)}</div>`; return; }
    renderStudioResult(out, r);
  } catch (err) {
    out.innerHTML = `<div class="ai-note">요청 실패: ${esc(err.message)}</div>`;
  } finally {
    btn.disabled = false; btn.textContent = studioMode === 'create' ? '✨ 생성' : '✨ 변환';
  }
});

function renderStudioResult(out, r) {
  const d = r.result;
  const refList = (r.references || []).map(x => `${PLATFORM_LABEL[x.platform] || x.platform}·${x.title.slice(0, 20)}`).join(' / ');
  let html;
  if (r.mode === 'create') {
    html = `<div class="studio-out">
      <h3>${esc(d.title)}</h3>
      <div class="so-hook">🎣 훅: ${esc(d.hook)}</div>
      <div class="so-label">본문</div>
      <div class="so-body" id="so-copy-src">${esc(d.body)}</div>
      <button class="copy-btn" data-copy="so-copy-src">📋 본문 복사</button>
      <div class="so-label">해시태그</div>
      <div class="idea-tags">${(d.hashtags || []).map(h => `<span>#${esc(String(h).replace(/^#/, ''))}</span>`).join('')}</div>
      <div class="so-label">마무리(CTA)</div><div>${esc(d.cta)}</div>
      <div class="so-label">적용한 인기 패턴</div><ul>${(d.appliedPatterns || []).map(p => `<li>${esc(p)}</li>`).join('')}</ul>
      <div class="so-label">더 잘 되게 하는 팁</div><ul>${(d.tips || []).map(t => `<li>${esc(t)}</li>`).join('')}</ul>
      <div class="an-model">참고: ${esc(refList)} · ${esc(r.model || '')}</div>
    </div>`;
  } else {
    html = `<div class="studio-out">
      <div class="so-hook">🎣 새 훅: ${esc(d.hook)}</div>
      <div class="so-label">바이럴하게 다시 쓴 글</div>
      <div class="so-body" id="so-copy-src">${esc(d.rewritten)}</div>
      <button class="copy-btn" data-copy="so-copy-src">📋 복사</button>
      <div class="so-label">해시태그</div>
      <div class="idea-tags">${(d.hashtags || []).map(h => `<span>#${esc(String(h).replace(/^#/, ''))}</span>`).join('')}</div>
      <div class="so-label">무엇을 왜 바꿨나</div>
      <ul>${(d.changes || []).map(c => `<li><b>${esc(c.change)}</b> — ${esc(c.why)}</li>`).join('')}</ul>
      <div class="an-model">참고: ${esc(refList)} · ${esc(r.model || '')}</div>
    </div>`;
  }
  out.innerHTML = html;
}

// 복사 버튼 (위임)
document.getElementById('studio-result').addEventListener('click', e => {
  const btn = e.target.closest('.copy-btn');
  if (!btn) return;
  const src = document.getElementById(btn.dataset.copy);
  if (src) navigator.clipboard.writeText(src.textContent).then(() => { btn.textContent = '✓ 복사됨'; setTimeout(() => btn.textContent = '📋 복사', 1500); });
});

// 히어로 CTA → 해당 섹션으로 스크롤
document.querySelectorAll('.hero-btn[data-scroll]').forEach(b => {
  b.addEventListener('click', () => {
    const el = document.getElementById(b.dataset.scroll);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});

// AI 상태 배지
(async () => {
  try {
    const s = await fetchJSON('/api/ai-status');
    const badge = document.getElementById('ai-badge');
    const tx = s.transcript ? ' · 유튜브 대본✓' : '';
    if (s.enabled) { badge.textContent = `● AI 활성 (${s.provider}/${s.model})${tx}`; badge.classList.add('live'); }
    else { badge.textContent = `AI 비활성 — 무료 키(Gemini/Groq) 또는 유료 키 설정 필요${tx}`; }
  } catch {}
})();

// 이벤트 바인딩
document.getElementById('platform-tabs').addEventListener('click', e => {
  const btn = e.target.closest('button[data-platform]');
  if (!btn) return;
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  state.platform = btn.dataset.platform;
  refresh();
});
document.getElementById('category-filter').addEventListener('change', e => { state.category = e.target.value; refresh(); });
document.getElementById('sort-select').addEventListener('change', e => { state.sort = e.target.value; refresh(); });
document.getElementById('limit-select').addEventListener('change', e => { state.limit = Number(e.target.value); refresh(); });

// 검색 (입력 후 300ms 디바운스)
let searchTimer = null;
document.getElementById('search-input').addEventListener('input', e => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { state.q = e.target.value.trim(); refresh(); }, 300);
});

// CSV 다운로드 (현재 필터·정렬 그대로)
document.getElementById('csv-btn').addEventListener('click', () => {
  window.location.href = '/api/export.csv?' + query();
});

// 키워드 클릭 → 검색 필터 적용/해제
document.getElementById('keywords').addEventListener('click', e => {
  const kw = e.target.closest('.kw');
  if (!kw) return;
  const word = kw.dataset.kw;
  state.q = state.q.toLowerCase() === word ? '' : word;
  document.getElementById('search-input').value = state.q;
  refresh();
});

// 랭킹 행 클릭 → 해부 버튼 우선, 아니면 미리보기 재생
document.getElementById('video-rows').addEventListener('click', e => {
  const dec = e.target.closest('.deconstruct-btn');
  if (dec) { e.stopPropagation(); openDeconstruct(dec.dataset.key); return; }
  const row = e.target.closest('tr.playable');
  if (!row) return;
  const v = lastVideos.find(x => x.key === row.dataset.key);
  if (v) openModal(v);
});

document.getElementById('collect-btn').addEventListener('click', async e => {
  const btn = e.target;
  btn.disabled = true; btn.textContent = '수집 중...';
  try {
    await fetchJSON('/api/collect', { method: 'POST' });
    await refresh();
  } catch (err) {
    alert('수집 실패: ' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = '지금 수집';
  }
});

// 미리보기 카드 → 재생 모달
document.getElementById('cards').addEventListener('click', e => {
  const card = e.target.closest('.card.clickable');
  if (!card) return;
  const v = lastVideos.find(x => x.key === card.dataset.key);
  if (v) openModal(v);
});
document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeModal(); closeAnalysis(); } });

// URL 등록
document.getElementById('register-btn').addEventListener('click', async () => {
  const input = document.getElementById('register-input');
  const msg = document.getElementById('register-msg');
  const urls = input.value.split(/\s+/).filter(Boolean);
  if (!urls.length) { msg.textContent = 'URL을 입력해 주세요.'; msg.className = 'muted err'; return; }
  msg.textContent = '등록 중...'; msg.className = 'muted';
  try {
    const r = await fetchJSON('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls }),
    });
    const errText = r.errors?.length ? ` / 실패 ${r.errors.length}건: ${r.errors.map(e => e.error).join(', ')}` : '';
    msg.textContent = `${r.registered}개 영상 등록 완료${errText}`;
    msg.className = r.registered ? 'muted ok' : 'muted err';
    if (r.registered) { input.value = ''; await refresh(); }
  } catch (err) {
    msg.textContent = '등록 실패: ' + err.message;
    msg.className = 'muted err';
  }
});
document.getElementById('register-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('register-btn').click();
});

refresh().catch(err => console.error(err));
