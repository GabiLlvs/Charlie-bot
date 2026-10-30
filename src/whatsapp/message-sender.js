import { getReplyJidCandidates } from "../reply-jid.js";
import { sendMessageSafe } from "../send-utils.js";
import { EXPECTED_PHONE, INBOUND_TOKEN_WARM_MS } from "../config.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

export async function sendToChat(sock, msg, content) {
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
