import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { test } from "node:test";
import sharp from "sharp";
import { createMediaMessageHandler } from "../src/whatsapp/message-handler.js";
import { getIncomingMedia, shouldHandleMessage } from "../src/whatsapp/message-utils.js";
import { getRejectionSticker } from "../src/rejection-sticker.js";
import { mediaToSticker } from "../src/sticker.js";

const chat = "5491112345678@s.whatsapp.net";
const photo = (id, remoteJid = chat) => ({
  key: { id, remoteJid, fromMe: false },
  message: { imageMessage: { mimetype: "image/jpeg" } },
});
const album = (id) => ({
  key: { id, remoteJid: chat },
  message: { albumMessage: { expectedImageCount: 2 } },
});
const child = (id, parentId) => ({
  ...photo(id),
  message: {
    ...photo(id).message,
    messageContextInfo: {
      messageAssociation: { associationType: 1, parentMessageKey: { id: parentId } },
    },
  },
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function setup(t, options = {}) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const replies = [];
  const converted = [];
  const handler = createMediaMessageHandler({
    batchMs: 10,
    sendReply: async (_sock, msg, content) => replies.push({ msg, content }),
    processSticker: async (_sock, msg) => converted.push(msg.key.id),
    ...options,
  });
  t.after(handler.reset);
  return {
    ...handler, replies, converted,
    queue: (msg, ready = async () => true) =>
      handler.queueMediaMessage({}, msg, getIncomingMedia(msg), 1, ready),
    flush: async () => {
      t.mock.timers.tick(10);
      // El primer rechazo también lee el archivo de sticker del disco.
      for (let i = 0; i < 5; i++) await setImmediate();
    },
  };
}

// Cargar antes de los timers simulados; el resto de las pruebas usa el mismo asset.
await getRejectionSticker();

test("dos fotos: espera a que termine el texto antes de enviar el sticker", async (t) => {
  const textSent = deferred();
  const replies = [];
  const h = setup(t, {
    sendReply: async (_sock, _msg, content) => {
      replies.push(content);
      if (content.text) await textSent.promise;
    },
  });
  h.queue(photo("one"));
  h.queue(photo("two"));
  await h.flush();
  assert.equal(replies.length, 1);
  assert.equal(typeof replies[0].text, "string");
  textSent.resolve();
  await h.flush();
  assert.equal(replies.length, 2);
  assert.deepEqual(replies[1].sticker, await getRejectionSticker());
  assert.deepEqual(h.converted, []);
});

test("una foto sigue generando su sticker", async (t) => {
  const h = setup(t);
  h.queue(photo("single"));
  await h.flush();
  assert.deepEqual(h.converted, ["single"]);
  assert.equal(h.replies.length, 0);
});

test("un mismo ID de notify y append no duplica stickers, incluso al reconectar", async (t) => {
  const h = setup(t);
  h.queue(photo("same"));
  h.queue(photo("same"));
  await h.flush();
  h.reset();
  h.queue(photo("same"));
  await h.flush();
  assert.deepEqual(h.converted, ["same"]);
  assert.equal(h.replies.length, 0);
});

test("álbum: un solo aviso y sticker aunque los hijos lleguen tarde", async (t) => {
  const h = setup(t);
  h.queue(album("album"));
  await h.flush();
  h.queue(child("one", "album"));
  await h.flush();
  h.queue(child("two", "album"));
  await h.flush();
  assert.equal(h.replies.length, 2);
  assert.deepEqual(h.converted, []);
});

test("álbum: reconoce hijos que llegan antes que el encabezado", async (t) => {
  const h = setup(t);
  h.queue(child("one", "album"));
  await h.flush();
  h.queue(album("album"));
  h.queue(child("two", "album"));
  await h.flush();
  assert.equal(h.replies.length, 2);
  assert.deepEqual(h.converted, []);
});

test("dos álbumes distintos reciben un aviso y sticker cada uno", async (t) => {
  const h = setup(t);
  h.queue(album("first"));
  await h.flush();
  h.queue(album("second"));
  await h.flush();
  assert.equal(h.replies.length, 4);
  assert.deepEqual(h.converted, []);
});

test("no descarta el rechazo mientras procesa otro sticker", async (t) => {
  const converting = deferred();
  const h = setup(t, { processSticker: async () => converting.promise });
  h.queue(photo("single"));
  await h.flush();
  h.queue(photo("one"));
  h.queue(photo("two"));
  await h.flush();
  assert.equal(h.replies.length, 0);
  converting.resolve();
  await h.flush();
  assert.equal(h.replies.length, 2);
});

test("no descarta fotos de otro chat mientras está ocupado", async (t) => {
  const converting = deferred();
  const converted = [];
  const h = setup(t, {
    processSticker: async (_sock, msg) => {
      converted.push(msg.key.id);
      if (msg.key.id === "first") await converting.promise;
    },
  });
  h.queue(photo("first"));
  await h.flush();
  h.queue(photo("second", "5491198765432@s.whatsapp.net"));
  await h.flush();
  converting.resolve();
  await h.flush();
  assert.deepEqual(converted, ["first", "second"]);
});

test("reconectar cancela timers de la conexión anterior", async (t) => {
  const h = setup(t);
  h.queue(album("old"));
  h.reset();
  await h.flush();
  assert.equal(h.replies.length, 0);
  assert.deepEqual(h.converted, []);
});

test("reconectar cancela un lote que esperaba el sync", async (t) => {
  const ready = deferred();
  const h = setup(t);
  h.queue(album("old"), () => ready.promise);
  await h.flush();
  h.reset();
  ready.resolve(true);
  await h.flush();
  assert.equal(h.replies.length, 0);
});

test("una conexión invalidada no responde", async (t) => {
  const h = setup(t);
  h.queue(album("old"), async () => false);
  await h.flush();
  assert.equal(h.replies.length, 0);
});

test("normaliza álbumes envueltos en associatedChildMessage", () => {
  const msg = child("wrapped", "album");
  msg.message = { associatedChildMessage: { message: msg.message } };
  assert.deepEqual(getIncomingMedia(msg), { album: true, albumId: "album" });
  assert.equal(shouldHandleMessage({ ...msg, key: { ...msg.key, fromMe: true } }, getIncomingMedia(msg)), true);
});

test("otra asociación de WhatsApp no se confunde con un álbum", () => {
  const msg = child("hd", "original");
  msg.message.messageContextInfo.messageAssociation.associationType = 10;
  assert.equal(getIncomingMedia(msg).album, undefined);
  assert.equal(getIncomingMedia(msg).mimetype, "image/jpeg");
});

test("el sticker de rechazo es WebP transparente 512×512 y menor a 500 KB", async () => {
  const sticker = await getRejectionSticker();
  const meta = await sharp(sticker).metadata();
  assert.equal(meta.format, "webp");
  assert.equal(meta.width, 512);
  assert.equal(meta.height, 512);
  assert.equal(meta.hasAlpha, true);
  assert.ok(sticker.length < 500 * 1024);
});

test("FFMPEG_BIN tiene prioridad y un binario inexistente falla sin colgar el proceso", async (t) => {
  const previous = process.env.FFMPEG_BIN;
  process.env.FFMPEG_BIN = "charlie-ffmpeg-not-installed";
  t.after(() => {
    if (previous === undefined) delete process.env.FFMPEG_BIN;
    else process.env.FFMPEG_BIN = previous;
  });
  await assert.rejects(mediaToSticker(Buffer.from("unused"), "video/mp4"), { code: "ENOENT" });
});
