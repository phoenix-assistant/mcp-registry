import Database from 'better-sqlite3';
import { v4 as uuid } from 'uuid';

export interface McpServer {
  id: string;
  name: string;
  url: string;
  version: string;
  status: 'online' | 'offline' | 'degraded';
  lastHealthCheck: string | null;
  latencyMs: number | null;
  errorRate: number;
  createdAt: string;
}

export interface Tool {
  id: string;
  serverId: string;
  name: string;
  description: string;
  inputSchema: string;
  capabilities: string; // JSON array of capability tags
  version: string;
  createdAt: string;
}

export interface Permission {
  id: string;
  agentId: string;
  toolPattern: string; // glob-like pattern e.g. "read*" or "*"
  allowed: boolean;
  createdAt: string;
}

export interface HealthRecord {
  id: string;
  serverId: string;
  status: 'online' | 'offline' | 'degraded';
  latencyMs: number;
  errorRate: number;
  checkedAt: string;
}

export class Registry {
  private db: Database.Database;

  constructor(dbPath: string = ':memory:') {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.init();
  }

  private init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS servers (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        url TEXT NOT NULL,
        version TEXT NOT NULL DEFAULT '1.0.0',
        status TEXT NOT NULL DEFAULT 'online',
        last_health_check TEXT,
        latency_ms REAL,
        error_rate REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS tools (
        id TEXT PRIMARY KEY,
        server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        input_schema TEXT NOT NULL DEFAULT '{}',
        capabilities TEXT NOT NULL DEFAULT '[]',
        version TEXT NOT NULL DEFAULT '1.0.0',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(server_id, name)
      );
      CREATE TABLE IF NOT EXISTS permissions (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        tool_pattern TEXT NOT NULL,
        allowed INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(agent_id, tool_pattern)
      );
      CREATE TABLE IF NOT EXISTS health_log (
        id TEXT PRIMARY KEY,
        server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        latency_ms REAL NOT NULL,
        error_rate REAL NOT NULL,
        checked_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }

  // --- Server CRUD ---
  registerServer(name: string, url: string, version: string = '1.0.0'): McpServer {
    const id = uuid();
    this.db.prepare(
      'INSERT INTO servers (id, name, url, version) VALUES (?, ?, ?, ?)'
    ).run(id, name, url, version);
    return this.getServer(id)!;
  }

  getServer(id: string): McpServer | undefined {
    const row = this.db.prepare('SELECT * FROM servers WHERE id = ?').get(id) as any;
    return row ? this.mapServer(row) : undefined;
  }

  listServers(): McpServer[] {
    return (this.db.prepare('SELECT * FROM servers ORDER BY name').all() as any[]).map(this.mapServer);
  }

  removeServer(id: string): boolean {
    return this.db.prepare('DELETE FROM servers WHERE id = ?').run(id).changes > 0;
  }

  private mapServer(r: any): McpServer {
    return { id: r.id, name: r.name, url: r.url, version: r.version, status: r.status, lastHealthCheck: r.last_health_check, latencyMs: r.latency_ms, errorRate: r.error_rate, createdAt: r.created_at };
  }

  // --- Tool CRUD ---
  registerTool(serverId: string, name: string, description: string, inputSchema: object = {}, capabilities: string[] = [], version: string = '1.0.0'): Tool {
    const id = uuid();
    this.db.prepare(
      'INSERT INTO tools (id, server_id, name, description, input_schema, capabilities, version) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, serverId, name, description, JSON.stringify(inputSchema), JSON.stringify(capabilities), version);
    return this.getTool(id)!;
  }

  getTool(id: string): Tool | undefined {
    const row = this.db.prepare('SELECT * FROM tools WHERE id = ?').get(id) as any;
    return row ? this.mapTool(row) : undefined;
  }

  listTools(serverId?: string): Tool[] {
    const sql = serverId ? 'SELECT * FROM tools WHERE server_id = ? ORDER BY name' : 'SELECT * FROM tools ORDER BY name';
    const rows = serverId ? this.db.prepare(sql).all(serverId) : this.db.prepare(sql).all();
    return (rows as any[]).map(this.mapTool);
  }

  findToolsByCapability(capability: string): Tool[] {
    return (this.db.prepare("SELECT * FROM tools WHERE capabilities LIKE ? ORDER BY name").all(`%"${capability}"%`) as any[]).map(this.mapTool);
  }

  removeTool(id: string): boolean {
    return this.db.prepare('DELETE FROM tools WHERE id = ?').run(id).changes > 0;
  }

  private mapTool(r: any): Tool {
    return { id: r.id, serverId: r.server_id, name: r.name, description: r.description, inputSchema: r.input_schema, capabilities: r.capabilities, version: r.version, createdAt: r.created_at };
  }

  // --- Routing ---
  routeToolCall(toolName: string): { tool: Tool; server: McpServer } | undefined {
    const row = this.db.prepare(`
      SELECT t.*, s.url as server_url, s.name as server_name, s.status as server_status,
             s.version as server_version, s.last_health_check, s.latency_ms, s.error_rate, s.created_at as server_created_at, s.id as sid
      FROM tools t JOIN servers s ON t.server_id = s.id
      WHERE t.name = ? AND s.status = 'online'
      ORDER BY s.latency_ms ASC NULLS LAST LIMIT 1
    `).get(toolName) as any;
    if (!row) return undefined;
    return {
      tool: this.mapTool(row),
      server: { id: row.sid, name: row.server_name, url: row.server_url, version: row.server_version, status: row.server_status, lastHealthCheck: row.last_health_check, latencyMs: row.latency_ms, errorRate: row.error_rate, createdAt: row.server_created_at }
    };
  }

  // --- Health ---
  recordHealth(serverId: string, status: 'online' | 'offline' | 'degraded', latencyMs: number, errorRate: number): void {
    const id = uuid();
    this.db.prepare('INSERT INTO health_log (id, server_id, status, latency_ms, error_rate) VALUES (?, ?, ?, ?, ?)').run(id, serverId, status, latencyMs, errorRate);
    this.db.prepare(`UPDATE servers SET status = ?, last_health_check = datetime('now'), latency_ms = ?, error_rate = ? WHERE id = ?`).run(status, latencyMs, errorRate, serverId);
  }

  getHealthHistory(serverId: string, limit: number = 10): HealthRecord[] {
    return (this.db.prepare('SELECT * FROM health_log WHERE server_id = ? ORDER BY checked_at DESC LIMIT ?').all(serverId, limit) as any[]).map(r => ({
      id: r.id, serverId: r.server_id, status: r.status, latencyMs: r.latency_ms, errorRate: r.error_rate, checkedAt: r.checked_at
    }));
  }

  // --- Permissions ---
  setPermission(agentId: string, toolPattern: string, allowed: boolean = true): Permission {
    const id = uuid();
    this.db.prepare(
      'INSERT OR REPLACE INTO permissions (id, agent_id, tool_pattern, allowed) VALUES (?, ?, ?, ?)'
    ).run(id, agentId, toolPattern, allowed ? 1 : 0);
    return { id, agentId, toolPattern, allowed, createdAt: new Date().toISOString() };
  }

  checkPermission(agentId: string, toolName: string): boolean {
    // Check specific deny first, then allow patterns
    const perms = this.db.prepare('SELECT * FROM permissions WHERE agent_id = ? ORDER BY tool_pattern DESC').all(agentId) as any[];
    if (perms.length === 0) return true; // no rules = allow all
    for (const p of perms) {
      if (this.matchPattern(p.tool_pattern, toolName)) {
        return p.allowed === 1;
      }
    }
    return false; // has rules but none match = deny
  }

  private matchPattern(pattern: string, name: string): boolean {
    if (pattern === '*') return true;
    if (pattern.endsWith('*')) return name.startsWith(pattern.slice(0, -1));
    return pattern === name;
  }

  close() {
    this.db.close();
  }
}
