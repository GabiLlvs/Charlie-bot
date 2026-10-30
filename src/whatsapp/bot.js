import { rm } from "node:fs/promises";
import makeWASocket, {
  Browsers,
  DisconnectReason,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";
import {
  AUTH_FOLDER,
  BOT_VERSION,
  BOT_REVISION,
  EXPECTED_PHONE,
  logger,
  POST_CONNECT_REPLY_MS,
} from "../config.js";
import { getReplyJidCandidates } from "../reply-jid.js";
import { getIncomingMedia, shouldHandleMessage } from "./message-utils.js";
import { queueMediaMessage, resetMediaQueue } from "./message-handler.js";
import { getRejectionSticker } from "../rejection-sticker.js";

let activeSocket = null;
let connectGeneration = 0;
let isStarting = false;
let reconnectTimer = null;
let accountMe = {};
let replyGate = { ready: false, timer: null, gen: 0 };
let stopping = false;
let credentialWrites = Promise.resolve();

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
  return generation === connectGeneration && replyGate.ready;
}

function jidToPhone(jid) {
  if (!jid) return "";
  return jid.split("@")[0].split(":")[0].replace(/\D/g, "");
}

function scheduleReconnect(delayMs, reason) {
  if (reconnectTimer || stopping) return;
  console.log(`${reason} Reintento en ${Math.round(delayMs / 1000)}s...\n`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    startBot().catch((err) => {
      logger.error(err, "No se pudo reconectar");
      scheduleReconnect(5_000, "Reconectando.");
    });
  }, delayMs);
}

function showConnectionInstructions(sock) {
  const me = jidToPhone(sock.user?.id);
  console.log(`\nBot conectado${me ? ` como ${me}` : ""}.`);
  if (
    EXPECTED_PHONE &&
    me &&
    !me.endsWith(EXPECTED_PHONE) &&
    me !== EXPECTED_PHONE
  ) {
    console.warn(
      `Aviso: el número conectado (${me}) no coincide con BOT_PHONE (${EXPECTED_PHONE}).`,
    );
  }
  console.log(
    `Bot stickers v${BOT_VERSION} | revisión=${BOT_REVISION} | Baileys 7 | me.lid=${accountMe.lid ?? "?"}`,
  );
  console.log(
    `Esperá ~${Math.round(POST_CONNECT_REPLY_MS / 1000)}s tras conectar (sync WhatsApp) antes de mandar la primera foto.`,
  );
  console.log("Enviá una foto o GIF al chat y te devuelvo un sticker.");
  console.log(
    "IMPORTANTE: no uses «Mensajes a ti mismo». Usá OTRO celular → foto al +5492613417054.",
  );
  console.log(
    "Las actualizaciones conservan la sesión. Si falla el envío, revisá los logs y que no haya otra instancia conectada.\n",
  );
}

async function handleLoggedOut() {
  console.log(
    "\nWhatsApp cerró la sesión (desvinculaste el dispositivo, otro login, o expiró).",
  );
  console.log("Generando QR nuevo...\n");
  try {
    await credentialWrites;
    await rm(AUTH_FOLDER, { recursive: true, force: true });
  } catch (err) {
    logger.error(err, "No se pudo borrar la sesión de WhatsApp");
    return;
  }
  try {
    await startBot();
  } catch (err) {
    logger.error(err, "No se pudo iniciar la nueva sesión");
    scheduleReconnect(5_000, "Reconectando.");
  }
}

function handleConnectionClosed(update) {
  const status = update.lastDisconnect?.error?.output?.statusCode;
  const loggedOut =
    status === DisconnectReason.loggedOut || status === 401 || status === 403;

  if (loggedOut) {
    void handleLoggedOut();
    return;
  }

  if (status === DisconnectReason.connectionReplaced || status === 440) {
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

function registerConnectionHandlers(sock, generation) {
  sock.ev.on("connection.update", (update) => {
    if (generation !== connectGeneration) return;

    const { connection, qr } = update;
    if (qr) {
      console.log(
        "\nEscaneá este QR con WhatsApp en el teléfono +5492613417054:\n",
      );
      console.log("  Ajustes → Dispositivos vinculados → Vincular dispositivo\n");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "open") showConnectionInstructions(sock);
    if (connection === "close") {
      connectGeneration++;
      if (replyGate.timer) clearTimeout(replyGate.timer);
      replyGate = { ready: false, timer: null, gen: connectGeneration };
      resetMediaQueue();
      handleConnectionClosed(update);
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
    // append también entrega mensajes recibidos mientras el bot estaba offline.
    if (type !== "notify" && type !== "append") return;

    for (const msg of messages) {
      const media = getIncomingMedia(msg);
      if (!media || !shouldHandleMessage(msg, media)) continue;

      const chatId = msg.key.remoteJid;
      if (!chatId || chatId.endsWith("@g.us")) continue;

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
      queueMediaMessage(sock, msg, media, generation, waitUntilReplyReady);
    }
  });
}

export async function startBot() {
  if (isStarting || stopping) return;
  isStarting = true;

  try {
    const generation = ++connectGeneration;
    resetMediaQueue();
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    await getRejectionSticker();

    if (activeSocket) {
      try {
        activeSocket.end(undefined);
      } catch {
        /* ignore */
      }
      activeSocket = null;
    }

    await credentialWrites;
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
    if (stopping || generation !== connectGeneration) return;
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
      if (generation !== connectGeneration) return;
      if (creds.me) {
        accountMe = {
          id: creds.me.id ?? accountMe.id,
          lid: creds.me.lid ?? accountMe.lid,
        };
      }
      credentialWrites = credentialWrites.then(saveCreds).catch((err) => {
        logger.error(err, "No se pudo guardar la sesión de WhatsApp");
      });
    });

    registerConnectionHandlers(sock, generation);
  } finally {
    isStarting = false;
  }
}

export async function stopBot() {
  stopping = true;
  connectGeneration++;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (replyGate.timer) clearTimeout(replyGate.timer);
  replyGate = { ready: false, timer: null, gen: connectGeneration };
  resetMediaQueue();
  // Cerrar el socket conserva las credenciales; logout() desvincularía el dispositivo.
  activeSocket?.end(undefined);
  activeSocket = null;
  await credentialWrites;
}
