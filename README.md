# Charlie-bot

Bot de stickers para WhatsApp.

Recibís una **foto** o **GIF** (también video corto) y el bot responde con un **sticker** WebP 512×512.

Si recibe varias imágenes juntas o un álbum, responde primero con el aviso de “de a una” y después con el sticker de Charlie enojado. No convierte las fotos de ese álbum, aunque lleguen separadas por varios segundos. Los mensajes nuevos esperan en cola si hay una conversión en curso.

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
3. Desde otro celular, enviá una imagen o GIF a un chat donde esté este número.
4. El bot responde con el sticker.

La sesión queda guardada en `auth_info/`; en reinicios no hace falta escanear de nuevo (salvo que cierres sesión o borres esa carpeta).

## Estructura del código

- `src/index.js`: punto de entrada.
- `src/config.js`: configuración compartida y logger.
- `src/whatsapp/bot.js`: conexión, eventos, QR y reconexión de WhatsApp.
- `src/whatsapp/message-utils.js`: detección y descarga de medios entrantes.
- `src/whatsapp/message-handler.js`: agrupación de mensajes y procesamiento de stickers.
- `src/whatsapp/message-sender.js`: preparación del destino y envío de respuestas.
- `src/sticker.js`: conversión de imágenes y videos a WebP.
- `src/assets/angry-charlie.webp`: sticker de rechazo, incluido en la imagen Docker.

## Variables opcionales

Copiá `.env.example` a `.env` si querés documentar el número esperado:

```bash
BOT_PHONE=5492613417054
```

## Notas

- Usa [Baileys](https://github.com/WhiskeySockets/Baileys) (cliente no oficial). Para uso comercial o alto volumen conviene [WhatsApp Cloud API](https://developers.facebook.com/docs/whatsapp) con Meta Business.
- En grupos el bot **no** responde automáticamente (evita spam). Si lo querés en grupos, se puede cambiar en `src/whatsapp/bot.js`.
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

- La sesión se guarda en el volumen `charlie_bot_data` (`/app/data/auth_info`). Las actualizaciones normales conservan este volumen y no requieren QR. `docker compose down -v` elimina la sesión y obliga a vincular de nuevo; usalo únicamente si querés borrar la sesión deliberadamente.
- No expone puertos: el bot solo abre una conexión saliente hacia WhatsApp.
- Para ajustes locales (redes, límites) usá un `docker-compose.override.yml`, que está ignorado por git.

### Actualizar en el servidor sin perder la sesión

Desde la misma carpeta del despliegue actual, con la misma configuración de Compose (incluido `-p`/`COMPOSE_PROJECT_NAME` si lo usás):

```bash
git pull --ff-only
export BOT_REVISION="$(git rev-parse --short HEAD)"
docker compose up -d --build --force-recreate charlie-bot
docker compose logs --tail=80 -f charlie-bot
```

Hacer solamente `docker compose build` genera una imagen pero no reemplaza el contenedor que ya estaba corriendo; `docker compose restart` tampoco cambia su imagen. El comando anterior reconstruye y recrea el servicio conservando su volumen. Al conectar, los logs muestran `v3.1 | revisión=<commit>` para comprobar que arrancó el código esperado.

Si sigue apareciendo una conducta anterior, verificá la revisión, la imagen y el volumen realmente usados:

```bash
docker compose exec charlie-bot printenv BOT_REVISION AUTH_FOLDER
docker inspect charlie-bot --format '{{.Image}}'
docker image inspect charlie-bot:latest --format '{{.Id}}'
docker inspect charlie-bot --format '{{range .Mounts}}{{println .Name .Destination}}{{end}}'
```

Los dos IDs de imagen deben coincidir, y el volumen existente debe seguir montado en `/app/data`. Cambiar de carpeta o nombre de proyecto de Compose puede seleccionar otro volumen y pedir QR. Revisá también que no haya otra instancia del bot ejecutándose con `npm start` u otro despliegue. La sesión guarda credenciales, no código: volver a escanear QR no es el mecanismo para aplicar una corrección. Sin los logs del servidor no se puede determinar cuál de estas situaciones causó un incidente concreto.

El bot acepta mensajes nuevos y los entregados tras estar offline (`append`), evita repetir mensajes con el mismo ID durante una hora y cancela los lotes pendientes de conexiones anteriores. Al recibir `SIGTERM` durante una recreación cierra el socket sin desvincular y espera las escrituras de credenciales pendientes.

### Validación local

```bash
npm test
```

Las pruebas cubren texto antes del sticker, álbumes con hijos demorados o fuera de orden, duplicados, mensajes recibidos mientras está ocupado, cancelación al reconectar, formato del sticker y selección de `FFMPEG_BIN`. No conectan a WhatsApp ni modifican la sesión real.
