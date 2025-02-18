import { defineConfig } from "tsup";

export default defineConfig({
  entryPoints: ["./src/cli.mts"],
  format: ["esm"],
  dts: true,
});