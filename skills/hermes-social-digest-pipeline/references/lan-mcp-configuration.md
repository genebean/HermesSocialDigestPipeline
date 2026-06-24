# LAN MCP Configuration

Local stdio mode:

```bash
SOCIAL_READER_MCP_TRANSPORT=stdio
SOCIAL_READER_MCP_COMMAND=/home/gene/repos/HermesSocialSummerizer/node_modules/.bin/tsx
SOCIAL_READER_MCP_ARGS=/home/gene/repos/HermesSocialSummerizer/src/server.ts
```

LAN HTTP mode:

```bash
SOCIAL_READER_MCP_TRANSPORT=http
SOCIAL_READER_MCP_URL=http://social-reader.lan:PORT/mcp
```

The MCP host remains independent. Do not require digest scripts or Hermes Agent on that host.
