import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: "0.0.0.0",
    port: Number.parseInt(process.env.WEB_PORT ?? "5173", 10)
  }
});
