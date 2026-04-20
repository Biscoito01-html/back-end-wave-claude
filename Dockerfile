# syntax=docker/dockerfile:1.7
# Dockerfile do BACKEND (NestJS) - deploy isolado no EasyPanel.
# Build context = raiz do repositorio back-end-wave-claude.
# O Bun engine roda em OUTRO service (repo openclaude) e o backend
# se conecta via rede interna do projeto EasyPanel.

# --- stage 1: build do Nest ---
FROM node:20-bookworm-slim AS nest-build
WORKDIR /app

# Dependencias do Prisma (openssl) e de build nativas (bcrypt precisa python3/make/g++)
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      openssl ca-certificates python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY . .
RUN npx prisma generate && npm run build

# --- stage 2: runtime (so Nest, sem Bun, sem supervisord) ---
FROM node:20-bookworm-slim
WORKDIR /app

# openssl: runtime do Prisma. tini: PID 1 que faz reap correto + Ctrl+C.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      openssl ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*

# Copia artefatos do stage de build
COPY --from=nest-build /app/node_modules ./node_modules
COPY --from=nest-build /app/dist ./dist
COPY --from=nest-build /app/prisma ./prisma
COPY --from=nest-build /app/package*.json ./

ENV NODE_ENV=production
EXPOSE 3002

# tini como init resolve zombies e propaga SIGTERM corretamente ao Node
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/src/main.js"]
