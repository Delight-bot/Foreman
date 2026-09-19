import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// The singlefile plugin inlines JS and CSS so the page can be hosted as one HTML file.
export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  build: { target: "es2020", assetsInlineLimit: 100000000 },
});
