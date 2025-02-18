import { $ } from "execa";
import * as path from "node:path";
import { findUp } from "find-up-simple";
import { detect } from "package-manager-detector/detect";

async function runPack(options: { cwd: string; target: string }) {
  type NpmPackOutput = Array<{
    name: string;
    version: string;
    filename: string;
    files: { path: string }[];
  }>;

  type PnpmPackOutput = {
    name: string;
    version: string;
    filename: string;
    files: { path: string }[];
  };

  const pkgJson = await findUp("package.json", { cwd: options.cwd });
  if (!pkgJson) throw new Error("No package.json found");

  console.log(pkgJson);

  const detected = await detect({ cwd: path.dirname(pkgJson) });
  const pm = detected?.agent === "pnpm" ? "pnpm" : "npm";

  // check if
  const outputFile = await $({
    cwd: options.cwd,
    stderr: "inherit",
  })`${pm} pack --json --pack-destination ${options.target}`;

  const packOutput = (() => {
    for (let i = outputFile.stdout.length - 1; i >= 0; i -= 1) {
      const char = outputFile.stdout[i];
      if (char === "[" || char === "{") {
        try {
          return JSON.parse(outputFile.stdout.substring(i)) as
            | NpmPackOutput
            | PnpmPackOutput;
        } catch {
          // ignore
        }
      }
    }

    return undefined;
  })();

  const packFile = Array.isArray(packOutput) ? packOutput?.[0] : packOutput;
  if (!packFile) throw new Error("No archive returned by pack command");
  return path.resolve(options.target, packFile.filename);
}

let packCache: Record<string, ReturnType<typeof runPack> | undefined> = {};
let packSeq = Promise.resolve<string>("");

export function pack(options: {
  name: string;
  nonce: string;
  cwd: string;
  target: string;
}) {
  packSeq = packSeq.then(() => {
    const cacheKey = `${options.nonce}:${options.cwd}:${options.target}`;
    const task = packCache[cacheKey] ?? runPack(options);
    packCache[cacheKey] = task;

    return task;
  });

  return packSeq;
}
