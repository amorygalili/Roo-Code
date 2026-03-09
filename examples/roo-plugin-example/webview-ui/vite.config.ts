import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import { resolve } from "path"

// https://vitejs.dev/config/
export default defineConfig({
	plugins: [react()],
	build: {
		outDir: "dist",
		emptyOutDir: true,
		rollupOptions: {
			input: {
				index: resolve(__dirname, "index.html"),
			},
			output: {
				// Use predictable filenames so the extension host can reference them
				// without needing to parse a manifest.
				entryFileNames: "assets/[name].js",
				chunkFileNames: "assets/chunk-[hash].js",
				assetFileNames: "assets/[name][extname]",
			},
		},
	},
})
