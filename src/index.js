import { rm } from "node:fs/promises";
import makeWASocket, {
  Browsers,
  DisconnectReason,
  downloadMediaMessage,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";
import sharp from "sharp";
import { getReplyJidCandidates } from "./reply-jid.js";
import { sendMessageSafe } from "./send-utils.js";
import pino from "pino";
import qrcode from "qrcode-terminal";
import { pickMultiPhotoReply } from "./multiPhotoReplies.js";
import { mediaToSticker } from "./sticker.js";

const BOT_VERSION = "3.0";
const MEDIA_BATCH_MS = 900;
const POST_CONNECT_REPLY_MS = 22_000;
const INBOUND_TOKEN_WARM_MS = 2_000;

const AUTH_FOLDER = process.env.AUTH_FOLDER || "./auth_info";
const EXPECTED_PHONE = (process.env.BOT_PHONE || "5492613417054").replace(/\D/g, "");

const logger = pino({ level: process.env.LOG_LEVEL || "warn" });

/** @type {ReturnType<typeof makeWASocket> | null} */
let activeSocket = null;
let connectGeneration = 0;
let isStarting = false;
/** @type {ReturnType<typeof setTimeout> | null} */
let reconnectTimer = null;
/** @type {{ id?: string, lid?: string }} */
let accountMe = {};
/** @type {{ ready: boolean, timer: ReturnType<typeof setTimeout> | null, gen: number }} */
let replyGate = { ready: false, timer: null, gen: 0 };

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resetReplyGate(generation) {
  if (replyGate.timer) clearTimeout(replyGate.timer);
  replyGate = { ready: false, timer: null, gen: generation };
  replyGate.timer = setTimeout(() => {
    if (replyGate.gen !== generation || replyGate.ready) return;
    replyGate.ready = true;
    console.log("WhatsApp sync listo (timeout) — ya puedo responder stickers.");
  }, POST_CONNECT_REPLY_MS);
}

function markReplyReady(generation, reason) {
  if (replyGate.gen !== generation || replyGate.ready) return;
  replyGate.ready = true;
  if (replyGate.timer) clearTimeout(replyGate.timer);
  replyGate.timer = null;
  console.log(`WhatsApp sync listo (${reason}) — ya puedo responder stickers.`);
}

async function waitUntilReplyReady(generation) {
  while (replyGate.gen === generation && !replyGate.ready) {
    await sleep(400);
  }
}

async function warmContactTokens(sock, msg) {
  if (typeof sock.issuePrivacyTokens !== "function") return;
  const jids = getReplyJidCandidates(msg, EXPECTED_PHONE);
  if (!jids.length) return;
  try {
    await sock.issuePrivacyTokens(jids, Math.floor(Date.now() / 1000));
  } catch {
    /* Baileys también emite tokens al recibir mensajes */
  }
  await sleep(INBOUND_TOKEN_WARM_MS);
}

function jidToPhone(jid) {
  if (!jid) return "";
  return jid.split("@")[0].split(":")[0].replace(/\D/g, "");
}

async function extractMediaBuffer(waMessage, sock) {
  const stream = await downloadMediaMessage(
    waMessage,
    "buffer",
    {},
    { logger, reuploadRequest: sock.updateMediaMessage },
  );
  return Buffer.isBuffer(stream) ? stream : Buffer.from(stream);
}

function isMultiPhotoAlbum(message) {
  const album = message.message?.albumMessage;
  if (!album) return false;
  const total =
    (album.expectedImageCount ?? 0) + (album.expectedVideoCount ?? 0);
  return total > 1;
}

function getIncomingMedia(message) {
  const msg = message.message;
  if (!msg) return null;

  if (msg.albumMessage) {
    return isMultiPhotoAlbum(message) ? { album: true } : null;
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
function shouldHandleMessage(msg, media) {
  if (!msg.key.fromMe) return true;
  if (media.album) return true;
  const m = msg.message;
  if (m?.imageMessage || m?.videoMessage) return true;
  if (m?.documentMessage) return true;
  return false;
}

/** @type {Map<string, { msgs: object[], timer: ReturnType<typeof setTimeout> | null }>} */
const pendingByChat = new Map();
let processingMedia = false;

async function sendToChat(sock, msg, content) {
  await warmContactTokens(sock, msg);
  const candidates = getReplyJidCandidates(msg, EXPECTED_PHONE);
  if (!candidates.length) throw new Error("No hay JID de destino");
  const key = msg.key ?? {};
  const useQuoted = key.remoteJid?.endsWith("@lid") ? { quoted: msg } : {};

  let lastErr;
  for (const jid of candidates) {
    console.log(
      `Enviando a ${jid} (chat=${key.remoteJid}, senderPn=${key.senderPn ?? "-"})…`,
    );
    try {
      return await sendMessageSafe(sock, jid, content, useQuoted);
    } catch (err) {
      lastErr = err;
      console.log(`  ↳ falló: ${err.message}`);
    }
  }
  throw lastErr ?? new Error("No se pudo enviar");
}

async function sendMultiPhotoQuip(sock, msg, msgs) {
  const text = pickMultiPhotoReply();
  await sendToChat(sock, msg, { text });
  console.log("✓ Mensaje enviado");
}

async function processOneSticker(sock, msg, media) {
  const buffer = await extractMediaBuffer(msg, sock);
  const sticker = await mediaToSticker(buffer, media.mimetype);

  if (!sticker?.length || sticker.length < 100) {
    throw new Error("El sticker quedó vacío o inválido");
  }

  const jpeg = await sharp(sticker).jpeg({ quality: 88 }).toBuffer();

  try {
    await sendToChat(sock, msg, { sticker });
    console.log(
      "✓ Sticker subido al servidor. Si no aparece o dice «Esperando mensaje», borrá auth_info/ y volvé a escanear QR.",
    );
    return;
  } catch (err) {
    console.log(`Sticker falló (${err.message}), pruebo como imagen JPEG…`);
  }

  await sendToChat(sock, msg, {
    image: jpeg,
    caption: "Tu sticker",
  });
  console.log(
    "✓ Imagen subida. Si no la ves, re-vinculá el bot (borrá auth_info/ y QR de nuevo).",
  );
}

function queueMediaMessage(sock, msg, media, sessionGeneration) {
  const chatId = msg.key.remoteJid;
  let bucket = pendingByChat.get(chatId);
  if (!bucket) {
    bucket = { msgs: [], timer: null };
    pendingByChat.set(chatId, bucket);
  }

  bucket.msgs.push({ msg, media });
  if (bucket.timer) clearTimeout(bucket.timer);

  bucket.timer = setTimeout(async () => {
    const batch = bucket.msgs;
    pendingByChat.delete(chatId);

    if (processingMedia) {
      console.log("Todavía procesando la foto anterior, mandá de a una.");
      return;
    }

    processingMedia = true;
    try {
      await waitUntilReplyReady(sessionGeneration);
      if (batch.length > 1) {
        await sendMultiPhotoQuip(sock, batch[0].msg, batch.map((b) => b.msg));
        return;
      }

      const { msg: single, media: singleMedia } = batch[0];
      if (singleMedia.album) {
        await sendMultiPhotoQuip(sock, single, [single]);
        return;
      }

      await processOneSticker(sock, single, singleMedia);
    } catch (err) {
      logger.error(err, "Error procesando media");
      console.error(`No pude responder: ${err.message}`);
    } finally {
      processingMedia = false;
    }
  }, MEDIA_BATCH_MS);
}

function scheduleReconnect(delayMs, reason) {
  if (reconnectTimer) return;
  console.log(`${reason} Reintento en ${Math.round(delayMs / 1000)}s...\n`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void startBot();
  }, delayMs);
}

async function startBot() {
  if (isStarting) return;
  isStarting = true;

  try {
  const generation = ++connectGeneration;

  if (activeSocket) {
    try {
      activeSocket.end(undefined);
    } catch {
      /* ignore */
    }
    activeSocket = null;
  }

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
  accountMe = {
    id: state.creds.me?.id,
    lid: state.creds.me?.lid,
  };

  resetReplyGate(generation);

  const sock = makeWASocket({
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    logger,
    printQRInTerminal: false,
    syncFullHistory: false,
    markOnlineOnConnect: true,
    emitOwnEvents: false,
    enableAutoSessionRecreation: true,
    browser: Browsers.macOS("Desktop"),
  });
  activeSocket = sock;

  sock.ev.on("creds.update", (creds) => {
    if (creds.me) {
      accountMe = { id: creds.me.id ?? accountMe.id, lid: creds.me.lid ?? accountMe.lid };
    }
    saveCreds();
  });

  sock.ev.on("connection.update", (update) => {
    if (generation !== connectGeneration) return;

    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("\nEscaneá este QR con WhatsApp en el teléfono +5492613417054:\n");
      console.log("  Ajustes → Dispositivos vinculados → Vincular dispositivo\n");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "open") {
      const me = jidToPhone(sock.user?.id);
      console.log(`\nBot conectado${me ? ` como ${me}` : ""}.`);
      if (EXPECTED_PHONE && me && !me.endsWith(EXPECTED_PHONE) && me !== EXPECTED_PHONE) {
        console.warn(
          `Aviso: el número conectado (${me}) no coincide con BOT_PHONE (${EXPECTED_PHONE}).`,
        );
      }
      console.log(
        `Bot stickers v${BOT_VERSION} | Baileys 7 | me.lid=${accountMe.lid ?? "?"}`,
      );
      console.log(
        `Esperá ~${Math.round(POST_CONNECT_REPLY_MS / 1000)}s tras conectar (sync WhatsApp) antes de mandar la primera foto.`,
      );
      console.log("Enviá una foto o GIF al chat y te devuelvo un sticker.");
      console.log(
        "IMPORTANTE: no uses «Mensajes a ti mismo». Usá OTRO celular → foto al +5492613417054.",
      );
      console.log(
        "Si alguna vez viste «Esperando mensaje» o Bad MAC: borrá auth_info/, desvinculá TODOS los dispositivos en el celular, volvé a vincular solo este bot.\n",
      );
    }

    if (connection === "close") {
      const status = lastDisconnect?.error?.output?.statusCode;
      const loggedOut =
        status === DisconnectReason.loggedOut ||
        status === 401 ||
        status === 403;

      if (loggedOut) {
        console.log(
          "\nWhatsApp cerró la sesión (desvinculaste el dispositivo, otro login, o expiró).",
        );
        console.log("Generando QR nuevo...\n");
        void (async () => {
          try {
            await rm(AUTH_FOLDER, { recursive: true, force: true });
          } catch {
            /* ignore */
          }
          await startBot();
        })();
        return;
      }

      if (
        status === DisconnectReason.connectionReplaced ||
        status === 440
      ) {
        console.log(
          "\nOtra sesión de WhatsApp Web reemplazó al bot (conflict / replaced).",
        );
        console.log(
          "Solo puede haber UNA conexión: cerrá WhatsApp Web en el navegador,",
        );
        console.log(
          "otras terminales con npm start, y dejá solo esta instancia del bot.",
        );
        scheduleReconnect(15_000, "Esperando que cierres la otra sesión.");
        return;
      }

      console.log(`Conexión cerrada (código ${status ?? "?"}).`);
      scheduleReconnect(5_000, "Reconectando.");
    }
  });

  sock.ev.on("chats.phoneNumberShare", ({ lid, jid }) => {
    console.log(`Mapeo LID↔PN: ${lid} ↔ ${jid}`);
  });

  sock.ev.on("messaging-history.status", (status) => {
    if (generation !== connectGeneration) return;
    if (status.status === "complete" || status.status === "paused") {
      markReplyReady(generation, `historial ${status.status}`);
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (generation !== connectGeneration) return;
    if (type !== "notify" && type !== "append") return;

    for (const msg of messages) {
      const media = getIncomingMedia(msg);
      if (!media) continue;
      if (!shouldHandleMessage(msg, media)) continue;

      const chatId = msg.key.remoteJid;
      if (!chatId || chatId.endsWith("@g.us")) {
        continue;
      }

      if (chatId.endsWith("@lid") && msg.key.fromMe) {
        console.log(
          "⚠️ Ignoro foto en «mensajes a ti mismo» (@lid). Usá el OTRO celular → +5492613417054.\n",
        );
        continue;
      }

      const replyTargets = getReplyJidCandidates(msg, EXPECTED_PHONE).join(" → ");
      const alt = msg.key.remoteJidAlt ?? "-";
      console.log(
        `Foto recibida chat=${msg.key.remoteJid} alt=${alt} fromMe=${Boolean(msg.key.fromMe)} → respuesta: ${replyTargets}`,
      );
      queueMediaMessage(sock, msg, media, generation);
    }
  });
  } finally {
    isStarting = false;
  }
}

startBot().catch((err) => {
  console.error(err);
  process.exit(1);
});
