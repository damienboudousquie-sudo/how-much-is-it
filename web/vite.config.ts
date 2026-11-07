import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3001",
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq, req) => {
            if (req.headers.host) proxyReq.setHeader("x-forwarded-host", req.headers.host);
            proxyReq.setHeader("x-forwarded-proto", "http");
          });
        },
      },
    },
  },
});
