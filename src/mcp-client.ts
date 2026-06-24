import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

export type McpTransportMode = "stdio" | "http";

export type McpToolClient = {
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
};

export async function connectMcpFromEnv(env = process.env): Promise<McpToolClient> {
  const mode = (env.SOCIAL_READER_MCP_TRANSPORT ?? "stdio") as McpTransportMode;
  let transport: Transport;

  if (mode === "http") {
    const url = env.SOCIAL_READER_MCP_URL;
    if (!url) throw new Error("SOCIAL_READER_MCP_URL is required when SOCIAL_READER_MCP_TRANSPORT=http");
    transport = new StreamableHTTPClientTransport(new URL(url));
  } else if (mode === "stdio") {
    const command = env.SOCIAL_READER_MCP_COMMAND ?? "/home/gene/repos/HermesSocialSummerizer/node_modules/.bin/tsx";
    const args = parseArgs(env.SOCIAL_READER_MCP_ARGS ?? "/home/gene/repos/HermesSocialSummerizer/src/server.ts");
    transport = new StdioClientTransport({ command, args, stderr: "inherit" });
  } else {
    throw new Error(`Unsupported SOCIAL_READER_MCP_TRANSPORT: ${mode}`);
  }

  const client = new Client({ name: "hermes-social-digest-pipeline", version: "0.1.0" }, { capabilities: {} });
  await client.connect(transport);

  return {
    async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
      const result = await client.callTool({ name, arguments: args });
      const content = result.content as Array<{ type: string; text?: string }> | undefined;
      const first = content?.find((item) => item.type === "text");
      if (!first?.text) return result;
      try {
        return JSON.parse(first.text);
      } catch {
        return first.text;
      }
    },
    async close(): Promise<void> {
      await client.close();
      await transport.close?.();
    },
  };
}

function parseArgs(raw: string): string[] {
  // Keep this intentionally simple: the expected value is a path or a
  // whitespace-separated command argument list managed by the user's flake/env.
  return raw.split(/\s+/).map((s) => s.trim()).filter(Boolean);
}
