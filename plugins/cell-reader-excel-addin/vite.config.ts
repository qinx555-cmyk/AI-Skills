import { defineConfig } from "vite";
import { getHttpsServerOptions } from "office-addin-dev-certs";

export default defineConfig(async ({ command }) => {
  const httpsOptions = command === "serve" ? await getHttpsServerOptions() : undefined;

  return {
    server: {
      host: "localhost",
      port: 3000,
      strictPort: true,
      https: httpsOptions,
    },
    build: {
      rollupOptions: {
        input: {
          taskpane: "taskpane.html",
          commands: "commands.html",
        },
      },
    },
  };
});
