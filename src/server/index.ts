import { createApp } from "./app.js";
import { config } from "./config.js";

const coordinator = await createApp();
const server = coordinator.app.listen(config.port, "0.0.0.0", () => {
  console.log(`Audio Studio coordinator listening on port ${config.port}`);
});

function shutdown() {
  coordinator.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
