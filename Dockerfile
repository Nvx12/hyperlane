# syntax=docker/dockerfile:1

# --- build: verified copy of the client into dist/ (no npm install needed: the build and the
# server use only Node built-ins) ---
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json ./
COPY client ./client
COPY tools/build.mjs ./tools/build.mjs
RUN node tools/build.mjs

# --- runtime ---
FROM node:24-alpine
ENV NODE_ENV=production \
    APP_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    DATABASE_PATH=/data/nightvector.db
WORKDIR /app

COPY --from=build /app/package.json ./
COPY --from=build /app/dist ./dist
# The server shares game rules (balance, routes, version) with the client for validation.
COPY client/js/balance.js client/js/version.js ./client/js/
COPY client/js/data/environments.js ./client/js/data/
COPY server ./server

RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Node receives SIGTERM directly (exec form) and shuts down gracefully (see server/src/index.js).
STOPSIGNAL SIGTERM
CMD ["node", "--no-warnings=ExperimentalWarning", "server/src/index.js"]
