# Avance — Charlie-bot

Bitácora del proyecto (más reciente arriba). Completar en el mismo cambio que el código.

## 2026-10-29 — Presentación del bot

- Carpeta `portfolio/` renombrada a `presentacion/`, con referencias de documentación actualizadas.
- Botón “Probar” que abre el chat de WhatsApp de Charlie e indicación de enviar una foto por vez.
- Presentación completa en español e inglés, con selector ES/EN, metadatos y etiquetas accesibles traducidas. HTML estático, sin dependencias nuevas.
- Validación en Edge para ambos idiomas en escritorio (1280 px) y móvil (390 px), sin desbordamiento horizontal, con imágenes cargadas y navegación ES/EN verificada. Enlaces y recursos locales válidos.

## 2026-10-29 — `dev`

- Rechazo de varias imágenes: texto seguido del sticker transparente de Charlie enojado, incluido en `src/assets/` y en Docker.
- Álbumes identificados por la asociación al mensaje padre; hijos demorados y mensajes duplicados no generan stickers adicionales. Cola de procesamiento en lugar de descartar mensajes mientras el bot está ocupado.
- Reconexiones: cancelar lotes de sockets anteriores y cerrar por SIGTERM sin desvincular, esperando el guardado de credenciales. Mantener `append` para aceptar mensajes entregados tras estar offline.
- Integrada la corrección de duplicados de `main` (2026-10-23): la deduplicación ahora vive en el handler compartido y cubre `notify` + `append`, incluso tras una reconexión dentro del mismo proceso.
- Docker: revisión del commit en imagen y logs, instrucciones de recreación conservando el volumen de sesión. FFmpeg respeta `FFMPEG_BIN` y maneja errores al iniciar el proceso.
- Instalados Docker Desktop 4.97.0, Docker 29.9.2, Compose 5.6.1 y WSL 2.7.14 en Windows; motor Linux operativo tras el reinicio. Build de `charlie-bot:latest` y `docker compose config --quiet` aprobados. Las 15 pruebas pasan también dentro del contenedor, con usuario sin privilegios y filesystem read-only; conversión real de PNG, GIF y MP4 a WebP 512×512 verificada con FFmpeg. Queda pendiente el despliegue y envío real en el servidor.

## 2026-10-23

- Fix: una sola respuesta por foto — solo `messages.upsert` tipo `notify` y dedupe por `key.id` (evitaba sticker doble con notify+append).

## 2026-10-18 — `dev`

- Presentación estática en `presentacion/` (originalmente `portfolio/`), independiente del bot y sin dependencias adicionales.

## 2026-10-18 — `dev`

- Rama `dev` en origin como integración / test. `main` queda para stage / producción.
- Features y fixes de ahora en más nacen de `dev` y vuelven a `dev` por PR; promoción a `main` cuando esté estable.
- Arranque de skills personales (Cursor) y de esta bitácora para no perder contexto al crecer.

## 2026-10-14 — `main`

- Bot inicial (Baileys 7): foto/GIF → sticker WebP 512×512; sin respuesta en grupos.
- Textos de “de a una foto” y número +54 en README.
- Docker multi-stage (`node:24-alpine`, usuario no-root, volumen de sesión, rootfs read-only) — PR #1.
