import pino from "pino";

export const BOT_VERSION = "3.1";
export const BOT_REVISION = process.env.BOT_REVISION || "local";
export const MEDIA_BATCH_MS = 900;
export const POST_CONNECT_REPLY_MS = 22_000;
export const INBOUND_TOKEN_WARM_MS = 2_000;

export const AUTH_FOLDER = process.env.AUTH_FOLDER || "./auth_info";
export const EXPECTED_PHONE = (process.env.BOT_PHONE || "5492613417054").replace(
  /\D/g,
  "",
);

export const logger = pino({ level: process.env.LOG_LEVEL || "warn" });
