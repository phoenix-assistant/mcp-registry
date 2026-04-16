import { Registry } from '../src/registry';
import { createApp } from '../src/api';
import http from 'http';

// --- Unit tests for Registry ---
describe('Registry', () => {
  let reg: Registry;
  beforeEach(() => { reg = new Registry(':memory:'); });
  afterEach(() => { reg.close(); });

  test('register and list servers', () => {
    const s = reg.registerServer('test-server', 'http://localhost:9000');
    expect(s.name).toBe('test-server');
    expect(reg.listServers()).toHaveLength(1);
  });

  test('register and find tools by capability', () => {
    const s = reg.registerServer('s1', 'http://localhost:9000');
    reg.registerTool(s.id, 'read_file', 'Read a file', {}, ['filesystem', 'read']);
    reg.registerTool(s.id, 'write_file', 'Write a file', {}, ['filesystem', 'write']);
    reg.registerTool(s.id, 'web_search', 'Search web', {}, ['web']);
    expect(reg.findToolsByCapability('filesystem')).toHaveLength(2);
    expect(reg.findToolsByCapability('web')).toHaveLength(1);
  });

  test('route tool call to online server', () => {
    const s = reg.registerServer('s1', 'http://localhost:9000');
    reg.registerTool(s.id, 'my_tool', 'desc');
    const result = reg.routeToolCall('my_tool');
    expect(result).toBeDefined();
    expect(result!.server.url).toBe('http://localhost:9000');
  });

  test('route skips offline servers', () => {
    const s = reg.registerServer('s1', 'http://localhost:9000');
    reg.registerTool(s.id, 'my_tool', 'desc');
    reg.recordHealth(s.id, 'offline', 999, 1.0);
    expect(reg.routeToolCall('my_tool')).toBeUndefined();
  });

  test('health recording updates server status', () => {
    const s = reg.registerServer('s1', 'http://localhost:9000');
    reg.recordHealth(s.id, 'degraded', 200, 0.05);
    const updated = reg.getServer(s.id)!;
    expect(updated.status).toBe('degraded');
    expect(updated.latencyMs).toBe(200);
    expect(reg.getHealthHistory(s.id)).toHaveLength(1);
  });

  test('permissions: wildcard allow', () => {
    reg.setPermission('agent-1', '*', true);
    expect(reg.checkPermission('agent-1', 'anything')).toBe(true);
  });

  test('permissions: prefix deny', () => {
    reg.setPermission('agent-2', 'write*', false);
    reg.setPermission('agent-2', '*', true);
    expect(reg.checkPermission('agent-2', 'write_file')).toBe(false);
    expect(reg.checkPermission('agent-2', 'read_file')).toBe(true);
  });

  test('remove server cascades tools', () => {
    const s = reg.registerServer('s1', 'http://localhost:9000');
    reg.registerTool(s.id, 'tool1', 'desc');
    reg.removeServer(s.id);
    expect(reg.listTools()).toHaveLength(0);
  });
});

// --- API integration tests ---
describe('API', () => {
  let reg: Registry;
  let server: http.Server;
  let baseUrl: string;

  beforeAll((done) => {
    reg = new Registry(':memory:');
    const app = createApp(reg);
    server = app.listen(0, () => {
      const addr = server.address() as any;
      baseUrl = `http://127.0.0.1:${addr.port}`;
      done();
    });
  });
  afterAll((done) => { reg.close(); server.close(done); });

  const request = (method: string, path: string, body?: any): Promise<{ status: number; data: any }> =>
    new Promise((resolve, reject) => {
      const url = new URL(path, baseUrl);
      const opts: http.RequestOptions = { method, hostname: url.hostname, port: url.port, path: url.pathname + url.search, headers: { 'Content-Type': 'application/json' } };
      const req = http.request(opts, (res) => {
        let d = '';
        res.on('data', (c) => d += c);
        res.on('end', () => {
          let parsed = null;
          try { if (d) parsed = JSON.parse(d); } catch {}
          resolve({ status: res.statusCode!, data: parsed });
        });
      });
      req.on('error', reject);
      if (body) req.write(JSON.stringify(body));
      req.end();
    });

  test('full lifecycle: register server, tool, route, health', async () => {
    const { status: s1, data: srv } = await request('POST', '/servers', { name: 'api-srv', url: 'http://localhost:5000' });
    expect(s1).toBe(201);

    const { status: s2 } = await request('POST', `/servers/${srv.id}/tools`, { name: 'api_tool', description: 'test', capabilities: ['test'] });
    expect(s2).toBe(201);

    const { data: tools } = await request('GET', '/tools?capability=test');
    expect(tools).toHaveLength(1);

    const { data: route } = await request('POST', '/route', { toolName: 'api_tool' });
    expect(route.server.url).toBe('http://localhost:5000');

    const { status: s3 } = await request('POST', `/servers/${srv.id}/health`, { status: 'online', latencyMs: 50, errorRate: 0 });
    expect(s3).toBe(201);
  });

  test('route with permission denied', async () => {
    await request('POST', '/permissions', { agentId: 'restricted', toolPattern: '*', allowed: false });
    const { status } = await request('POST', '/route', { toolName: 'api_tool', agentId: 'restricted' });
    expect(status).toBe(403);
  });
});
