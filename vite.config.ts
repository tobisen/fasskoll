import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: {
      "/api/content": {
        target: "https://fass.se",
        changeOrigin: true,
        secure: true,
        headers: {
          origin: "https://fass.se",
          referer: "https://fass.se/health/pharmacy-stock-status",
          accept: "application/json, text/plain, */*",
        },
        configure(proxy) {
          proxy.on("proxyReq", (proxyReq) => {
            proxyReq.setHeader(
              "user-agent",
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
            );
            proxyReq.setHeader("accept-language", "sv-SE,sv;q=0.9,en-US;q=0.8,en;q=0.7");
            proxyReq.setHeader("origin", "https://fass.se");
            proxyReq.setHeader("referer", "https://fass.se/health/pharmacy-stock-status");
          });
        },
      },
    },
  },
});
