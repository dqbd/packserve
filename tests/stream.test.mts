import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Readable, Writable } from "node:stream";
import {
  BytesLineDecoder,
  LinePrefixStream,
  ExtractPackOutput,
  type PackOutput,
} from "../src/stream.mjs";

// Helper function to convert string to Uint8Array
function stringToUint8Array(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

// Helper function to convert Uint8Array to string
function uint8ArrayToString(arr: Uint8Array): string {
  return new TextDecoder().decode(arr);
}

// Helper function to create a readable stream from chunks
function createReadableFromChunks(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
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
}

// Helper function to collect all chunks from a stream
async function collectStreamChunks(stream: ReadableStream<Uint8Array>): Promise<Uint8Array[]> {
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
}

describe("Stream processing utilities", () => {
  describe("joinArrays utility function", () => {
    // Import the joinArrays function - it's not exported, so we'll test it indirectly
    // through the BytesLineDecoder which uses it internally
    
    it("should be tested indirectly through BytesLineDecoder buffer handling", async () => {
      const decoder = new BytesLineDecoder();
      
      // Test that buffering works correctly (which uses joinArrays internally)
      const input1 = stringToUint8Array("Hello ");
      const input2 = stringToUint8Array("World\n");
      
      const inputStream = createReadableFromChunks([input1, input2]);
      const outputStream = inputStream.pipeThrough(decoder);
      const chunks = await collectStreamChunks(outputStream);
      
      expect(chunks).toHaveLength(1);
      expect(uint8ArrayToString(chunks[0])).toBe("Hello World");
    });
  });

  describe("BytesLineDecoder", () => {
    let decoder: BytesLineDecoder;

    beforeEach(() => {
      decoder = new BytesLineDecoder();
    });

    describe("line break handling", () => {
      it("should handle LF (\
        const input = stringToUint8Array("line1
        const inputStream = createReadableFromChunks([input]);
        const outputStream = inputStream.pipeThrough(decoder);
        const chunks = await collectStreamChunks(outputStream);
        
        expect(chunks).toHaveLength(3);
        expect(uint8ArrayToString(chunks[0])).toBe("line1");
        expect(uint8ArrayToString(chunks[1])).toBe("line2");
        expect(uint8ArrayToString(chunks[2])).toBe("line3");
      });

      it("should handle CR (\\r) line breaks", async () => {
        const input = stringToUint8Array("line1\rline2\rline3\r");
        const inputStream = createReadableFromChunks([input]);
        const outputStream = inputStream.pipeThrough(decoder);
        const chunks = await collectStreamChunks(outputStream);
        
        expect(chunks).toHaveLength(3);
        expect(uint8ArrayToString(chunks[0])).toBe("line1");
        expect(uint8ArrayToString(chunks[1])).toBe("line2");
        expect(uint8ArrayToString(chunks[2])).toBe("line3");
      });

      it("should handle CRLF (\\r\
        const input = stringToUint8Array("line1\r
        const inputStream = createReadableFromChunks([input]);
        const outputStream = inputStream.pipeThrough(decoder);
        const chunks = await collectStreamChunks(outputStream);
        
        expect(chunks).toHaveLength(3);
        expect(uint8ArrayToString(chunks[0])).toBe("line1");
        expect(uint8ArrayToString(chunks[1])).toBe("line2");
        expect(uint8ArrayToString(chunks[2])).toBe("line3");
      });

      it("should handle mixed line break types", async () => {
        const input = stringToUint8Array("line1
        const inputStream = createReadableFromChunks([input]);
        const outputStream = inputStream.pipeThrough(decoder);
        const chunks = await collectStreamChunks(outputStream);
        
        expect(chunks).toHaveLength(4);
        expect(uint8ArrayToString(chunks[0])).toBe("line1");
        expect(uint8ArrayToString(chunks[1])).toBe("line2");
        expect(uint8ArrayToString(chunks[2])).toBe("line3");
        expect(uint8ArrayToString(chunks[3])).toBe("line4");
      });
    });

    describe("buffering behavior", () => {
      it("should buffer incomplete lines across chunks", async () => {
        const chunk1 = stringToUint8Array("Hello ");
        const chunk2 = stringToUint8Array("World
        const chunk3 = stringToUint8Array("Next line");
        
        const inputStream = createReadableFromChunks([chunk1, chunk2, chunk3]);
        const outputStream = inputStream.pipeThrough(decoder);
        const chunks = await collectStreamChunks(outputStream);
        
        expect(chunks).toHaveLength(2);
        expect(uint8ArrayToString(chunks[0])).toBe("Hello World");
        expect(uint8ArrayToString(chunks[1])).toBe("Next line");
      });

      it("should handle trailing CR across chunk boundaries", async () => {
        const chunk1 = stringToUint8Array("line1\r");
        const chunk2 = stringToUint8Array("
        
        const inputStream = createReadableFromChunks([chunk1, chunk2]);
        const outputStream = inputStream.pipeThrough(decoder);
        const chunks = await collectStreamChunks(outputStream);
        
        expect(chunks).toHaveLength(2);
        expect(uint8ArrayToString(chunks[0])).toBe("line1");
        expect(uint8ArrayToString(chunks[1])).toBe("line2");
      });

      it("should handle trailing CR without following LF", async () => {
        const chunk1 = stringToUint8Array("line1\r");
        const chunk2 = stringToUint8Array("line2
        
        const inputStream = createReadableFromChunks([chunk1, chunk2]);
        const outputStream = inputStream.pipeThrough(decoder);
        const chunks = await collectStreamChunks(outputStream);
        
        expect(chunks).toHaveLength(2);
        expect(uint8ArrayToString(chunks[0])).toBe("line1");
        expect(uint8ArrayToString(chunks[1])).toBe("line2");
      });

      it("should handle empty chunks", async () => {
        const chunk1 = stringToUint8Array("line1
        const chunk2 = new Uint8Array(0); // Empty chunk
        const chunk3 = stringToUint8Array("line2
        
        const inputStream = createReadableFromChunks([chunk1, chunk2, chunk3]);
        const outputStream = inputStream.pipeThrough(decoder);
        const chunks = await collectStreamChunks(outputStream);
        
        expect(chunks).toHaveLength(2);
        expect(uint8ArrayToString(chunks[0])).toBe("line1");
        expect(uint8ArrayToString(chunks[1])).toBe("line2");
      });
    });

    describe("fromWeb() method", () => {
      it("should return a Node.js Duplex stream", () => {
        const nodeStream = decoder.fromWeb();
        expect(nodeStream).toBeDefined();
        expect(typeof nodeStream.pipe).toBe("function");
        expect(typeof nodeStream.write).toBe("function");
        expect(typeof nodeStream.read).toBe("function");
      });
    });
  });

  describe("LinePrefixStream", () => {
    let prefixStream: LinePrefixStream;
    const testPrefix = "[TEST]";

    beforeEach(() => {
      prefixStream = new LinePrefixStream(testPrefix);
    });

    describe("prefix addition", () => {
      it("should add prefix to single line", async () => {
        const input = stringToUint8Array("Hello World");
        const inputStream = createReadableFromChunks([input]);
        const outputStream = inputStream.pipeThrough(prefixStream);
        const chunks = await collectStreamChunks(outputStream);
        
        expect(chunks).toHaveLength(1);
        const output = uint8ArrayToString(chunks[0]);
        expect(output).toBe(`${testPrefix} Hello World
      });

      it("should add prefix to multiple lines", async () => {
        const input1 = stringToUint8Array("Line 1");
        const input2 = stringToUint8Array("Line 2");
        
        const inputStream = createReadableFromChunks([input1, input2]);
        const outputStream = inputStream.pipeThrough(prefixStream);
        const chunks = await collectStreamChunks(outputStream);
        
        expect(chunks).toHaveLength(2);
        expect(uint8ArrayToString(chunks[0])).toBe(`${testPrefix} Line 1
        expect(uint8ArrayToString(chunks[1])).toBe(`${testPrefix} Line 2
      });

      it("should handle empty input", async () => {
        const input = stringToUint8Array("");
        const inputStream = createReadableFromChunks([input]);
        const outputStream = inputStream.pipeThrough(prefixStream);
        const chunks = await collectStreamChunks(outputStream);
        
        expect(chunks).toHaveLength(1);
        expect(uint8ArrayToString(chunks[0])).toBe(`${testPrefix} 
      });
    });

    describe("ANSI escape sequence stripping", () => {
      it("should strip \\u001b[2K (clear line) sequences", async () => {
        const input = stringToUint8Array("Hello\u001b[2KWorld");
        const inputStream = createReadableFromChunks([input]);
        const outputStream = inputStream.pipeThrough(prefixStream);
        const chunks = await collectStreamChunks(outputStream);
        
        expect(chunks).toHaveLength(1);
        const output = uint8ArrayToString(chunks[0]);
        expect(output).toBe(`${testPrefix} HelloWorld
      });

      it("should strip \\u001b[1G (cursor to column 1) sequences", async () => {
        const input = stringToUint8Array("Hello\u001b[1GWorld");
        const inputStream = createReadableFromChunks([input]);
        const outputStream = inputStream.pipeThrough(prefixStream);
        const chunks = await collectStreamChunks(outputStream);
        
        expect(chunks).toHaveLength(1);
        const output = uint8ArrayToString(chunks[0]);
        expect(output).toBe(`${testPrefix} HelloWorld
      });

      it("should strip multiple ANSI sequences", async () => {
        const input = stringToUint8Array("Hello\u001b[2K\u001b[1GWorld");
        const inputStream = createReadableFromChunks([input]);
        const outputStream = inputStream.pipeThrough(prefixStream);
        const chunks = await collectStreamChunks(outputStream);
        
        expect(chunks).toHaveLength(1);
        const output = uint8ArrayToString(chunks[0]);
        expect(output).toBe(`${testPrefix} HelloWorld
      });
    });

    describe("fromWeb() method", () => {
      it("should return a Node.js Duplex stream", () => {
        const nodeStream = prefixStream.fromWeb();
        expect(nodeStream).toBeDefined();
        expect(typeof nodeStream.pipe).toBe("function");
        expect(typeof nodeStream.write).toBe("function");
        expect(typeof nodeStream.read).toBe("function");
      });
    });
  });

  describe("ExtractPackOutput", () => {
    let packOutputRef: { current: PackOutput | undefined };
    let extractStream: ExtractPackOutput;

    beforeEach(() => {
      packOutputRef = { current: undefined };
      extractStream = new ExtractPackOutput(packOutputRef);
    });

    describe("JSON parsing from pack output", () => {
      it("should extract npm pack output (array format)", async () => {
        const npmOutput = [
          {
            name: "test-package",
            version: "1.0.0",
            filename: "test-package-1.0.0.tgz",
            files: [{ path: "package.json" }, { path: "index.js" }],
          },
        ];
        
        const jsonString = JSON.stringify(npmOutput);
        const input = stringToUint8Array(jsonString);
        
        const inputStream = createReadableFromChunks([input]);
        const outputStream = inputStream.pipeThrough(extractStream);
        await collectStreamChunks(outputStream); // Consume the stream
        
        expect(packOutputRef.current).toEqual(npmOutput);
      });

      it("should extract pnpm pack output (object format)", async () => {
        const pnpmOutput = {
          name: "test-package",
          version: "1.0.0",
          filename: "test-package-1.0.0.tgz",
          files: [{ path: "package.json" }, { path: "index.js" }],
        };
        
        const jsonString = JSON.stringify(pnpmOutput);
        const input = stringToUint8Array(jsonString);
        
        const inputStream = createReadableFromChunks([input]);
        const outputStream = inputStream.pipeThrough(extractStream);
        await collectStreamChunks(outputStream);
        
        expect(packOutputRef.current).toEqual(pnpmOutput);
      });

      it("should handle JSON split across multiple chunks", async () => {
        const output = { name: "test", version: "1.0.0", filename: "test.tgz", files: [] };
        const jsonString = JSON.stringify(output);
        
        // Split JSON into multiple chunks
        const midpoint = Math.floor(jsonString.length / 2);
        const chunk1 = stringToUint8Array(jsonString.slice(0, midpoint));
        const chunk2 = stringToUint8Array(jsonString.slice(midpoint));
        
        const inputStream = createReadableFromChunks([chunk1, chunk2]);
        const outputStream = inputStream.pipeThrough(extractStream);
        await collectStreamChunks(outputStream);
        
        expect(packOutputRef.current).toEqual(output);
      });
    });

    describe("state machine behavior", () => {
      it("should start in idle state and pass through non-JSON content", async () => {
        const nonJsonInput = stringToUint8Array("This is not JSON
        
        const inputStream = createReadableFromChunks([nonJsonInput]);
        const outputStream = inputStream.pipeThrough(extractStream);
        const chunks = await collectStreamChunks(outputStream);
        
        expect(chunks).toHaveLength(1);
        expect(uint8ArrayToString(chunks[0])).toBe("This is not JSON
        expect(packOutputRef.current).toBeUndefined();
      });

      it("should transition to recording state when JSON starts", async () => {
        const jsonOutput = { name: "test", version: "1.0.0", filename: "test.tgz", files: [] };
        const beforeJson = stringToUint8Array("Some output before
        const jsonChunk = stringToUint8Array(JSON.stringify(jsonOutput));
        const afterJson = stringToUint8Array("
        
        const inputStream = createReadableFromChunks([beforeJson, jsonChunk, afterJson]);
        const outputStream = inputStream.pipeThrough(extractStream);
        const chunks = await collectStreamChunks(outputStream);
        
        // Should pass through non-JSON content and content after JSON
        expect(chunks.length).toBeGreaterThan(0);
        expect(packOutputRef.current).toEqual(jsonOutput);
      });

      it("should transition to done state after successful JSON parsing", async () => {
        const jsonOutput = { name: "test", version: "1.0.0", filename: "test.tgz", files: [] };
        const jsonChunk = stringToUint8Array(JSON.stringify(jsonOutput));
        const afterJson = stringToUint8Array("Content after JSON");
        
        const inputStream = createReadableFromChunks([jsonChunk, afterJson]);
        const outputStream = inputStream.pipeThrough(extractStream);
        const chunks = await collectStreamChunks(outputStream);
        
        // Should pass through content after JSON parsing is complete
        const lastChunk = chunks[chunks.length - 1];
        expect(uint8ArrayToString(lastChunk)).toBe("Content after JSON");
        expect(packOutputRef.current).toEqual(jsonOutput);
      });
    });

    describe("error handling", () => {
      it("should handle malformed JSON gracefully", async () => {
        const malformedJson = stringToUint8Array('{"name": "test", "version":');
        const moreContent = stringToUint8Array(' invalid}');
        
        const inputStream = createReadableFromChunks([malformedJson, moreContent]);
        const outputStream = inputStream.pipeThrough(extractStream);
        const chunks = await collectStreamChunks(outputStream);
        
        // Should pass through the malformed JSON as regular content
        expect(chunks.length).toBeGreaterThan(0);
        expect(packOutputRef.current).toBeUndefined();
      });

      it("should recover from JSON parsing errors", async () => {
        const invalidJson = stringToUint8Array('{"invalid": json}');
        const validJson = stringToUint8Array('{"name": "test", "version": "1.0.0", "filename": "test.tgz", "files": []}');
        
        const inputStream = createReadableFromChunks([invalidJson, validJson]);
        const outputStream = inputStream.pipeThrough(extractStream);
        await collectStreamChunks(outputStream);
        
        // Should recover and parse the valid JSON
        expect(packOutputRef.current).toEqual({
          name: "test",
          version: "1.0.0",
          filename: "test.tgz",
          files: [],
        });
      });

      it("should handle incomplete JSON that might be recoverable", async () => {
        const incompleteJson1 = stringToUint8Array('{"name": "test"');
        const incompleteJson2 = stringToUint8Array(', "version": "1.0.0"');
        const completeJson = stringToUint8Array(', "filename": "test.tgz", "files": []}');
        
        const inputStream = createReadableFromChunks([incompleteJson1, incompleteJson2, completeJson]);
        const outputStream = inputStream.pipeThrough(extractStream);
        await collectStreamChunks(outputStream);
        
        expect(packOutputRef.current).toEqual({
          name: "test",
          version: "1.0.0",
          filename: "test.tgz",
          files: [],
        });
      });
    });

    describe("fromWeb() method", () => {
      it("should return a Node.js Duplex stream", () => {
        const nodeStream = extractStream.fromWeb();
        expect(nodeStream).toBeDefined();
        expect(typeof nodeStream.pipe).toBe("function");
        expect(typeof nodeStream.write).toBe("function");
        expect(typeof nodeStream.read).toBe("function");
      });
    });
  });
});


