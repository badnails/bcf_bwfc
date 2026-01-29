import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { config } from './config';
import inventory from './routes/inventory';
import deduct from './routes/deduct';
import admin from './routes/admin';
import gremlin from './routes/gremlin';
import health from './routes/health';

const app = new Hono();

app.use('/*', cors());

app.route('/api/inventory', inventory);
app.route('/internal/inventory/deduct', deduct);
app.route('/internal/inventory', admin);
app.route('/internal/gremlin', gremlin);
app.route('/health', health);

// Start server
console.log(`Inventory Service running on port ${config.server.port}`);

export default {
  port: config.server.port,
  fetch: app.fetch,
};
