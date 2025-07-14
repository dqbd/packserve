import { vi } from "vitest";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createServer, type Server } from "node:http";
import { Hono } from "hono";
import { serve } from "@hono/node-server";

/**
 * Temporary directory utilities for isolated testing
 */
export class TempDir {
  private static instances: TempDir[] = [];
  public readonly path: string;
  private _created = false;

  constructor(prefix = "packserve-test-") {
    this.path = path.join(os.tmpdir(), `${prefix}${Date.now()}-${Math.random().toString(36).slice(2)}`);
    TempDir.instances.push(this);
  }

  async create(): Promise<string> {
    if (!this._created) {
      await fs.mkdir(this.path, { recursive: true });
      this._created = true;
    }
    return this.path;
  }

  async cleanup(): Promise<void> {
    if (this._created) {
      await fs.rm(this.path, { recursive: true, force: true });
      this._created = false;
    }
  }

  async writeFile(relativePath: string, content: string): Promise<string> {
    await this.create();
    const fullPath = path.join(this.path, relativePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content);
    return fullPath;
  }

  async readFile(relativePath: string): Promise<string> {
    const fullPath = path.join(this.path, relativePath);
    return await fs.readFile(fullPath, "utf-8");
  }

  async exists(relativePath: string): Promise<boolean> {
    try {
      const fullPath = path.join(this.path, relativePath);
      await fs.access(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  resolve(relativePath: string): string {
    return path.resolve(this.path, relativePath);
  }

  static async cleanupAll(): Promise<void> {
    await Promise.all(TempDir.instances.map(instance => instance.cleanup()));
    TempDir.instances = [];
  }
}

/**
 * Mock HTTP server utilities for testing HTTP endpoints
 */
export class MockHttpServer {
  private server: Server | null = null;
  private app: Hono;
  public port: number;
  public baseUrl: string;

  constructor(port = 0) {
    this.app = new Hono();
    this.port = port;
    this.baseUrl = `http://localhost:${port}`;
  }

  get hono(): Hono {
    return this.app;
  }

  async start(): Promise<{ port: number; baseUrl: string }> {
    return new Promise((resolve, reject) => {
      this.server = createServer(this.app.fetch);
      
      this.server.listen(this.port, () => {
        const address = this.server!.address();
        if (address && typeof address === 'object') {
          this.port = address.port;
          this.baseUrl = `http://localhost:${this.port}`;
          resolve({ port: this.port, baseUrl: this.baseUrl });
        } else {
          reject(new Error('Failed to get server address'));
        }
      });

      this.server.on('error', reject);
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.server) {
        this.server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
        this.server = null;
      } else {
        resolve();
      }
    });
  }

  // Helper methods for common HTTP testing scenarios
  setupListEndpoint(packages: string[]): void {
    this.app.get('/list', async (c) => c.json(packages));
  }

  setupPackEndpoint(mockPackFn: (params: { name: string; nonce: string }) => Promise<any>): void {
    this.app.get('/:nonce/*', async (c) => {
      const nonce = c.req.param('nonce');
      const name = c.req.path.slice(`/${nonce}/`.length);
      
      try {
        const result = await mockPackFn({ name, nonce });
        return c.text('mock-tarball-content', 200, {
          'Content-Type': 'application/gzip',
        });
      } catch (error) {
        return c.json({ error: 'Pack failed' }, 500);
      }
    });
  }
}

/**
 * Common test setup/teardown utilities
 */
export class TestEnvironment {
  private originalCwd: string;
  private originalArgv: string[];
  private originalStdoutWrite: typeof process.stdout.write;
  private originalStderrWrite: typeof process.stderr.write;
  private originalConsoleLog: typeof console.log;
  private originalConsoleError: typeof console.error;
  
  public stdoutOutput: string[] = [];
  public stderrOutput: string[] = [];
  public consoleOutput: string[] = [];
  public consoleErrors: string[] = [];

  constructor() {
    this.originalCwd = process.cwd();
    this.originalArgv = [...process.argv];
    this.originalStdoutWrite = process.stdout.write;
    this.originalStderrWrite = process.stderr.write;
    this.originalConsoleLog = console.log;
    this.originalConsoleError = console.error;
  }

  setup(): void {
    // Clear output arrays
    this.stdoutOutput = [];
    this.stderrOutput = [];
    this.consoleOutput = [];
    this.consoleErrors = [];

    // Mock stdout/stderr to capture output
    process.stdout.write = vi.fn((chunk: any) => {
      this.stdoutOutput.push(chunk.toString());
      return true;
    }) as any;

    process.stderr.write = vi.fn((chunk: any) => {
      this.stderrOutput.push(chunk.toString());
      return true;
    }) as any;

    // Mock console methods
    console.log = vi.fn((...args) => {
      this.consoleOutput.push(args.join(' '));
    });

    console.error = vi.fn((...args) => {
      this.consoleErrors.push(args.join(' '));
    });
  }

  teardown(): void {
    // Restore original functions
    process.stdout.write = this.originalStdoutWrite;
    process.stderr.write = this.originalStderrWrite;
    console.log = this.originalConsoleLog;
    console.error = this.originalConsoleError;
    process.argv = this.originalArgv;
    process.chdir(this.originalCwd);
  }

  changeCwd(newCwd: string): void {
    process.chdir(newCwd);
  }

  setArgv(argv: string[]): void {
    process.argv = argv;
  }

  getStdoutOutput(): string {
    return this.stdoutOutput.join('');
  }

  getStderrOutput(): string {
    return this.stderrOutput.join('');
  }

  getConsoleOutput(): string {
    return this.consoleOutput.join('
  }

  getConsoleErrors(): string {
    return this.consoleErrors.join('
  }
}

/**
 * Mock factory utilities for common dependencies
 */
export const createMockDependencies = () => {
  return {
    // Mock find-up-simple
    findUp: vi.fn(),
    
    // Mock execa
    execa: vi.fn(),
    
    // Mock package-manager-detector
    detect: vi.fn(),
    
    // Mock picocolors
    picocolors: {
      gray: vi.fn((text: string) => text),
      green: vi.fn((text: string) => text),
      yellow: vi.fn((text: string) => text),
      blue: vi.fn((text: string) => text),
      magenta: vi.fn((text: string) => text),
      cyan: vi.fn((text: string) => text),
      red: vi.fn((text: string) => text),
    },
    
    // Mock @hono/node-server
    serve: vi.fn((options, callback) => {
      if (callback) {
        callback({ address: 'localhost', port: options.port });
      }
      return { close: vi.fn() };
    }),
    
    // Mock pack function
    pack: vi.fn(),
    
    // Mock fetch
    fetch: vi.fn(),
  };
};

/**
 * Stream testing utilities
 */
export const createStreamHelpers = () => {
  // Helper function to convert string to Uint8Array
  const stringToUint8Array = (str: string): Uint8Array => {
    return new TextEncoder().encode(str);
  };

  // Helper function to convert Uint8Array to string
  const uint8ArrayToString = (arr: Uint8Array): string => {
    return new TextDecoder().decode(arr);
  };

  // Helper function to create a readable stream from chunks
  const createReadableFromChunks = (chunks: Uint8Array[]): ReadableStream<Uint8Array> => {
    let index = 0;
    return new ReadableStream({
      pull(controller) {
        if (index < chunks.length) {
          controller.enqueue(chunks[index++]);
        } else {
          controller.close();
        }
      },
    });
  };

  // Helper function to collect all chunks from a stream
  const collectStreamChunks = async (stream: ReadableStream<Uint8Array>): Promise<Uint8Array[]> => {
    const chunks: Uint8Array[] = [];
    const reader = stream.getReader();
    
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    
    return chunks;
  };

  return {
    stringToUint8Array,
    uint8ArrayToString,
    createReadableFromChunks,
    collectStreamChunks,
  };
};

/**
 * File system testing utilities
 */
export const createFileSystemHelpers = () => {
  const createPackageJson = async (tempDir: TempDir, name: string, content: any): Promise<string> => {
    const packageJsonContent = JSON.stringify(content, null, 2);
    return await tempDir.writeFile('package.json', packageJsonContent);
  };

  const loadFixture = async (fixtureName: string): Promise<any> => {
    const fixturePath = path.resolve(process.cwd(), 'tests', 'fixtures', fixtureName);
    const content = await fs.readFile(fixturePath, 'utf-8');
    return JSON.parse(content);
  };

  return {
    createPackageJson,
    loadFixture,
  };
};

