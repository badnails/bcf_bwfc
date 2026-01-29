import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { readdir, writeFile, readFile, stat, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

const app = new Hono();

app.use('/*', cors());

const BACKUP_DIR = process.env.BACKUP_DIR || '/backups';
const RATE_LIMIT_FILE = join(BACKUP_DIR, '.last_upload');

// Ensure backup directory exists
if (!existsSync(BACKUP_DIR)) {
  await mkdir(BACKUP_DIR, { recursive: true });
}

// Check if upload is allowed (once per 24 hours)
async function canUpload(): Promise<{ allowed: boolean; nextAllowedAt?: Date; lastUploadAt?: Date }> {
  try {
    if (!existsSync(RATE_LIMIT_FILE)) {
      return { allowed: true };
    }
    
    const lastUploadTime = await readFile(RATE_LIMIT_FILE, 'utf-8');
    const lastUpload = new Date(lastUploadTime.trim());
    const now = new Date();
    const hoursSinceLastUpload = (now.getTime() - lastUpload.getTime()) / (1000 * 60 * 60);
    
    if (hoursSinceLastUpload >= 24) {
      return { allowed: true, lastUploadAt: lastUpload };
    }
    
    const nextAllowed = new Date(lastUpload.getTime() + 24 * 60 * 60 * 1000);
    return { allowed: false, nextAllowedAt: nextAllowed, lastUploadAt: lastUpload };
  } catch {
    return { allowed: true };
  }
}

// Record upload time
async function recordUpload(): Promise<void> {
  await writeFile(RATE_LIMIT_FILE, new Date().toISOString());
}

// Health check
app.get('/health', (c) => {
  return c.json({ 
    status: 'healthy', 
    service: 'mock-backup-service',
    timestamp: new Date().toISOString()
  });
});

// Get upload status
app.get('/api/backup/status', async (c) => {
  const { allowed, nextAllowedAt, lastUploadAt } = await canUpload();
  
  return c.json({
    upload_allowed: allowed,
    last_upload_at: lastUploadAt?.toISOString() || null,
    next_allowed_at: nextAllowedAt?.toISOString() || null,
    message: allowed 
      ? 'Upload is allowed' 
      : `Rate limited. Next upload allowed at ${nextAllowedAt?.toISOString()}`
  });
});

// List all uploaded backups
app.get('/api/backup/list', async (c) => {
  try {
    const files = await readdir(BACKUP_DIR);
    const backups = [];
    
    for (const file of files) {
      if (file.startsWith('.')) continue; // Skip hidden files
      
      const filePath = join(BACKUP_DIR, file);
      const stats = await stat(filePath);
      
      backups.push({
        filename: file,
        size_bytes: stats.size,
        size_readable: formatBytes(stats.size),
        uploaded_at: stats.mtime.toISOString()
      });
    }
    
    // Sort by upload date descending
    backups.sort((a, b) => new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime());
    
    return c.json({
      backups,
      total_count: backups.length,
      total_size: formatBytes(backups.reduce((sum, b) => sum + b.size_bytes, 0))
    });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// Upload backup (rate limited: 1 per day)
app.post('/api/backup/upload', async (c) => {
  // Check if bypass flag is set (for demo purposes)
  const bypassRateLimit = c.req.header('X-Bypass-Rate-Limit') === 'true';
  
  if (!bypassRateLimit) {
    const { allowed, nextAllowedAt } = await canUpload();
    
    if (!allowed) {
      return c.json({
        error: {
          code: 'RATE_LIMITED',
          message: 'Backup upload limit exceeded. Only 1 upload per 24 hours is allowed.',
          next_allowed_at: nextAllowedAt?.toISOString()
        }
      }, 429);
    }
  }
  
  try {
    const contentType = c.req.header('Content-Type') || '';
    let backupData: string;
    let filename: string;
    
    if (contentType.includes('multipart/form-data')) {
      // Handle file upload
      const formData = await c.req.formData();
      const file = formData.get('backup') as File;
      
      if (!file) {
        return c.json({ error: { code: 'BAD_REQUEST', message: 'No backup file provided' } }, 400);
      }
      
      backupData = await file.text();
      filename = file.name || `backup-${Date.now()}.sql`;
    } else {
      // Handle raw body
      backupData = await c.req.text();
      filename = c.req.header('X-Backup-Filename') || `backup-${Date.now()}.sql`;
    }
    
    if (!backupData || backupData.length === 0) {
      return c.json({ error: { code: 'BAD_REQUEST', message: 'Empty backup data' } }, 400);
    }
    
    // Generate unique filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const finalFilename = `${timestamp}_${filename}`;
    const filePath = join(BACKUP_DIR, finalFilename);
    
    // Save backup file
    await writeFile(filePath, backupData);
    
    // Record upload time (unless bypassing)
    if (!bypassRateLimit) {
      await recordUpload();
    }
    
    const stats = await stat(filePath);
    
    console.log(`[BACKUP] Received backup: ${finalFilename} (${formatBytes(stats.size)})`);
    
    return c.json({
      success: true,
      message: 'Backup uploaded successfully',
      backup: {
        filename: finalFilename,
        size_bytes: stats.size,
        size_readable: formatBytes(stats.size),
        uploaded_at: new Date().toISOString()
      }
    });
  } catch (error: any) {
    console.error('[BACKUP] Upload error:', error);
    return c.json({ error: { code: 'INTERNAL_ERROR', message: error.message } }, 500);
  }
});

// Download a specific backup
app.get('/api/backup/download/:filename', async (c) => {
  const filename = c.req.param('filename');
  const filePath = join(BACKUP_DIR, filename);
  
  try {
    if (!existsSync(filePath)) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Backup not found' } }, 404);
    }
    
    const content = await readFile(filePath, 'utf-8');
    
    return new Response(content, {
      headers: {
        'Content-Type': 'application/sql',
        'Content-Disposition': `attachment; filename="${filename}"`
      }
    });
  } catch (error: any) {
    return c.json({ error: { code: 'INTERNAL_ERROR', message: error.message } }, 500);
  }
});

// Reset rate limit (for demo/testing)
app.post('/api/backup/reset-limit', async (c) => {
  try {
    if (existsSync(RATE_LIMIT_FILE)) {
      await Bun.write(RATE_LIMIT_FILE, '');
    }
    return c.json({ success: true, message: 'Rate limit reset' });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// Helper function
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

const port = parseInt(process.env.PORT || '3003');
console.log(`Mock Backup Service running on port ${port}`);
console.log(`Backup directory: ${BACKUP_DIR}`);
console.log(`Rate limit: 1 upload per 24 hours`);

export default {
  port,
  fetch: app.fetch
};
