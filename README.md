# MCP Registry

Centralized MCP tool registry and routing gateway for multi-agent systems.

## Features

- **Registry** — Tool catalog with capability metadata and versioning
- **Router** — Route tool calls to the best available MCP server instance
- **Health Monitor** — Track server availability, latency, and error rates
- **Permission Layer** — Agent-level access control with pattern matching
- **REST API** — Full CRUD for servers, tools, health, and permissions

## Quick Start

```bash
npm install
npm run build
npm start
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/servers` | Register an MCP server |
| GET | `/servers` | List all servers |
| DELETE | `/servers/:id` | Remove a server |
| POST | `/servers/:id/tools` | Register a tool |
| GET | `/tools` | List tools (optional `?capability=` filter) |
| POST | `/route` | Route a tool call `{ toolName, agentId? }` |
| POST | `/servers/:id/health` | Record health check |
| GET | `/servers/:id/health` | Get health history |
| POST | `/permissions` | Set permission rule |
| GET | `/permissions/:agentId/check/:toolName` | Check permission |

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3100` | API port |
| `DB_PATH` | `./mcp-registry.db` | SQLite database path |

## License

MIT
