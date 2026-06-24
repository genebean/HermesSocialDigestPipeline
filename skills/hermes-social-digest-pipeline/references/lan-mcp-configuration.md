# LAN MCP configuration

The MCP is treated as a black box. The pipeline runs on the Hermes host.

Local stdio development:

```bash
SOCIAL_READER_MCP_TRANSPORT=stdio
SOCIAL_READER_MCP_COMMAND=/path/to/HermesSocialSummerizer/node_modules/.bin/tsx
SOCIAL_READER_MCP_ARGS=/path/to/HermesSocialSummerizer/src/server.ts
```

Use `SOCIAL_READER_MCP_ARGS_JSON` when an argument contains whitespace:

```bash
SOCIAL_READER_MCP_ARGS_JSON='["/path/with spaces/server.ts"]'
```

LAN deployment should prefer an encrypted/authenticated transport:

```bash
SOCIAL_READER_MCP_TRANSPORT=http
SOCIAL_READER_MCP_URL=https://social-reader.lan/mcp
```

Non-local `http://` URLs are blocked by default. Only use this on a trusted private network or tunnel:

```bash
SOCIAL_READER_MCP_ALLOW_INSECURE_HTTP=true
```

Even though the MCP is read-only toward social platforms, it can expose private feed data and `mark_seen`, so do not publish it unauthenticated on a hostile network.
