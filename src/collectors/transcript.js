// 유튜브 대본(자막) 수집 — yt-dlp 사용. API 키 불필요·무료.
// yt-dlp가 pot 토큰·봇 탐지 우회를 자체 관리하므로 임의 공개 영상의 자막을 안정적으로 가져온다.
// 서버 환경에 python + yt-dlp 가 설치돼 있어야 한다 (pip install yt-dlp).
import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

// 실행 커맨드 (기본 "python -m yt_dlp"). 환경에 따라 YTDLP_CMD 로 변경.
const YTDLP = (process.env.YTDLP_CMD || 'python -m yt_dlp').trim().split(/\s+/);

function run(args, timeout) {
  return new Promise(resolve => {
    execFile(YTDLP[0], [...YTDLP.slice(1), ...args], { timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => resolve({ err, stdout: stdout || '', stderr: stderr || '' }));
  });
}

let _available = null;
export async function ytDlpAvailable() {
  if (_available !== null) return _available;
  const { err, stdout } = await run(['--version'], 8000);
  _available = !err && /\d{4}\.\d/.test(stdout);
  return _available;
}

function json3ToText(raw) {
  try {
    const j = JSON.parse(raw);
    return (j.events || [])
      .flatMap(e => (e.segs || []).map(s => s.utf8 || ''))
      .join('')
      .replace(/\n+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  } catch { return ''; }
}

const _cache = new Map(); // id → transcript (세션 내 재요청 방지)

// 유튜브 영상 자막을 텍스트로 반환. 실패 시 '' (치명적이지 않음).
export async function fetchYoutubeTranscript(id, langs = 'ko,en') {
  if (!/^[\w-]{11}$/.test(id)) return '';
  if (_cache.has(id)) return _cache.get(id);
  if (!(await ytDlpAvailable())) return '';

  const stamp = id + '_' + process.pid + '_' + (process.hrtime.bigint() % 100000n).toString();
  const base = path.join(os.tmpdir(), 'trd_' + stamp);
  const args = [
    '--skip-download', '--write-auto-sub', '--write-sub',
    '--sub-langs', langs, '--sub-format', 'json3',
    '--no-warnings', '--no-playlist',
    '-o', base + '.%(ext)s',
    `https://www.youtube.com/watch?v=${id}`,
  ];
  await run(args, 45000);

  // yt-dlp 는 base.<lang>.json3 형태로 저장. temp 디렉터리에서 매칭 파일을 찾는다.
  const dir = os.tmpdir();
  const prefix = 'trd_' + stamp;
  let text = '';
  try {
    const files = fs.readdirSync(dir).filter(f => f.startsWith(prefix) && f.endsWith('.json3'));
    // 선호 언어 순서대로
    const pick = files.sort((a, b) => {
      const rank = f => (f.includes('.ko.') ? 0 : f.includes('.en.') ? 1 : 2);
      return rank(a) - rank(b);
    })[0];
    if (pick) text = json3ToText(fs.readFileSync(path.join(dir, pick), 'utf8'));
    // 정리
    for (const f of files) { try { fs.unlinkSync(path.join(dir, f)); } catch {} }
  } catch { /* 무시 */ }
  const result = text.slice(0, 6000); // 분석에 충분한 길이로 제한
  _cache.set(id, result);
  return result;
}
