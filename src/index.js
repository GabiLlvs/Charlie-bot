import { startBot, stopBot } from "./whatsapp/bot.js";

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.once(signal, () => {
    stopBot().then(() => process.exit(0)).catch((err) => {
      console.error(err);
      process.exit(1);
    });
  });
}

startBot().catch((err) => {
  console.error(err);
  process.exit(1);
});
