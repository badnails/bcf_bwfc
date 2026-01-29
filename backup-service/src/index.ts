// Backup Service - Main Entry Point

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { config } from './config';
import { performIncrementalDump, getDumpStatus } from './dump';
import { consolidateDumps, getConsolidationStatus } from './consolidate';
import { uploadBackup, checkUploadStatus, listRemoteBackups } from './upload';

const app = new Hono();

app.use('/*', cors());

// State tracking
let lastDumpTime: Date | null = null;
let lastUploadTime: Date | null = null;
let dumpIntervalId: Timer | null = null;
let uploadCheckIntervalId: Timer | null = null;
let isRunning = false;

// Health check
app.get('/health', async (c) => {
  const dumpStatus = await getDumpStatus();
  const uploadStatus = await checkUploadStatus();
  
  return c.json({
    status: 'healthy',
    service: 'backup-service',
    timestamp: new Date().toISOString(),
    config: {
      dumpIntervalMs: config.dumpIntervalMs,
      uploadHourUtc: config.uploadHourUtc,
    },
    lastDump: lastDumpTime?.toISOString() || null,
    lastUpload: lastUploadTime?.toISOString() || null,
    pendingDumps: dumpStatus.pendingFiles,
    uploadAllowed: uploadStatus.allowed,
  });
});

// Get backup status
app.get('/api/backup/status', async (c) => {
  const dumpStatus = await getDumpStatus();
  const consolidationStatus = await getConsolidationStatus();
  const uploadStatus = await checkUploadStatus();
  const remoteBackups = await listRemoteBackups();
  
  return c.json({
    scheduler: {
      isRunning,
      dumpIntervalMs: config.dumpIntervalMs,
      uploadHourUtc: config.uploadHourUtc,
    },
    localDumps: {
      lastDumpAt: lastDumpTime?.toISOString() || dumpStatus.lastDumpAt,
      pendingIncrementals: consolidationStatus.pendingIncrementals,
      lastConsolidated: consolidationStatus.lastConsolidatedFiles,
    },
    upload: {
      lastUploadAt: uploadStatus.lastUploadAt,
      nextAllowedAt: uploadStatus.nextAllowedAt,
      uploadAllowed: uploadStatus.allowed,
    },
    remoteBackups: remoteBackups.slice(0, 10), // Last 10
  });
});

// Manual trigger: Incremental dump
app.post('/api/backup/trigger-dump', async (c) => {
  console.log('[API] Manual dump triggered');
  
  try {
    const result = await performIncrementalDump();
    lastDumpTime = new Date();
    
    return c.json({
      success: true,
      message: 'Incremental dump completed',
      timestamp: lastDumpTime.toISOString(),
      files: result,
    });
  } catch (e: any) {
    return c.json({ 
      success: false, 
      error: e.message 
    }, 500);
  }
});

// Manual trigger: Consolidate dumps
app.post('/api/backup/trigger-consolidate', async (c) => {
  console.log('[API] Manual consolidation triggered');
  
  try {
    const filepath = await consolidateDumps();
    
    if (!filepath) {
      return c.json({ 
        success: false, 
        message: 'Consolidation failed' 
      }, 500);
    }
    
    return c.json({
      success: true,
      message: 'Consolidation completed',
      filepath,
      timestamp: new Date().toISOString(),
    });
  } catch (e: any) {
    return c.json({ 
      success: false, 
      error: e.message 
    }, 500);
  }
});

// Manual trigger: Full upload cycle (consolidate + upload)
app.post('/api/backup/trigger-upload', async (c) => {
  console.log('[API] Manual upload triggered');
  
  const bypassRateLimit = c.req.header('X-Bypass-Rate-Limit') === 'true';
  
  try {
    // First consolidate
    const filepath = await consolidateDumps();
    
    if (!filepath) {
      return c.json({ 
        success: false, 
        message: 'Consolidation failed' 
      }, 500);
    }
    
    // Then upload
    const result = await uploadBackup(filepath, bypassRateLimit);
    
    if (result.success) {
      lastUploadTime = new Date();
    }
    
    return c.json({
      success: result.success,
      message: result.message,
      filename: result.filename,
      rateLimited: result.rateLimited,
      timestamp: new Date().toISOString(),
    });
  } catch (e: any) {
    return c.json({ 
      success: false, 
      error: e.message 
    }, 500);
  }
});

// List remote backups
app.get('/api/backup/remote', async (c) => {
  const backups = await listRemoteBackups();
  
  return c.json({
    backups,
    total: backups.length,
  });
});

