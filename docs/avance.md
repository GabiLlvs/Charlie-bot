# Avance — Charlie-bot

Bitácora del proyecto (más reciente arriba). Completar en el mismo cambio que el código.

## 2026-10-23

- Fix: una sola respuesta por foto — solo `messages.upsert` tipo `notify` y dedupe por `key.id` (evitaba sticker doble con notify+append).

## Deuda conocida

- `sticker.js` usa el binario de `ffmpeg-static`; el Dockerfile setea `FFMPEG_BIN` y omite scripts de npm. GIFs/videos en Docker pueden fallar hasta unificar la ruta de ffmpeg.

## 2026-10-18 — `dev`

- Landing estática de portfolio en `portfolio/`, independiente del bot y sin dependencias adicionales.

## 2026-10-18 — `dev`

- Rama `dev` en origin como integración / test. `main` queda para stage / producción.
- Features y fixes de ahora en más nacen de `dev` y vuelven a `dev` por PR; promoción a `main` cuando esté estable.
- Arranque de skills personales (Cursor) y de esta bitácora para no perder contexto al crecer.

## 2026-10-14 — `main`

- Bot inicial (Baileys 7): foto/GIF → sticker WebP 512×512; sin respuesta en grupos.
- Textos de “de a una foto” y número +54 en README.
- Docker multi-stage (`node:24-alpine`, usuario no-root, volumen de sesión, rootfs read-only) — PR #1.
