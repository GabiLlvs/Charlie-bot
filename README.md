# Charlie-bot

Bot de stickers para WhatsApp.

Recibís una **foto** o **GIF** (también video corto) y el bot responde con un **sticker** WebP 512×512.

## Ramas

- **`dev`**: desarrollo / test. Todas las features salen de acá y vuelven por PR.
- **`main`**: stage / producción. Solo se actualiza desde `dev` cuando está estable.

El avance se registra en [`docs/avance.md`](docs/avance.md).

Pensado para el número **+54** (Argentina). La sesión se vincula escaneando un QR desde ese teléfono.

## Requisitos

- Node.js 20+
- El celular con ese número debe tener WhatsApp activo

## Instalación

```bash
cd whatsapp-sticker-bot
npm install
```

## Uso

```bash
npm start
```

1. Aparece un **código QR** en la terminal.
2. En el teléfono: **Ajustes → Dispositivos vinculados → Vincular dispositivo** y escaneá el QR.
3. Enviá una imagen o GIF **al chat contigo mismo** o a cualquier chat donde esté este número.
4. El bot responde con el sticker.

La sesión queda guardada en `auth_info/`; en reinicios no hace falta escanear de nuevo (salvo que cierres sesión o borres esa carpeta).

## Variables opcionales

Copiá `.env.example` a `.env` si querés documentar el número esperado:

```bash
BOT_PHONE=5492613417054
```

## Notas

- Usa [Baileys](https://github.com/WhiskeySockets/Baileys) (cliente no oficial). Para uso comercial o alto volumen conviene [WhatsApp Cloud API](https://developers.facebook.com/docs/whatsapp) con Meta Business.
- En grupos el bot **no** responde automáticamente (evita spam). Si lo querés en grupos, se puede cambiar en `src/index.js`.
- GIFs largos o pesados pueden fallar o reducir FPS para cumplir el límite de tamaño (~500 KB).

## Alternativa con n8n

Si ya tenés **WhatsApp Business Cloud** en Meta y n8n, podés usar el trigger **WhatsApp Trigger** + descarga de media + un servicio HTTP que ejecute esta misma lógica de conversión. Este repo es la forma más rápida de probar con tu número personal sin configurar Meta.

## Landing de portfolio

La presentación visual del proyecto está en [`portfolio/`](portfolio/), separada del bot: es HTML y CSS estáticos, no agrega dependencias y no participa del proceso de WhatsApp. Para verla, abrí `portfolio/index.html` en el navegador.

La landing es un caso de estudio del bot; no ofrece una demo conectada ni convierte imágenes en el navegador.

## Docker

Build multi-stage sobre `node:24-alpine`. Las dependencias se instalan con `--ignore-scripts` y se usa el `ffmpeg` de Alpine en vez del binario que descarga `ffmpeg-static`. El contenedor corre como usuario sin privilegios, con filesystem read-only.

```bash
docker compose up -d --build
docker compose logs -f charlie-bot   # escanear el QR la primera vez
```

- La sesión se guarda en el volumen `charlie_bot_data` (`/app/data/auth_info`). Para re-vincular: `docker compose down -v`.
- No expone puertos: el bot solo abre una conexión saliente hacia WhatsApp.
- Para ajustes locales (redes, límites) usá un `docker-compose.override.yml`, que está ignorado por git.
