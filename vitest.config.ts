import { defineConfig } from "vitest/config"
import path from "path"

export default defineConfig({
  test: {
    globals: true,
    environment: "happy-dom",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "~": path.resolve(__dirname, "./src"),
      "~types": path.resolve(__dirname, "./src/types"),
      "~utils": path.resolve(__dirname, "./src/utils"),
      "~components": path.resolve(__dirname, "./src/components"),
      "~store": path.resolve(__dirname, "./src/store"),
    },
  },
})
