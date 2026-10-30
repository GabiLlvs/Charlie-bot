import { readFile } from "node:fs/promises";

const stickerUrl = new URL("./assets/angry-charlie.webp", import.meta.url);
let sticker;

export async function getRejectionSticker() {
  sticker ??= await readFile(stickerUrl);
  return sticker;
}
