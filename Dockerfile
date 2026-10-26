# SortSite Tools by Ecomback — production image (API + scan workers + built web app).
# Chromium is installed from Debian so page rendering, axe-core checks, screenshots and PDF export work.
#
#   docker build -t sortsite-tools .
#   docker run -p 4000:4000 -v sortsite-data:/data -e BASE_URL=https://scan.example.com sortsite-tools
#
# Or see docker-compose.yml. Data (SQLite, screenshots, exports) lives in the /data volume.
FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium fonts-liberation fonts-noto-color-emoji fonts-noto-cjk ca-certificates dumb-init gosu \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=4000 \
    DATA_DIR=/data \
    CHROME_PATH=/usr/bin/chromium \
    # Chromium runs as the unprivileged "node" user; containers rarely allow its user-namespace sandbox.
    CHROME_ARGS="--no-sandbox --disable-gpu --disable-dev-shm-usage" \
    TRUST_PROXY=1

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build \
 && mkdir -p /data \
 && chown -R node:node /app /data

# No VOLUME instruction: Railway's builder rejects it. Mount /data at run time (docker run -v, compose, a Render disk or a Railway volume).
# The container starts as root only to hand a freshly mounted /data (hosts mount disks as root) to "node", then runs the app as "node".
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 4000) + '/api/v1/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["sh", "-c", "chown -R node:node \"$DATA_DIR\" && exec gosu node npm start"]
