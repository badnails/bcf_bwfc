// Incremental Database Dump Logic

import { config } from './config';
import { readFile, writeFile, readdir, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { $ } from 'bun';

const TRACKING_FILE = join(config.dumpsDir, '.last_dump_tracking.json');

interface DumpTracking {
  orderDb: {
    lastOrderCreatedAt: string | null;
  };
  inventoryDb: {
    lastOperationId: number | null;
  };
  lastDumpAt: string | null;
}

// Load tracking data
async function loadTracking(): Promise<DumpTracking> {
  try {
    if (existsSync(TRACKING_FILE)) {
      const data = await readFile(TRACKING_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (e) {
    console.error('[DUMP] Error loading tracking:', e);
  }
  
  return {
    orderDb: { lastOrderCreatedAt: null },
    inventoryDb: { lastOperationId: null },
    lastDumpAt: null,
  };
}

// Save tracking data
async function saveTracking(tracking: DumpTracking): Promise<void> {
  await writeFile(TRACKING_FILE, JSON.stringify(tracking, null, 2));
}

// Execute SQL query and get results as INSERT statements
async function queryToInserts(
  dbConfig: typeof config.orderDb,
  tableName: string,
  whereClause: string | null
): Promise<{ sql: string; count: number; maxId?: number; maxCreatedAt?: string }> {
  const env = {
    PGPASSWORD: dbConfig.password,
  };
  
  // Build query
  let query = `SELECT * FROM ${tableName}`;
  if (whereClause) {
    query += ` WHERE ${whereClause}`;
  }
  query += ` ORDER BY created_at ASC`;
  
  try {
    // Get data as JSON for easier parsing
    // Use row_to_json with timestamp casting to avoid timezone issues
    const jsonQuery = `SELECT json_agg(row_to_json(t)) FROM (${query}) t`;
    const result = await $`PGPASSWORD=${env.PGPASSWORD} psql -h ${dbConfig.host} -p ${dbConfig.port} -U ${dbConfig.user} -d ${dbConfig.database} -t -c ${jsonQuery}`.text();
    
    const trimmed = result.trim();
    if (!trimmed || trimmed === '' || trimmed === 'null') {
      return { sql: '', count: 0 };
    }
    
    // PostgreSQL returns timestamps with +00, need to handle that
    // Replace +00 timezone suffix before parsing
    const cleanedJson = trimmed.replace(/\+00"/g, 'Z"').replace(/\+00'/g, "Z'");
    
    const rows = JSON.parse(cleanedJson);
    if (!rows || rows.length === 0) {
      return { sql: '', count: 0 };
    }
    
    // Generate INSERT statements
    let sql = '';
    let maxId: number | undefined;
    let maxCreatedAt: string | undefined;
    
    for (const row of rows) {
      const columns = Object.keys(row);
      const values = columns.map(col => {
        const val = row[col];
        if (val === null) return 'NULL';
        if (typeof val === 'number') return val;
        if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
        // Escape single quotes
        return `'${String(val).replace(/'/g, "''")}'`;
      });
      
      sql += `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${values.join(', ')}) ON CONFLICT DO NOTHING;\n`;
      
      // Track max values for next incremental
      if (row.operation_id) maxId = Math.max(maxId || 0, row.operation_id);
      if (row.created_at) maxCreatedAt = row.created_at;
    }
    
    return { sql, count: rows.length, maxId, maxCreatedAt };
  } catch (e: any) {
    console.error(`[DUMP] Query error for ${tableName}:`, e.message);
    return { sql: '', count: 0 };
  }
}

// Main incremental dump function
export async function performIncrementalDump(): Promise<{ orderDump: string | null; inventoryDump: string | null; stats: any }> {
  console.log('[DUMP] Starting incremental dump...');
  
  const tracking = await loadTracking();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const stats = {
    orders: { new: 0 },
    operations: { new: 0 },
  };
  
  // Ensure dumps directory exists
  if (!existsSync(config.dumpsDir)) {
    await mkdir(config.dumpsDir, { recursive: true });
  }
  
  // === ORDER DB DUMP ===
  const orderFilename = `order_db_incremental_${timestamp}.sql`;
  const orderFilepath = join(config.dumpsDir, orderFilename);
  
  let orderSql = `-- Incremental Backup: order_db\n`;
  orderSql += `-- Generated: ${new Date().toISOString()}\n`;
  orderSql += `-- Type: INCREMENTAL (new records only)\n\n`;
  
  // Orders - incremental
  const orderWhere = tracking.orderDb.lastOrderCreatedAt
    ? `created_at > '${tracking.orderDb.lastOrderCreatedAt}'`
    : null;
  
  const ordersResult = await queryToInserts(config.orderDb, 'orders', orderWhere);
  stats.orders.new = ordersResult.count;
  
  if (ordersResult.count > 0) {
    orderSql += `-- New orders: ${ordersResult.count}\n`;
    orderSql += ordersResult.sql;
  } else {
    orderSql += `-- No new orders since last backup\n`;
  }
  
  await writeFile(orderFilepath, orderSql);
  console.log(`[DUMP] Order DB: ${ordersResult.count} new records -> ${orderFilename}`);
  
  // === INVENTORY DB DUMP ===
  const invFilename = `inventory_db_incremental_${timestamp}.sql`;
  const invFilepath = join(config.dumpsDir, invFilename);
  
  let invSql = `-- Incremental Backup: inventory_db\n`;
  invSql += `-- Generated: ${new Date().toISOString()}\n`;
  invSql += `-- Type: INCREMENTAL (new records only)\n\n`;
  
  // Inventory operations - incremental by operation_id
  const opWhere = tracking.inventoryDb.lastOperationId
    ? `operation_id > ${tracking.inventoryDb.lastOperationId}`
    : null;
  
  const opsResult = await queryToInserts(config.inventoryDb, 'inventory_operations', opWhere);
  stats.operations.new = opsResult.count;
  
  if (opsResult.count > 0) {
    invSql += `-- New operations: ${opsResult.count}\n`;
    invSql += opsResult.sql;
  } else {
    invSql += `-- No new inventory operations since last backup\n`;
  }
  
  await writeFile(invFilepath, invSql);
  console.log(`[DUMP] Inventory DB: ${opsResult.count} new operations -> ${invFilename}`);
  
  // Update tracking
  const newTracking: DumpTracking = {
    orderDb: {
      lastOrderCreatedAt: ordersResult.maxCreatedAt || tracking.orderDb.lastOrderCreatedAt || new Date().toISOString(),
    },
    inventoryDb: {
      lastOperationId: opsResult.maxId || tracking.inventoryDb.lastOperationId || 0,
    },
    lastDumpAt: new Date().toISOString(),
  };
  
  await saveTracking(newTracking);
  console.log('[DUMP] Tracking updated:', newTracking);
  
  return {
    orderDump: orderFilepath,
    inventoryDump: invFilepath,
    stats,
  };
}

// Full dump for consolidation (includes schema + all data)
export async function performFullDump(): Promise<{ orderDump: string; inventoryDump: string }> {
  console.log('[DUMP] Starting full dump for consolidation...');
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  
  // Order DB full dump
  const orderFilename = `order_db_full_${timestamp}.sql`;
  const orderFilepath = join(config.dumpsDir, orderFilename);
  
  const orderResult = await $`PGPASSWORD=${config.orderDb.password} pg_dump -h ${config.orderDb.host} -p ${config.orderDb.port} -U ${config.orderDb.user} ${config.orderDb.database} --no-owner --no-acl`.text();
  await writeFile(orderFilepath, orderResult);
  console.log(`[DUMP] Full order dump: ${orderFilename}`);
  
  // Inventory DB full dump
  const invFilename = `inventory_db_full_${timestamp}.sql`;
  const invFilepath = join(config.dumpsDir, invFilename);
  
  const invResult = await $`PGPASSWORD=${config.inventoryDb.password} pg_dump -h ${config.inventoryDb.host} -p ${config.inventoryDb.port} -U ${config.inventoryDb.user} ${config.inventoryDb.database} --no-owner --no-acl`.text();
  await writeFile(invFilepath, invResult);
  console.log(`[DUMP] Full inventory dump: ${invFilename}`);
  
  return { orderDump: orderFilepath, inventoryDump: invFilepath };
}

// Get list of pending dump files
export async function getPendingDumps(): Promise<string[]> {
  try {
    const files = await readdir(config.dumpsDir);
    return files
      .filter(f => f.endsWith('.sql') && !f.startsWith('.'))
      .map(f => join(config.dumpsDir, f))
      .sort();
  } catch {
    return [];
  }
}

// Get dump status
export async function getDumpStatus(): Promise<{
  lastDumpAt: string | null;
  pendingFiles: number;
  dumpsDir: string;
  tracking: DumpTracking;
}> {
  const tracking = await loadTracking();
  const pending = await getPendingDumps();
  
  return {
    lastDumpAt: tracking.lastDumpAt,
    pendingFiles: pending.length,
    dumpsDir: config.dumpsDir,
    tracking,
  };
}
