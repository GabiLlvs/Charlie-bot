import { WAMessageStatus } from "@whiskeysockets/baileys";

const ERROR_WAIT_MS = 4_000;
const RETRY_463_MS = 3_500;
const MAX_SEND_ATTEMPTS = 3;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Envía y falla solo si WhatsApp devuelve error explícito (463, etc.). */
export async function sendMessageSafe(sock, jid, content, options = {}) {
  let lastErr;

  for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt++) {
    if (typeof sock.assertSessions === "function") {
      try {
        await sock.assertSessions([jid], false);
      } catch {
        /* ignore */
      }
    }

    try {
      const sent = await sock.sendMessage(jid, content, {
        useUserDevicesCache: false,
        ...options,
      });
      await waitForExplicitError(sock, sent.key.id);
      return sent;
    } catch (err) {
      lastErr = err;
      const is463 = String(err.message).includes("463");
      if (!is463 || attempt >= MAX_SEND_ATTEMPTS) {
        throw err;
      }
      console.log(
        `  ↳ error 463, esperando token de confianza (intento ${attempt}/${MAX_SEND_ATTEMPTS})…`,
      );
      await sleep(RETRY_463_MS);
    }
  }

  throw lastErr ?? new Error("No se pudo enviar");
}

function waitForExplicitError(sock, messageId) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve(undefined);
    }, ERROR_WAIT_MS);

    const onUpdate = (updates) => {
      for (const u of updates) {
        if (u.key?.id !== messageId) continue;
        if (u.update?.status === WAMessageStatus.ERROR) {
          const code = u.update.messageStubParameters?.[0] ?? "?";
          cleanup();
          reject(new Error(`WhatsApp error ${code}`));
          return;
        }
      }
    };

    const cleanup = () => {
      clearTimeout(timer);
      sock.ev.off("messages.update", onUpdate);
    };

    sock.ev.on("messages.update", onUpdate);
  });
}