// List local dump files
app.get('/api/backup/dumps', async (c) => {
  try {
    const fs = await import('fs/promises');
    const path = await import('path');
    
    const files = await fs.readdir(config.dumpsDir);
    const sqlFiles = files.filter(f => f.endsWith('.sql')).sort().reverse();
    
    const dumps = await Promise.all(sqlFiles.map(async (filename) => {
      const filepath = path.join(config.dumpsDir, filename);
      const stat = await fs.stat(filepath);
      return {
        filename,
        size: stat.size,
        size_readable: stat.size < 1024 ? `${stat.size} B` : `${(stat.size / 1024).toFixed(1)} KB`,
        created: stat.mtime.toISOString(),
      };
    }));
    
    return c.json({
      dumps,
      total: dumps.length,
    });
  } catch (e: any) {
    return c.json({ dumps: [], total: 0 });
  }
});

// Get contents of a specific dump file
app.get('/api/backup/dumps/:filename', async (c) => {
  try {
    const fs = await import('fs/promises');
    const path = await import('path');
    
    const filename = c.req.param('filename');
    
    // Security: only allow .sql files, no path traversal
    if (!filename.endsWith('.sql') || filename.includes('..') || filename.includes('/')) {
      return c.json({ error: 'Invalid filename' }, 400);
    }
    
    const filepath = path.join(config.dumpsDir, filename);
    const content = await fs.readFile(filepath, 'utf-8');
    const stat = await fs.stat(filepath);
    
    return c.json({
      filename,
      size: stat.size,
      size_readable: stat.size < 1024 ? `${stat.size} B` : `${(stat.size / 1024).toFixed(1)} KB`,
      created: stat.mtime.toISOString(),
      content,
    });
  } catch (e: any) {
    return c.json({ error: 'File not found' }, 404);
  }
});

// Scheduler: Run incremental dump every N minutes
function startDumpScheduler(): void {
  console.log(`[SCHEDULER] Starting dump scheduler (every ${config.dumpIntervalMs / 1000}s)`);
  
  // Run first dump after a short delay
  setTimeout(async () => {
    await performIncrementalDump();
    lastDumpTime = new Date();
  }, 10000); // 10 seconds after startup
  
  // Then schedule regular dumps
  dumpIntervalId = setInterval(async () => {
    try {
      await performIncrementalDump();
      lastDumpTime = new Date();
    } catch (e) {
      console.error('[SCHEDULER] Dump error:', e);
    }
  }, config.dumpIntervalMs);
}

// Scheduler: Check for daily upload at specified hour
function startUploadScheduler(): void {
  console.log(`[SCHEDULER] Starting upload scheduler (daily at ${config.uploadHourUtc}:00 UTC)`);
  
  // Check every minute if it's time for daily upload
  uploadCheckIntervalId = setInterval(async () => {
    const now = new Date();
    const currentHourUtc = now.getUTCHours();
    const currentMinuteUtc = now.getUTCMinutes();
    
    // Trigger at the specified hour, minute 0
    if (currentHourUtc === config.uploadHourUtc && currentMinuteUtc === 0) {
      console.log('[SCHEDULER] Daily upload time reached');
      
      try {
        // Check if upload is allowed
        const status = await checkUploadStatus();
        
        if (!status.allowed) {
          console.log('[SCHEDULER] Upload not allowed yet, skipping');
          return;
        }
        
        // Consolidate and upload
        const filepath = await consolidateDumps();
        
        if (filepath) {
          const result = await uploadBackup(filepath);
          
          if (result.success) {
            lastUploadTime = new Date();
            console.log('[SCHEDULER] Daily upload completed successfully');
          } else {
            console.error('[SCHEDULER] Daily upload failed:', result.message);
          }
        }
      } catch (e) {
        console.error('[SCHEDULER] Upload error:', e);
      }
    }
  }, 60000); // Check every minute
}

// Start schedulers
function startSchedulers(): void {
  isRunning = true;
  startDumpScheduler();
  startUploadScheduler();
}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[SCHEDULER] Shutting down...');
  isRunning = false;
  if (dumpIntervalId) clearInterval(dumpIntervalId);
  if (uploadCheckIntervalId) clearInterval(uploadCheckIntervalId);
  process.exit(0);
});

// Start the service
console.log(`Backup Service running on port ${config.port}`);
console.log(`  - Dump interval: ${config.dumpIntervalMs / 1000}s`);
console.log(`  - Upload hour (UTC): ${config.uploadHourUtc}:00`);
console.log(`  - Dumps directory: ${config.dumpsDir}`);
console.log(`  - Mock backup URL: ${config.mockBackupUrl}`);

startSchedulers();

export default {
  port: config.port,
  fetch: app.fetch,
};
