import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // `npm run dev` talks to a local `uvicorn app.main:app --port 8077`
    proxy: { "/api": "http://localhost:8077" },
  },
});
