function parseSenderPn(key) {
  const raw = key?.senderPn || key?.participantPn;
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length < 10) return null;
  return `${digits}@s.whatsapp.net`;
}

function isPlausibleArMobile(digits, ownPhoneDigits) {
  if (!digits || digits === ownPhoneDigits) return false;
  if (digits.length < 12 || digits.length > 15) return false;
  return digits.startsWith("549");
}

/** Dónde responder según el mensaje entrante. */
export function getReplyJidCandidates(msg, ownPhoneDigits = "") {
  const key = msg.key ?? {};
  const { remoteJid, fromMe } = key;

  if (remoteJid?.endsWith("@s.whatsapp.net")) {
    const digits = remoteJid.split("@")[0].replace(/\D/g, "");
    if (digits && digits !== ownPhoneDigits) {
      return [remoteJid];
    }
  }

  if (!fromMe) {
    // WhatsApp entrega el chat como @lid; responder al PN cuando hay LID mapeado suele dar error 463.
    if (remoteJid?.endsWith("@lid")) {
      return [remoteJid];
    }
    if (remoteJid?.endsWith("@s.whatsapp.net")) {
      return [remoteJid];
    }
    const senderJid = parseSenderPn(key);
    if (senderJid) {
      const d = senderJid.split("@")[0].replace(/\D/g, "");
      if (isPlausibleArMobile(d, ownPhoneDigits)) {
        return [senderJid];
      }
    }
  }

  if (fromMe && ownPhoneDigits) {
    return [`${ownPhoneDigits}@s.whatsapp.net`];
  }

  if (ownPhoneDigits) {
    return [`${ownPhoneDigits}@s.whatsapp.net`];
  }

  return remoteJid ? [remoteJid] : [];
}

export function getReplyJid(msg, ownPhoneDigits = "") {
  return getReplyJidCandidates(msg, ownPhoneDigits)[0];
}
