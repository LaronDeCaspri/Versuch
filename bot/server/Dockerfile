# Build from the bot/ directory:  docker build -f server/Dockerfile -t trading-bot-paper .
FROM node:22-alpine
WORKDIR /app
COPY mobile/standalone ./mobile/standalone
COPY server ./server
RUN mkdir -p /data && chown node:node /data
USER node
ENV TB_HOST=0.0.0.0 PORT=8787 TB_STATE_DIR=/data
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=60s --timeout=5s CMD wget -qO- http://127.0.0.1:8787/api/health || exit 1
CMD ["node", "server/runner.mjs"]
