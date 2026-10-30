import { downloadMediaMessage, normalizeMessageContent, proto } from "@whiskeysockets/baileys";
import { logger } from "../config.js";

export async function extractMediaBuffer(waMessage, sock) {
  const stream = await downloadMediaMessage(
    waMessage,
    "buffer",
    {},
    { logger, reuploadRequest: sock.updateMediaMessage },
  );
  return Buffer.isBuffer(stream) ? stream : Buffer.from(stream);
}

export function getIncomingMedia(message) {
  const msg = normalizeMessageContent(message.message);
  if (!msg) return null;

  if (msg.albumMessage) {
    const album = msg.albumMessage;
    const total = (album.expectedImageCount ?? 0) + (album.expectedVideoCount ?? 0);
    return total > 1 ? { album: true, albumId: message.key.id } : null;
  }

  // Los hijos pueden llegar mucho después del encabezado o antes de él.
  const association = msg.messageContextInfo?.messageAssociation
    ?? message.message?.messageContextInfo?.messageAssociation;
  if (association?.associationType === proto.MessageAssociation.AssociationType.MEDIA_ALBUM
    && association.parentMessageKey?.id) {
    return { album: true, albumId: association.parentMessageKey.id };
  }

  if (msg.imageMessage) {
    return { content: msg.imageMessage, mimetype: msg.imageMessage.mimetype };
  }
  if (msg.videoMessage) {
    return { content: msg.videoMessage, mimetype: msg.videoMessage.mimetype };
  }
  if (msg.documentMessage) {
    const mime = msg.documentMessage.mimetype || "";
    if (mime.startsWith("image/") || mime.startsWith("video/")) {
      return { content: msg.documentMessage, mimetype: mime };
    }
  }
  if (msg.stickerMessage) {
    return {
      content: msg.stickerMessage,
      mimetype: msg.stickerMessage.mimetype || "image/webp",
    };
  }
  return null;
}

/** Fotos desde el celular del mismo número llegan con fromMe: true */
export function shouldHandleMessage(msg, media) {
  if (!msg.key.fromMe) return true;
  if (media.album) return true;
  const message = normalizeMessageContent(msg.message);
  if (message?.imageMessage || message?.videoMessage) return true;
  if (message?.documentMessage) return true;
  return false;
}
