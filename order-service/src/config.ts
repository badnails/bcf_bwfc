export const config = {
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'order_db',
    username: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  },
  server: {
    port: parseInt(process.env.PORT || '3000'),
  },
  inventory: {
    serviceUrl: process.env.INVENTORY_SERVICE_URL || 'http://localhost:3001',
    timeoutMs: parseInt(process.env.INVENTORY_TIMEOUT_MS || '3000'),
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
  },
  worker: {
    maxRetryAttempts: parseInt(process.env.WORKER_MAX_RETRY_ATTEMPTS || '5'),
    initialRetryDelayMs: parseInt(process.env.WORKER_INITIAL_RETRY_DELAY_MS || '5000'),
  },
};
