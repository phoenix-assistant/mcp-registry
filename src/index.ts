import { Registry } from './registry';
import { createApp } from './api';

const PORT = parseInt(process.env.PORT || '3100');
const DB_PATH = process.env.DB_PATH || './mcp-registry.db';

const registry = new Registry(DB_PATH);
const app = createApp(registry);

app.listen(PORT, () => {
  console.log(`MCP Registry running on http://localhost:${PORT}`);
});

process.on('SIGINT', () => { registry.close(); process.exit(0); });
process.on('SIGTERM', () => { registry.close(); process.exit(0); });

export { Registry, createApp };
