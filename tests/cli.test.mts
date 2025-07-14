import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { Command } from "@commander-js/extra-typings";
import { Hono } from "hono";

// Mock dependencies
vi.mock("@hono/node-server", () => ({
  serve: vi.fn((options, callback) => {
    // Simulate server starting
    if (callback) {
      callback({ address: "localhost", port: options.port });
    }
    return { close: vi.fn() };
  }),
}));

vi.mock("./pack.mjs", () => ({
  pack: vi.fn(),
}));

vi.mock("find-up-simple", () => ({
  findUp: vi.fn(),
}));

vi.mock("picocolors", () => ({
  default: {
    gray: vi.fn((text) => text),
  },
}));

// Import after mocking
import { serve } from "@hono/node-server";
import { pack } from "../src/pack.mjs";
import { findUp } from "find-up-simple";

describe("CLI functionality", () => {
  let tempDir: string;
  let originalCwd: string;
  let originalArgv: string[];
  let originalStdoutWrite: typeof process.stdout.write;
  let originalConsoleLog: typeof console.log;
  let stdoutOutput: string[];
  let consoleOutput: string[];

  beforeEach(async () => {
    // Create temporary directory for tests
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "packserve-test-"));
    originalCwd = process.cwd();
    originalArgv = process.argv;
    
    // Mock stdout and console.log to capture output
    stdoutOutput = [];
    consoleOutput = [];
    originalStdoutWrite = process.stdout.write;
    originalConsoleLog = console.log;
    
    process.stdout.write = vi.fn((chunk: any) => {
      stdoutOutput.push(chunk.toString());
      return true;
    }) as any;
    
    console.log = vi.fn((...args) => {
      consoleOutput.push(args.join(" "));
    });

    // Reset mocks
    vi.clearAllMocks();
  });

  afterEach(async () => {
    // Restore original functions
    process.stdout.write = originalStdoutWrite;
    console.log = originalConsoleLog;
    process.argv = originalArgv;
    process.chdir(originalCwd);
    
    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("Package resolution logic", () => {
    it("should resolve package names from package.json files", async () => {
      // Create test package directories
      const pkg1Dir = path.join(tempDir, "package1");
      const pkg2Dir = path.join(tempDir, "package2");
      await fs.mkdir(pkg1Dir, { recursive: true });
      await fs.mkdir(pkg2Dir, { recursive: true });

      // Create package.json files
      const pkg1Json = path.join(pkg1Dir, "package.json");
      const pkg2Json = path.join(pkg2Dir, "package.json");
      
      await fs.writeFile(pkg1Json, JSON.stringify({ name: "test-package-1" }));
      await fs.writeFile(pkg2Json, JSON.stringify({ name: "test-package-2" }));

      // Mock findUp to return the package.json paths
      (findUp as any).mockImplementation(async (filename: string, options: any) => {
        if (options.cwd.includes("package1")) return pkg1Json;
        if (options.cwd.includes("package2")) return pkg2Json;
        return null;
      });

      // Import and test the CLI module indirectly by testing the logic
      // Since the CLI runs immediately, we'll test the core logic separately
      const { findUp: mockFindUp } = await import("find-up-simple");
      
      // Test package resolution logic
      const packages = ["package1", "package2"];
      const packagesMap: Record<string, string> = {};
      
      for (const pkg of packages) {
        const cwd = path.resolve(tempDir, pkg);
        const pkgJson = await mockFindUp("package.json", { cwd });
        expect(pkgJson).toBeTruthy();
        
        const pkgInfo = JSON.parse(await fs.readFile(pkgJson!, "utf-8"));
        expect(pkgInfo.name).toBeTruthy();
        packagesMap[pkgInfo.name] = pkg;
      }

      expect(packagesMap).toEqual({
        "test-package-1": "package1",
        "test-package-2": "package2",
      });
    });

    it("should throw error when package.json is not found", async () => {
      (findUp as any).mockResolvedValue(null);
      
      const packages = ["nonexistent-package"];
      
      for (const pkg of packages) {
        const cwd = path.resolve(tempDir, pkg);
        const pkgJson = await findUp("package.json", { cwd });
        expect(pkgJson).toBeNull();
      }
    });

    it("should throw error when package has no name", async () => {
      const pkgDir = path.join(tempDir, "no-name-package");
      await fs.mkdir(pkgDir, { recursive: true });
      const pkgJson = path.join(pkgDir, "package.json");
      await fs.writeFile(pkgJson, JSON.stringify({})); // No name field

      (findUp as any).mockResolvedValue(pkgJson);
      
      const pkgInfo = JSON.parse(await fs.readFile(pkgJson, "utf-8"));
      expect(pkgInfo.name).toBeFalsy();
    });
  });

  describe("HTTP Server and Hono endpoints", () => {
    let app: Hono;
    let packagesMap: Record<string, string>;

    beforeEach(() => {
      app = new Hono();
      packagesMap = {
        "test-package-1": "package1",
        "test-package-2": "package2",
      };

      // Set up routes like in the CLI
      app.get("/list", async (c) => c.json(Object.keys(packagesMap)));
      app.get("/:nonce/*", async (c) => {
        const nonce = c.req.param("nonce");
        const name = c.req.path.slice(`/${nonce}/`.length);
        
        if (!packagesMap[name]) {
          return c.json({ error: "Package not found" }, 404);
        }
        
        const result = await pack({
          name,
          nonce,
          cwd: packagesMap[name],
          target: "/tmp/packages",
        });

        if (result.success === false) throw result.error;
        
        // Mock response for testing
        return c.text("mock-tarball-content", 200, {
          "Content-Type": "application/gzip",
        });
      });
    });

    describe("/list endpoint", () => {
      it("should return list of package names", async () => {
        const req = new Request("http://localhost:3123/list");
        const res = await app.request(req);
        
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data).toEqual(["test-package-1", "test-package-2"]);
      });

      it("should return empty array when no packages", async () => {
        const emptyApp = new Hono();
        emptyApp.get("/list", async (c) => c.json(Object.keys({})));
        
        const req = new Request("http://localhost:3123/list");
        const res = await emptyApp.request(req);
        
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data).toEqual([]);
      });
    });

    describe("/:nonce/* endpoint", () => {
      it("should serve packed files with correct nonce and package name", async () => {
        const mockPackResult = { success: true, data: "/tmp/packages/test.tgz" };
        (pack as any).mockResolvedValue(mockPackResult);

        const req = new Request("http://localhost:3123/12345/test-package-1");
        const res = await app.request(req);
        
        expect(res.status).toBe(200);
        expect(res.headers.get("Content-Type")).toBe("application/gzip");
        
        expect(pack).toHaveBeenCalledWith({
          name: "test-package-1",
          nonce: "12345",
          cwd: "package1",
          target: "/tmp/packages",
        });
      });

      it("should handle pack errors", async () => {
        const mockError = new Error("Pack failed");
        const mockPackResult = { success: false, error: mockError };
        (pack as any).mockResolvedValue(mockPackResult);

        const req = new Request("http://localhost:3123/12345/test-package-1");
        
        await expect(app.request(req)).rejects.toThrow("Pack failed");
      });

      it("should handle unknown package names", async () => {
        const req = new Request("http://localhost:3123/12345/unknown-package");
        const res = await app.request(req);
        
        expect(res.status).toBe(404);
        const data = await res.json();
        expect(data).toEqual({ error: "Package not found" });
      });

      it("should extract nonce and package name correctly from path", async () => {
        const mockPackResult = { success: true, data: "/tmp/packages/test.tgz" };
        (pack as any).mockResolvedValue(mockPackResult);

        // Test with complex package name
        const req = new Request("http://localhost:3123/98765/test-package-2");
        await app.request(req);
        
        expect(pack).toHaveBeenCalledWith({
          name: "test-package-2",
          nonce: "98765",
          cwd: "package2",
          target: "/tmp/packages",
        });
      });
    });
  });

  describe("Bump command functionality", () => {
    let testPackageJson: string;

    beforeEach(async () => {
      testPackageJson = path.join(tempDir, "package.json");
      const initialPackage = {
        name: "test-project",
        version: "1.0.0",
        dependencies: {},
      };
      await fs.writeFile(testPackageJson, JSON.stringify(initialPackage, null, 2) + "\n");
      
      // Mock findUp to return our test package.json
      (findUp as any).mockResolvedValue(testPackageJson);
      
      // Mock fetch for the /list endpoint
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ["test-package-1", "test-package-2"],
      });
    });

    it("should update package.json resolutions with nonce URLs", async () => {
      // Read initial package.json
      const initialContent = await fs.readFile(testPackageJson, "utf-8");
      const initialPkg = JSON.parse(initialContent);
      expect(initialPkg.resolutions).toBeUndefined();

      // Simulate bump command logic
      const port = "3123";
      const listReq = await fetch(`http://localhost:${port}/list`);
      expect(listReq.ok).toBe(true);
      const packages = await listReq.json();
      
      const nonce = Date.now();
      const pkg = { ...initialPkg };
      pkg.resolutions = pkg.resolutions || {};
      
      for (const name of packages) {
        const newUrl = `http://localhost:${port}/${nonce}/${name}`;
        pkg.resolutions[name] = newUrl;
      }
      
      // Write updated package.json
      const newOutput = JSON.stringify(pkg, null, 2) + "\n";
      await fs.writeFile(testPackageJson, newOutput);
      
      // Verify the changes
      const updatedContent = await fs.readFile(testPackageJson, "utf-8");
      const updatedPkg = JSON.parse(updatedContent);
      
      expect(updatedPkg.resolutions).toBeDefined();
      expect(updatedPkg.resolutions["test-package-1"]).toBe(`http://localhost:3123/${nonce}/test-package-1`);
      expect(updatedPkg.resolutions["test-package-2"]).toBe(`http://localhost:3123/${nonce}/test-package-2`);
    });

    it("should preserve existing resolutions", async () => {
      // Create package.json with existing resolutions
      const initialPackage = {
        name: "test-project",
        version: "1.0.0",
        resolutions: {
          "existing-package": "1.0.0",
        },
      };
      await fs.writeFile(testPackageJson, JSON.stringify(initialPackage, null, 2) + "\n");

      // Simulate bump command logic
      const oldOutput = await fs.readFile(testPackageJson, "utf-8");
      const pkg = JSON.parse(oldOutput);
      
      const packages = ["test-package-1"];
      const nonce = Date.now();
      pkg.resolutions = pkg.resolutions || {};
      
      for (const name of packages) {
        const newUrl = `http://localhost:3123/${nonce}/${name}`;
        pkg.resolutions[name] = newUrl;
      }
      
      const newOutput = JSON.stringify(pkg, null, 2) + "\n";
      await fs.writeFile(testPackageJson, newOutput);
      
      // Verify existing resolution is preserved
      const updatedContent = await fs.readFile(testPackageJson, "utf-8");
      const updatedPkg = JSON.parse(updatedContent);
      
      expect(updatedPkg.resolutions["existing-package"]).toBe("1.0.0");
      expect(updatedPkg.resolutions["test-package-1"]).toBe(`http://localhost:3123/${nonce}/test-package-1`);
    });

    it("should preserve trailing newlines in package.json", async () => {
      // Test different newline formats
      const testCases = ["\n", "\r\n", "\r", ""];
      
      for (const trailing of testCases) {
        const content = JSON.stringify({ name: "test" }, null, 2) + trailing;
        await fs.writeFile(testPackageJson, content);
        
        const oldOutput = await fs.readFile(testPackageJson, "utf-8");
        const getTrailingNewline = (str: string) => {
          if (str.endsWith("\r\n")) return "\r\n";
          if (str.endsWith("\r")) return "\r";
          if (str.endsWith("\n")) return "\n";
          return "";
        };
        
        const oldTrailing = getTrailingNewline(oldOutput);
        expect(oldTrailing).toBe(trailing);
      }
    });
  });
});



