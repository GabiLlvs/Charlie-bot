# syntax=docker/dockerfile:1

# ---------- Etapa 1: dependencias ----------
FROM node:24-alpine AS deps

# git: libsignal (dependencia de Baileys) se resuelve desde GitHub
RUN apk add --no-cache git

WORKDIR /app
COPY package.json package-lock.json ./

# --ignore-scripts: no se ejecutan scripts de instalación de terceros.
# ffmpeg-static no descarga su binario; en runtime se usa el ffmpeg de Alpine (FFMPEG_BIN).
# sharp usa los binarios precompilados de @img/sharp-linuxmusl-*.
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# ---------- Etapa 2: runtime ----------
FROM node:24-alpine AS runtime

ARG BOT_REVISION=local
LABEL org.opencontainers.image.revision=$BOT_REVISION

RUN apk add --no-cache ffmpeg tini

ENV NODE_ENV=production \
    BOT_REVISION=$BOT_REVISION \
    FFMPEG_BIN=/usr/bin/ffmpeg \
    AUTH_FOLDER=/app/data/auth_info

WORKDIR /app
COPY --from=deps --chown=root:root /app/node_modules ./node_modules
COPY --chown=root:root package.json ./
COPY --chown=root:root src ./src

# Sesión de WhatsApp persistente (montar un volumen acá)
RUN mkdir -p /app/data && chown node:node /app/data
VOLUME ["/app/data"]

USER node

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/index.js"]
