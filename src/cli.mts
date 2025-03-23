#!/usr/bin/env node
import { Command } from "@commander-js/extra-typings";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { pack } from "./pack.mjs";
import * as path from "node:path";
import * as url from "node:url";
import { promises as fs, createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { findUp } from "find-up-simple";
import pc from "picocolors";

const program = new Command()
  .name("packserve")
  .description("Serve package tarballs over HTTP");

program
  .option("-p, --port <port>", "Port to listen on", "3123")
  .option(
    "-d, --packages <paths...>",
    "Paths to package directories to serve",
    []
  )
  .action(async (options) => {
    const packagesMap = await (async () => {
      const packagesMap = {};
      for (const pkg of options.packages) {
        const cwd = path.resolve(process.cwd(), pkg);
        process.stdout.write(`${pc.gray("Resolving")} ${cwd}\n`);

        const pkgJson = await findUp("package.json", { cwd });
        if (!pkgJson) throw new Error(`No package.json found for ${pkg}`);
        const pkgInfo = JSON.parse(await fs.readFile(pkgJson, "utf-8")) as {
          name: string;
        };

        if (!pkgInfo.name) throw new Error(`No name found for ${pkg}`);
        packagesMap[pkgInfo.name] = pkg;
      }
      return packagesMap;
    })();

    const dirname = path.dirname(url.fileURLToPath(import.meta.url));
    const target = path.resolve(dirname, "../packages");
    await fs.mkdir(target, { recursive: true });

    const app = new Hono();

    app.get("/list", async (c) => c.json(Object.keys(packagesMap)));
    app.get("/:nonce/*", async (c) => {
      const nonce = c.req.param("nonce");
      const name = c.req.path.slice(`/${nonce}/`.length);
      const result = await pack({
        name,
        nonce,
        cwd: packagesMap[name],
        target,
      });

      if (result.success === false) throw result.error;
      return c.body(
        Readable.toWeb(createReadStream(result.data)) as ReadableStream,
        200,
        { "Content-Type": "application/gzip" }
      );
    });

    serve({ fetch: app.fetch, port: Number(options.port) }, (info) => {
      console.log(`Server is running on ${info.address}:${info.port}`);
    });
  });

program
  .command("bump")
  .description("Bump the nonce")
  .option("-p, --port <port>", "Port to listen on", "3123")
  .action(async (options) => {
    const pkgJson = await findUp("package.json", { cwd: process.cwd() });
    if (!pkgJson) throw new Error("No package.json found");

    const oldOutput = await fs.readFile(pkgJson, "utf-8");
    const pkg = JSON.parse(oldOutput);

    const getTrailingNewline = (str: string) => {
      if (str.endsWith("\r\n")) return "\r\n";
      if (str.endsWith("\r")) return "\r";
      if (str.endsWith("\n")) return "\n";
      return "";
    };

    const oldTrailing = getTrailingNewline(oldOutput);

    const listReq = await fetch(`http://localhost:${options.port}/list`);
    if (!listReq.ok) throw new Error("Failed to list packages");
    const packages = (await listReq.json()) as string[];

    const nonce = Date.now();
    pkg.resolutions ??= {};
    for (const name of packages) {
      const newUrl = `http://localhost:${options.port}/${nonce}/${name}`;
      pkg.resolutions[name] = newUrl;
    }
    let newOutput = JSON.stringify(pkg, null, 2);
    const newTrailing = getTrailingNewline(newOutput);
    if (newTrailing) newOutput = newOutput.slice(0, -newTrailing.length);
    newOutput += oldTrailing;

    await fs.writeFile(pkgJson, newOutput);
  });

program.parse();
