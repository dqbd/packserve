import { $, ExecaError } from "execa";

import { findUp } from "find-up-simple";
import { detect } from "package-manager-detector/detect";
import { HTTPException } from "hono/http-exception";
import {
  type PackOutput,
  BytesLineDecoder,
  LinePrefixStream,
  ExtractPackOutput,
} from "./stream.mjs";
import pc from "picocolors";
import * as fs from "node:fs";
import * as path from "node:path";

const COLORS = [pc.green, pc.yellow, pc.blue, pc.magenta, pc.cyan, pc.red];
const SEEN: string[] = [];

function getColor(name: string) {
  let idx = SEEN.indexOf(name);
  if (idx < 0) idx = SEEN.push(name) - 1;
  return COLORS[idx % COLORS.length](name);
}

async function runPack(options: { cwd: string; target: string }) {
  const pkgJson = await findUp("package.json", { cwd: options.cwd });
  if (!pkgJson) throw new Error("No package.json found");

  const pkg = JSON.parse(await fs.promises.readFile(pkgJson, "utf-8"));

  const detected = await detect({ cwd: path.dirname(pkgJson) });
  const pm = detected?.agent === "pnpm" ? "pnpm" : "npm";

  try {
    const packProc = $({
      cwd: options.cwd,
      stdout: "pipe",
      stderr: "pipe",
      env: { FORCE_COLOR: "true" },
    })`${pm} pack --json --pack-destination ${options.target}`;

    const packOutputRef: { current: PackOutput | undefined } = {
      current: undefined,
    };

    process.stderr.write(`${getColor(pkg.name)} ${pc.yellow("Building...")}\n`);

    packProc.stderr
      .pipe(new BytesLineDecoder().fromWeb())
      .pipe(new LinePrefixStream(getColor(pkg.name)).fromWeb())
      .pipe(process.stderr);

    packProc.stdout
      .pipe(new BytesLineDecoder().fromWeb())
      .pipe(new ExtractPackOutput(packOutputRef).fromWeb())
      .pipe(new LinePrefixStream(getColor(pkg.name)).fromWeb())
      .pipe(process.stderr);

    await packProc;

    process.stderr.write(`${getColor(pkg.name)} ${pc.green("✔️ Done")}\n`);

    const packFile = Array.isArray(packOutputRef.current)
      ? packOutputRef.current?.[0]
      : packOutputRef.current;

    if (!packFile) throw new Error("No archive returned by pack command");
    return path.resolve(options.target, packFile.filename);
  } catch (error) {
    if (error instanceof ExecaError) {
      process.stderr.write(
        `${getColor(pkg.name)} ${pc.red(
          `⨯ Failed to pack (exit code ${error.exitCode})`
        )}\n`
      );

      throw new HTTPException(500, {
        message: `Failed to pack ${pkg.name} (exit code ${error.exitCode})`,
      });
    }
    throw error;
  }
}

let packCache: Record<string, ReturnType<typeof runPack> | undefined> = {};
let packSeq = Promise.resolve<
  { success: true; data: string } | { success: false; error: Error }
>({
  success: true,
  data: "",
});

export function pack(options: {
  name: string;
  nonce: string;
  cwd: string;
  target: string;
}): Promise<
  { success: true; data: string } | { success: false; error: Error }
> {
  packSeq = packSeq.then(() => {
    const cacheKey = `${options.nonce}:${options.cwd}:${options.target}`;
    const cachedTask = packCache[cacheKey];
    const task =
      cachedTask ??
      runPack(options).catch((err) => {
        delete packCache[cacheKey];
        return Promise.reject(err);
      });

    if (cachedTask) {
      process.stderr.write(
        `${getColor(options.name)} ${pc.yellow("✔️ Cache hit")}\n`
      );
    }

    packCache[cacheKey] = task;
    return task.then(
      (data) => ({ success: true, data }),
      (error) => ({ success: false, error })
    );
  });

  return packSeq;
}
