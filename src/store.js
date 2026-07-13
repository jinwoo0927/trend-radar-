// 데이터 저장소 — 로컬은 JSON 파일, 배포(Render 등)는 Supabase Postgres(JSONB)로 자동 전환.
// SUPABASE_URL + SUPABASE_SERVICE_KEY 가 설정되면 Supabase 를 쓰고, 없으면 파일에 저장한다.
// 인메모리 db 는 동일하게 유지하고, 저장 계층만 교체한다.
//   videos: 영상 메타데이터 + 최신 지표, snapshots: 시계열 지표 기록, meta: 수집 상태·이력
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || '';
const USE_SUPABASE = !!(SUPABASE_URL && SUPABASE_KEY);
const ROW_ID = 'trendradar';           // 단일 행에 전체 상태를 JSONB 로 저장
const TABLE = 'app_state';

let db = { videos: {}, snapshots: [], channels: {}, meta: { lastCollectedAt: null, mode: 'empty' } };

export function storageMode() { return USE_SUPABASE ? 'supabase' : 'file'; }

// ── Supabase REST (PostgREST) 헬퍼 ──
function sbHeaders(extra = {}) {
  return { apikey: SUPABASE_KEY, authorization: `Bearer ${SUPABASE_KEY}`, 'content-type': 'application/json', ...extra };
}
async function sbLoad() {
  const url = `${SUPABASE_URL}/rest/v1/${TABLE}?id=eq.${ROW_ID}&select=data`;
  const r = await fetch(url, { headers: sbHeaders() });
  if (!r.ok) throw new Error(`Supabase load ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const rows = await r.json();
  return rows?.[0]?.data || null;
}
async function sbSave(data) {
  const url = `${SUPABASE_URL}/rest/v1/${TABLE}`;
  const body = JSON.stringify([{ id: ROW_ID, data, updated_at: new Date().toISOString() }]);
  const r = await fetch(url, { method: 'POST', headers: sbHeaders({ prefer: 'resolution=merge-duplicates,return=minimal' }), body });
  if (!r.ok) throw new Error(`Supabase save ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

// ── 로드 (서버 시작 시 1회, async) ──
export async function load() {
  try {
    if (USE_SUPABASE) {
      const data = await sbLoad();
      if (data) db = data;
      console.log(`저장소: Supabase (${SUPABASE_URL})`);
    } else if (fs.existsSync(DB_FILE)) {
      db = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
      console.log('저장소: 로컬 파일');
    } else {
      console.log('저장소: 로컬 파일 (새로 시작)');
    }
  } catch (e) {
    console.error('저장소 로드 실패, 빈 상태로 시작:', e.message);
  }
  return db;
}

// ── 저장 (디바운스 플러시로 잦은 쓰기 병합) ──
let flushTimer = null;
let flushing = false;
function persist() {
  if (USE_SUPABASE) return sbSave(db);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(db), 'utf-8');
  return Promise.resolve();
}
export function save() {
  clearTimeout(flushTimer);
  flushTimer = setTimeout(async () => {
    if (flushing) { save(); return; }       // 진행 중이면 뒤로 미룸
    flushing = true;
    try { await persist(); } catch (e) { console.error('저장 실패:', e.message); }
    finally { flushing = false; }
  }, USE_SUPABASE ? 1200 : 300);
}
// 종료 직전 즉시 저장 (배포 재시작 시 데이터 보존)
export async function flushNow() {
  clearTimeout(flushTimer);
  try { await persist(); } catch (e) { console.error('flushNow 실패:', e.message); }
}

export function upsertVideos(videos, collectedAt = new Date().toISOString()) {
  for (const v of videos) {
    const key = `${v.platform}:${v.id}`;
    const existing = db.videos[key];
    db.videos[key] = { ...existing, ...v, key, updatedAt: collectedAt };
    db.snapshots.push({
      key,
      at: collectedAt,
      views: v.views, likes: v.likes, comments: v.comments, shares: v.shares,
    });
  }
  // 스냅샷은 영상당 최근 60개까지만 유지
  const byKey = {};
  for (const s of db.snapshots) (byKey[s.key] ??= []).push(s);
  db.snapshots = Object.values(byKey).flatMap(list =>
    list.sort((a, b) => a.at.localeCompare(b.at)).slice(-60)
  );
  db.meta.lastCollectedAt = collectedAt;
  save();
}

// ── 채널 프로필 (아웃라이어 점수 기준선) ──
// 저장은 요약만: 구독자·중앙값. 원본 영상 목록은 크기 문제로 저장하지 않는다.
export function upsertChannel(key, profile) {
  (db.channels ??= {})[key.toLowerCase()] = {
    handle: profile.handle, name: profile.name, subscribers: profile.subscribers,
    medianViews: profile.medianViews, medianShorts: profile.medianShorts,
    videoCount: (profile.videos || []).length, fetchedAt: profile.fetchedAt,
  };
  save();
}
export function getChannel(key) { return (db.channels || {})[String(key || '').toLowerCase()] || null; }
export function getChannels() { return db.channels || {}; }

export function setMode(mode) { db.meta.mode = mode; save(); }
export function getMeta() { return db.meta; }

// 수집 이력 기록 (최근 30회 유지)
export function addCollectLog(entry) {
  (db.meta.collectLog ??= []).push(entry);
  db.meta.collectLog = db.meta.collectLog.slice(-30);
  save();
}
export function getVideos() { return Object.values(db.videos); }
export function getSnapshots(key) {
  return db.snapshots.filter(s => s.key === key).sort((a, b) => a.at.localeCompare(b.at));
}
export function getAllSnapshots() { return db.snapshots; }
export function removeWhere(pred) {
  for (const [k, v] of Object.entries(db.videos)) {
    if (pred(v)) delete db.videos[k];
  }
  db.snapshots = db.snapshots.filter(s => db.videos[s.key]);
  save();
}

export function clear() {
  db = { videos: {}, snapshots: [], channels: db.channels || {}, meta: { lastCollectedAt: null, mode: db.meta.mode } };
  save();
}
