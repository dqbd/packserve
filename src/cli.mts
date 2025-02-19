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
        console.log("Resolving", cwd);
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
      const output = await pack({
        name,
        nonce,
        cwd: packagesMap[name],
        target,
      });

      return c.body(
        Readable.toWeb(createReadStream(output)) as ReadableStream,
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
    const pkg = JSON.parse(await fs.readFile(pkgJson, "utf-8"));

    const listReq = await fetch(`http://localhost:${options.port}/list`);
    if (!listReq.ok) throw new Error("Failed to list packages");
    const packages = (await listReq.json()) as string[];

    const nonce = Date.now();
    pkg.resolutions ??= {};
    for (const name of packages) {
      const newUrl = `http://localhost:${options.port}/${nonce}/${name}`;
      pkg.resolutions[name] = newUrl;
    }

    await fs.writeFile(pkgJson, JSON.stringify(pkg, null, 2));
  });

program.parse();
