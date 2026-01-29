// Upload Logic - Send consolidated backup to mock service

import { config } from './config';
import { readFile, unlink } from 'fs/promises';
import { existsSync } from 'fs';

interface UploadResult {
  success: boolean;
  message: string;
  filename?: string;
  error?: string;
  rateLimited?: boolean;
}

// Upload backup to mock service
export async function uploadBackup(
  filepath: string,
  bypassRateLimit: boolean = false
): Promise<UploadResult> {
  console.log(`[UPLOAD] Uploading: ${filepath}`);
  
  if (!existsSync(filepath)) {
    return {
      success: false,
      message: 'Backup file not found',
      error: 'FILE_NOT_FOUND',
    };
  }
  
  try {
    const content = await readFile(filepath, 'utf-8');
    const filename = filepath.split('/').pop() || 'backup.sql';
    
    const headers: Record<string, string> = {
      'Content-Type': 'text/plain',
      'X-Backup-Filename': filename,
    };
    
    if (bypassRateLimit) {
      headers['X-Bypass-Rate-Limit'] = 'true';
    }
    
    const response = await fetch(`${config.mockBackupUrl}/api/backup/upload`, {
      method: 'POST',
      headers,
      body: content,
    });
    
    const data = await response.json();
    
    if (response.status === 429) {
      console.log('[UPLOAD] Rate limited - will retry tomorrow');
      return {
        success: false,
        message: data.error?.message || 'Rate limited',
        error: 'RATE_LIMITED',
        rateLimited: true,
      };
    }
    
    if (!response.ok) {
      return {
        success: false,
        message: data.error?.message || 'Upload failed',
        error: data.error?.code || 'UPLOAD_ERROR',
      };
    }
    
    console.log(`[UPLOAD] Success: ${data.backup?.filename}`);
    
    // Delete local consolidated file after successful upload
    await unlink(filepath);
    console.log(`[UPLOAD] Cleaned up local file: ${filename}`);
    
    return {
      success: true,
      message: 'Backup uploaded successfully',
      filename: data.backup?.filename,
    };
    
  } catch (e: any) {
    console.error('[UPLOAD] Error:', e.message);
    return {
      success: false,
      message: e.message,
      error: 'NETWORK_ERROR',
    };
  }
}

// Check if upload is allowed (query mock service)
export async function checkUploadStatus(): Promise<{
  allowed: boolean;
  lastUploadAt: string | null;
  nextAllowedAt: string | null;
}> {
  try {
    const response = await fetch(`${config.mockBackupUrl}/api/backup/status`);
    const data = await response.json();
    
    return {
      allowed: data.upload_allowed,
      lastUploadAt: data.last_upload_at,
      nextAllowedAt: data.next_allowed_at,
    };
  } catch (e: any) {
    console.error('[UPLOAD] Status check error:', e.message);
    return {
      allowed: false,
      lastUploadAt: null,
      nextAllowedAt: null,
    };
  }
}

// Get list of backups from mock service
export async function listRemoteBackups(): Promise<any[]> {
  try {
    const response = await fetch(`${config.mockBackupUrl}/api/backup/list`);
    const data = await response.json();
    
    return data.backups || [];
  } catch (e: any) {
    console.error('[UPLOAD] List error:', e.message);
    return [];
  }
}
