import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

export async function loadBundledModule(relativePath, { platform = "browser", prefix = "module" } = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `mouthpiece-${prefix}-`));
  const outfile = path.join(tempDir, "bundle.mjs");

  await esbuild.build({
    entryPoints: [path.resolve(process.cwd(), relativePath)],
    bundle: true,
    format: "esm",
    platform,
    outfile,
    logLevel: "silent",
  });

  const module = await import(`${pathToFileURL(outfile).href}?ts=${Date.now()}`);

  return {
    module,
    cleanup() {
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}
