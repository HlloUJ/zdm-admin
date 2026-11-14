FROM node:24-alpine
WORKDIR /app
COPY server.mjs /app/server.mjs
RUN mkdir -p /data/store-exit-ledger && chown node:node /data/store-exit-ledger
VOLUME ["/data/store-exit-ledger"]
USER node
ENV PORT=8090 ZDM_LEDGER_DIR=/data/store-exit-ledger
CMD ["node", "/app/server.mjs"]
