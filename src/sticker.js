import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpegPath from "ffmpeg-static";
import sharp from "sharp";

const STICKER_SIZE = 512;
const MAX_STATIC_BYTES = 500 * 1024;
const MAX_ANIMATED_BYTES = 500 * 1024;

const GIF_MIMES = new Set([
  "image/gif",
  "video/mp4",
  "video/quicktime",
]);

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const bin = process.env.FFMPEG_BIN || ffmpegPath;
    if (!bin) {
      reject(new Error("ffmpeg no está disponible"));
      return;
    }
    const proc = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `ffmpeg salió con código ${code}`));
    });
  });
}

async function imageToStickerWebp(buffer) {
  let quality = 90;
  let lastBuffer = null;

  while (quality >= 40) {
    lastBuffer = await sharp(buffer)
      .resize(STICKER_SIZE, STICKER_SIZE, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .webp({ quality, effort: 6 })
      .toBuffer();

    if (lastBuffer.length <= MAX_STATIC_BYTES) {
      return lastBuffer;
    }
    quality -= 10;
  }

  return lastBuffer;
}

async function animatedToStickerWebp(buffer, inputExt) {
  const dir = await mkdtemp(join(tmpdir(), "wa-sticker-"));
  const inputPath = join(dir, `input.${inputExt}`);
  const outputPath = join(dir, "sticker.webp");

  try {
    await writeFile(inputPath, buffer);

    const filters = [
      "scale=512:512:force_original_aspect_ratio=decrease",
      "pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000",
      "fps=15",
    ].join(",");

    const attempts = [
      ["-i", inputPath, "-vf", filters, "-loop", "0", "-an", "-vsync", "0", "-y", outputPath],
      [
        "-i",
        inputPath,
        "-vf",
        filters,
        "-loop",
        "0",
        "-an",
        "-c:v",
        "libwebp",
        "-quality",
        "75",
        "-compression_level",
        "6",
        "-y",
        outputPath,
      ],
    ];

    let lastError;
    for (const args of attempts) {
      try {
        await runFfmpeg(args);
        lastError = null;
        break;
      } catch (err) {
        lastError = err;
      }
    }
    if (lastError) throw lastError;

    let webp = await readFile(outputPath);
    if (webp.length > MAX_ANIMATED_BYTES) {
      await runFfmpeg([
        "-i",
        inputPath,
        "-vf",
        `${filters},fps=10`,
        "-loop",
        "0",
        "-an",
        "-c:v",
        "libwebp",
        "-quality",
        "60",
        "-y",
        outputPath,
      ]);
      webp = await readFile(outputPath);
    }

    return webp;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function isGifLike(mimetype) {
  return GIF_MIMES.has(mimetype) || mimetype === "image/gif";
}

export async function mediaToSticker(buffer, mimetype) {
  const mime = (mimetype || "").toLowerCase();

  if (mime === "image/webp") {
    const meta = await sharp(buffer).metadata();
    if (meta.pages && meta.pages > 1) {
      return animatedToStickerWebp(buffer, "webp");
    }
    return imageToStickerWebp(buffer);
  }

  if (mime === "image/gif") {
    return animatedToStickerWebp(buffer, "gif");
  }

  if (mime.startsWith("video/")) {
    const ext = mime.includes("quicktime") ? "mov" : "mp4";
    return animatedToStickerWebp(buffer, ext);
  }

  if (mime.startsWith("image/")) {
    return imageToStickerWebp(buffer);
  }

  throw new Error(`Tipo de archivo no soportado: ${mime || "desconocido"}`);
}
