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
    const parsed = new URL(url);
    requireSafeHttpUrl(parsed, env);
    transport = new StreamableHTTPClientTransport(parsed, httpTransportOptions(env));
  } else if (mode === "stdio") {
    const command = env.SOCIAL_READER_MCP_COMMAND ?? "social-reader";
    const args = parseArgs(env.SOCIAL_READER_MCP_ARGS ?? "", env.SOCIAL_READER_MCP_ARGS_JSON);
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

function httpTransportOptions(env: NodeJS.ProcessEnv): { requestInit?: RequestInit } | undefined {
  const token = env.SOCIAL_READER_MCP_HTTP_TOKEN?.trim();
  if (!token) return undefined;
  return { requestInit: { headers: { Authorization: "Bearer ".concat(token) } } };
}

function requireSafeHttpUrl(url: URL, env: NodeJS.ProcessEnv): void {
  if (url.protocol === "https:") return;
  if (url.protocol !== "http:") throw new Error(`Unsupported MCP URL protocol: ${url.protocol}`);
  if (isLocalhost(url.hostname)) return;
  if (env.SOCIAL_READER_MCP_ALLOW_INSECURE_HTTP === "true") return;

  throw new Error(
    "Refusing non-local http MCP URL. Use https, bind MCP to localhost/tunnel it, "
      + "or explicitly set SOCIAL_READER_MCP_ALLOW_INSECURE_HTTP=true for a trusted private network.",
  );
}

function isLocalhost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}

function parseArgs(raw: string, rawJson?: string): string[] {
  if (rawJson?.trim()) {
    const parsed = JSON.parse(rawJson) as unknown;
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
      throw new Error("SOCIAL_READER_MCP_ARGS_JSON must be a JSON array of strings");
    }
    return parsed;
  }

  // Keep this intentionally simple for the common path-only case. Use
  // SOCIAL_READER_MCP_ARGS_JSON when an argument contains whitespace.
  return raw.split(/\s+/).map((s) => s.trim()).filter(Boolean);
}
