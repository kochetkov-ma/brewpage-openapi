import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset paths: the build works at any address it is published under.
  base: "./",
  plugins: [react()],
  // The linked package keeps its own dev copy of React: one copy in the bundle.
  resolve: { dedupe: ["react", "react-dom"] },
});
