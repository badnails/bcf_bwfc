// Backup Service Configuration

export const config = {
  port: parseInt(process.env.PORT || '3002'),
  
  // Order Database
  orderDb: {
    host: process.env.ORDER_DB_HOST || 'order-db',
    port: parseInt(process.env.ORDER_DB_PORT || '5432'),
    database: process.env.ORDER_DB_NAME || 'order_db',
    user: process.env.ORDER_DB_USER || 'postgres',
    password: process.env.ORDER_DB_PASSWORD || 'postgres',
  },
  
  // Inventory Database
  inventoryDb: {
    host: process.env.INVENTORY_DB_HOST || 'inventory-db',
    port: parseInt(process.env.INVENTORY_DB_PORT || '5432'),
    database: process.env.INVENTORY_DB_NAME || 'inventory_db',
    user: process.env.INVENTORY_DB_USER || 'postgres',
    password: process.env.INVENTORY_DB_PASSWORD || 'postgres',
  },
  
  // Mock backup service URL
  mockBackupUrl: process.env.MOCK_BACKUP_URL || 'http://mock-backup-service:3003',
  
  // Dump interval in milliseconds (default: 5 minutes)
  dumpIntervalMs: parseInt(process.env.DUMP_INTERVAL_MS || '300000'),
  
  // Hour of day (UTC) for daily upload (default: 0 = midnight)
  uploadHourUtc: parseInt(process.env.UPLOAD_HOUR_UTC || '0'),
  
  // Dumps directory
  dumpsDir: process.env.DUMPS_DIR || '/dumps',
};
