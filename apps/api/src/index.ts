import { buildServer } from "./server.js";
import { loadEnv } from "./env.js";

const env = loadEnv();
const app = await buildServer();
app.listen({ port: env.port, host: "0.0.0.0" }).catch((err: unknown) => {
  app.log.error(err);
  process.exit(1);
});
