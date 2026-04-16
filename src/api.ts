import express from 'express';
import { Registry } from './registry';

export function createApp(registry: Registry) {
  const app = express();
  app.use(express.json());

  // --- Servers ---
  app.post('/servers', (req, res) => {
    try {
      const { name, url, version } = req.body;
      if (!name || !url) return res.status(400).json({ error: 'name and url required' });
      const server = registry.registerServer(name, url, version);
      res.status(201).json(server);
    } catch (e: any) {
      res.status(409).json({ error: e.message });
    }
  });

  app.get('/servers', (_req, res) => {
    res.json(registry.listServers());
  });

  app.delete('/servers/:id', (req, res) => {
    registry.removeServer(req.params.id) ? res.status(204).end() : res.status(404).json({ error: 'not found' });
  });

  // --- Tools ---
  app.post('/servers/:serverId/tools', (req, res) => {
    try {
      const { name, description, inputSchema, capabilities, version } = req.body;
      if (!name) return res.status(400).json({ error: 'name required' });
      const tool = registry.registerTool(req.params.serverId, name, description || '', inputSchema, capabilities, version);
      res.status(201).json(tool);
    } catch (e: any) {
      res.status(409).json({ error: e.message });
    }
  });

  app.get('/tools', (req, res) => {
    const cap = req.query.capability as string | undefined;
    res.json(cap ? registry.findToolsByCapability(cap) : registry.listTools());
  });

  app.get('/servers/:serverId/tools', (req, res) => {
    res.json(registry.listTools(req.params.serverId));
  });

  app.delete('/tools/:id', (req, res) => {
    registry.removeTool(req.params.id) ? res.status(204).end() : res.status(404).json({ error: 'not found' });
  });

  // --- Routing ---
  app.post('/route', (req, res) => {
    const { toolName, agentId } = req.body;
    if (!toolName) return res.status(400).json({ error: 'toolName required' });
    if (agentId && !registry.checkPermission(agentId, toolName)) {
      return res.status(403).json({ error: 'permission denied' });
    }
    const result = registry.routeToolCall(toolName);
    result ? res.json(result) : res.status(404).json({ error: 'no available server for tool' });
  });

  // --- Health ---
  app.post('/servers/:serverId/health', (req, res) => {
    const { status, latencyMs, errorRate } = req.body;
    registry.recordHealth(req.params.serverId, status, latencyMs, errorRate);
    res.status(201).json({ ok: true });
  });

  app.get('/servers/:serverId/health', (req, res) => {
    const limit = parseInt(req.query.limit as string) || 10;
    res.json(registry.getHealthHistory(req.params.serverId, limit));
  });

  // --- Permissions ---
  app.post('/permissions', (req, res) => {
    const { agentId, toolPattern, allowed } = req.body;
    if (!agentId || !toolPattern) return res.status(400).json({ error: 'agentId and toolPattern required' });
    res.status(201).json(registry.setPermission(agentId, toolPattern, allowed ?? true));
  });

  app.get('/permissions/:agentId/check/:toolName', (req, res) => {
    res.json({ allowed: registry.checkPermission(req.params.agentId, req.params.toolName) });
  });

  return app;
}
