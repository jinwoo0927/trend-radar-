# TrendRadar — Node + Python(yt-dlp) + ffmpeg 단일 이미지
# Render/Fly/Railway 등 어디서든 동일하게 동작. 무료 Render 웹서비스에서 검증된 구성.
FROM node:20-slim

# 시스템 의존성: python3 + yt-dlp(유튜브 대본), ffmpeg(자막 후처리 안정성)
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-pip ffmpeg ca-certificates \
 && pip3 install --no-cache-dir --break-system-packages yt-dlp \
 && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 의존성 먼저 설치 (레이어 캐시)
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

# 앱 소스
COPY . .

ENV NODE_ENV=production
ENV YTDLP_CMD="python3 -m yt_dlp"
# Render 는 PORT 를 주입한다. 로컬 도커 실행 시 기본 3600.
EXPOSE 3600

CMD ["node", "server.js"]
