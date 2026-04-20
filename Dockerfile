# syntax=docker/dockerfile:1.7
# Build context = raiz do repo (openclaude/). O EasyPanel deve apontar para
# esse Dockerfile com "build context = .".

# --- stage 1: build do Nest ---
FROM node:20-bookworm-slim AS nest-build
WORKDIR /app/back
COPY back-end/openclaude/package*.json ./
RUN npm ci
COPY back-end/openclaude/ ./
RUN npx prisma generate && npm run build

# --- stage 2: runtime (Nest + Bun + supervisord) ---
FROM node:20-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      curl unzip supervisor ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Instala Bun (binario oficial)
RUN curl -fsSL https://bun.sh/install | bash \
 && ln -s /root/.bun/bin/bun /usr/local/bin/bun

# Codigo do Bun (QueryEngine) com dependencias resolvidas
WORKDIR /app/openclaude
COPY openclaude/ /app/openclaude/
RUN bun install --frozen-lockfile || bun install

# Nest compilado + prisma + node_modules (inclui binarios nativos do prisma)
WORKDIR /app/back
COPY --from=nest-build /app/back/node_modules ./node_modules
COPY --from=nest-build /app/back/dist ./dist
COPY --from=nest-build /app/back/prisma ./prisma
COPY --from=nest-build /app/back/package*.json ./

# Supervisor (orquestra Nest + Bun no mesmo container)
COPY back-end/openclaude/deploy/supervisord.conf /etc/supervisor/conf.d/openclaude.conf

EXPOSE 3002
CMD ["/usr/bin/supervisord", "-n", "-c", "/etc/supervisor/supervisord.conf"]
