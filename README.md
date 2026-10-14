# Charlie-bot

Bot de stickers para WhatsApp.

Recibís una **foto** o **GIF** (también video corto) y el bot responde con un **sticker** WebP 512×512.

Pensado para el número **+5492613417054** (Argentina). La sesión se vincula escaneando un QR desde ese teléfono.

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
