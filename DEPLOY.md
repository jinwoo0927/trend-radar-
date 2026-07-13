# 🚀 무료 배포 가이드 (Render + Supabase + Gemini)

**월 $0**로 전 기능(트렌드 수집·유튜브 대본·AI 해부/생성)을 배포합니다.

| 구성 | 서비스 | 비용 |
|------|--------|------|
| 호스팅 | Render (Docker, 무료 웹서비스) | $0 |
| 데이터 | Supabase (Postgres) | $0 |
| AI | Google Gemini (무료 티어) | $0 |
| 유튜브 대본 | yt-dlp (이미지에 포함) | $0 |

---

## 1단계 · Supabase 준비 (데이터 저장소)

1. [supabase.com](https://supabase.com) 가입 → **New project** 생성 (Region은 Northeast Asia(Seoul/Tokyo) 권장).
2. 왼쪽 **SQL Editor** → 아래 SQL 실행 (상태 저장용 테이블 1개):

   ```sql
   create table if not exists app_state (
     id text primary key,
     data jsonb,
     updated_at timestamptz default now()
   );
   ```

3. **Settings → API** 에서 두 값을 복사해 둡니다:
   - **Project URL** → `SUPABASE_URL` (예: `https://xxxx.supabase.co`)
   - **service_role** 키(Project API keys 하단, "secret") → `SUPABASE_SERVICE_KEY`
   - ⚠️ service_role 키는 **서버 전용 비밀키**입니다. 웹/깃허브에 절대 노출 금지.

> 이 앱은 서버에서 service_role 키로만 접근하므로 RLS 설정은 필요 없습니다.

## 2단계 · Gemini 무료 키 (AI)

- [aistudio.google.com/apikey](https://aistudio.google.com/apikey) → **Create API key** → `GEMINI_API_KEY` 로 사용. 카드 불필요.

## 3단계 · 코드를 GitHub에 올리기

```bash
cd trend-radar
git init
git add .
git commit -m "TrendRadar"
# GitHub에서 빈 저장소 생성 후:
git remote add origin https://github.com/<계정>/<저장소>.git
git branch -M main
git push -u origin main
```
> `.gitignore` 가 `.env` 와 `data/` 를 제외하므로 비밀키는 올라가지 않습니다.

## 4단계 · Render 배포

1. [render.com](https://render.com) 가입(깃허브 연동).
2. **New → Blueprint** → 위 저장소 선택 → `render.yaml` 자동 인식 → **Apply**.
   (Blueprint가 없다면 New → Web Service → 저장소 선택 → Runtime: **Docker** 선택)
3. **Environment** 탭에서 아래 비밀값 입력 (render.yaml의 `sync:false` 항목):
   - `GEMINI_API_KEY` = (2단계 키)
   - `SUPABASE_URL` = (1단계 URL)
   - `SUPABASE_SERVICE_KEY` = (1단계 service_role 키)
4. **Deploy**. 첫 빌드는 5~10분(파이썬·yt-dlp 설치 포함). 완료되면 `https://trend-radar-xxxx.onrender.com` 발급.
5. `https://<주소>/api/health` 접속 → `{"ok":true,"storage":"supabase","ai":"gemini"}` 확인.

## 5단계 · 슬립 방지 (무료 플랜)

Render 무료는 15분 미사용 시 잠들어 첫 방문자가 30~60초 기다립니다. 무료로 깨워두기:

1. [uptimerobot.com](https://uptimerobot.com) 가입 (무료).
2. **Add New Monitor** → HTTP(s) → URL `https://<주소>/api/health` → 간격 **5분**.
   → 5분마다 핑을 보내 서버가 잠들지 않습니다.

---

## 로컬 실행 (개발)

```bash
npm install
pip install yt-dlp          # 유튜브 대본
cp .env.example .env        # GEMINI_API_KEY 등 입력 (Supabase 비워두면 파일 저장)
npm start                   # http://localhost:3600
```

## 비용이 커지면 (선택)

- **Gemini 무료 한도 초과**: 이용 횟수 제한(무료 N회) 도입, 또는 `OPENAI_API_KEY`(Groq 무료) 병행, 또는 유료 키.
- **슬립 없는 상시 서버**: Oracle Cloud 무료 VM(영구 $0) 또는 Render 유료($7~).
- **회원·결제**: Supabase Auth + 결제(Stripe/토스) 연동. DB는 이미 Supabase라 확장 쉬움.
