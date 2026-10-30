import sharp from "sharp";
import { pickMultiPhotoReply } from "../multiPhotoReplies.js";
import { mediaToSticker } from "../sticker.js";
import { logger, MEDIA_BATCH_MS } from "../config.js";
import { extractMediaBuffer } from "./message-utils.js";
import { sendToChat } from "./message-sender.js";
import { getRejectionSticker } from "../rejection-sticker.js";

async function processOneSticker(sock, msg, media, isCurrent = () => true) {
  const buffer = await extractMediaBuffer(msg, sock);
  if (!isCurrent()) return;
  const sticker = await mediaToSticker(buffer, media.mimetype);
  if (!isCurrent()) return;

  if (!sticker?.length || sticker.length < 100) {
    throw new Error("El sticker quedó vacío o inválido");
  }

  try {
    await sendToChat(sock, msg, { sticker });
    console.log("✓ Sticker subido al servidor.");
    return;
  } catch (err) {
    console.log(`Sticker falló (${err.message}), pruebo como imagen JPEG…`);
  }

  if (!isCurrent()) return;
  const jpeg = await sharp(sticker).jpeg({ quality: 88 }).toBuffer();
  if (!isCurrent()) return;
  await sendToChat(sock, msg, {
    image: jpeg,
    caption: "Tu sticker",
  });
  console.log("✓ Imagen subida.");
}

const RECENT_TTL_MS = 60 * 60 * 1000;
const MAX_RECENT = 10_000;

function remember(map, key) {
  const now = Date.now();
  for (const [id, expires] of map) {
    if (expires > now) break;
    map.delete(id);
  }
  if (map.has(key)) return false;
  map.set(key, now + RECENT_TTL_MS);
  if (map.size > MAX_RECENT) map.delete(map.keys().next().value);
  return true;
}

export function createMediaMessageHandler({
  batchMs = MEDIA_BATCH_MS,
  sendReply = sendToChat,
  processSticker = processOneSticker,
} = {}) {
  const pendingByChat = new Map();
  const recentMessages = new Map();
  const rejectedAlbums = new Map();
  let work = Promise.resolve();
  let epoch = 0;

  function reset() {
    epoch++;
    for (const bucket of pendingByChat.values()) clearTimeout(bucket.timer);
    pendingByChat.clear();
    work = Promise.resolve();
  }

  function queueMediaMessage(sock, msg, media, sessionGeneration, waitUntilReplyReady) {
    const chatId = msg.key.remoteJid;
    if (msg.key.id && !remember(recentMessages, `${chatId}:${msg.key.id}`)) return;

    let bucket = pendingByChat.get(chatId);
    if (!bucket) {
      bucket = { msgs: [], timer: null };
      pendingByChat.set(chatId, bucket);
    }
    bucket.msgs.push({ msg, media });
    if (bucket.timer) clearTimeout(bucket.timer);
    const queuedEpoch = epoch;

    bucket.timer = setTimeout(() => {
      pendingByChat.delete(chatId);
      // Serializar en vez de descartar mensajes cuando otra conversión está ocupada.
      work = work.then(async () => {
        if (queuedEpoch !== epoch) return;
        const ready = await waitUntilReplyReady(sessionGeneration);
        if (ready === false || queuedEpoch !== epoch) return;

        const batch = bucket.msgs.filter(({ media }) =>
          !media.albumId || (rejectedAlbums.get(`${chatId}:${media.albumId}`) ?? 0) <= Date.now(),
        );
        if (!batch.length) return;

        if (batch.length > 1 || batch[0].media.album) {
          const sticker = await getRejectionSticker();
          if (queuedEpoch !== epoch) return;
          await sendReply(sock, batch[0].msg, { text: pickMultiPhotoReply() });
          if (queuedEpoch !== epoch) return;
          await sendReply(sock, batch[0].msg, { sticker });
          for (const { media } of batch) {
            if (media.albumId) remember(rejectedAlbums, `${chatId}:${media.albumId}`);
          }
          console.log("✓ Aviso de varias imágenes y sticker de Charlie enviados");
          return;
        }

        const { msg: single, media: singleMedia } = batch[0];
        await processSticker(sock, single, singleMedia, () => queuedEpoch === epoch);
      }).catch((err) => {
        logger.error(err, "Error procesando media");
        console.error(`No pude responder: ${err.message}`);
      });
    }, batchMs);
  }

  return { queueMediaMessage, reset };
}

const handler = createMediaMessageHandler();
export const queueMediaMessage = handler.queueMediaMessage;
export const resetMediaQueue = handler.reset;
