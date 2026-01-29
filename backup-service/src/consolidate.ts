// Consolidation Logic - Merge incremental dumps into single archive

import { config } from './config';
import { readFile, writeFile, unlink, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { performFullDump } from './dump';

// Consolidate all pending dumps into a single file
export async function consolidateDumps(): Promise<string | null> {
  console.log('[CONSOLIDATE] Starting consolidation...');
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const consolidatedFilename = `consolidated_backup_${timestamp}.sql`;
  const consolidatedPath = join(config.dumpsDir, consolidatedFilename);
  
  try {
    // For reliability, do a fresh full dump instead of merging incrementals
    // This ensures consistency and proper ordering
    const { orderDump, inventoryDump } = await performFullDump();
    
    // Read both full dumps
    const orderContent = await readFile(orderDump, 'utf-8');
    const inventoryContent = await readFile(inventoryDump, 'utf-8');
    
    // Combine into single file
    const consolidatedContent = `-- =============================================================================
-- CONSOLIDATED DAILY BACKUP
-- Generated: ${new Date().toISOString()}
-- =============================================================================

-- =============================================================================
-- ORDER SERVICE DATABASE
-- =============================================================================

${orderContent}

-- =============================================================================
-- INVENTORY SERVICE DATABASE  
-- =============================================================================

${inventoryContent}
`;
    
    await writeFile(consolidatedPath, consolidatedContent);
    
    // Clean up the temporary full dump files
    await unlink(orderDump);
    await unlink(inventoryDump);
    
    // Clean up all incremental dumps
    await cleanupIncrementalDumps();
    
    console.log(`[CONSOLIDATE] Created: ${consolidatedFilename}`);
    
    return consolidatedPath;
    
  } catch (e: any) {
    console.error('[CONSOLIDATE] Error:', e.message);
    return null;
  }
}

// Clean up incremental dump files after consolidation
async function cleanupIncrementalDumps(): Promise<void> {
  try {
    const files = await readdir(config.dumpsDir);
    
    for (const file of files) {
      // Only delete incremental dumps, keep consolidated files
      if (file.includes('_incremental_') && file.endsWith('.sql')) {
        const filepath = join(config.dumpsDir, file);
        await unlink(filepath);
        console.log(`[CLEANUP] Deleted: ${file}`);
      }
    }
  } catch (e: any) {
    console.error('[CLEANUP] Error:', e.message);
  }
}

// Get consolidation status
export async function getConsolidationStatus(): Promise<{
  pendingIncrementals: number;
  lastConsolidatedFiles: string[];
}> {
  try {
    const files = await readdir(config.dumpsDir);
    
    const incrementals = files.filter(f => f.includes('_incremental_') && f.endsWith('.sql'));
    const consolidated = files
      .filter(f => f.startsWith('consolidated_') && f.endsWith('.sql'))
      .sort()
      .reverse()
      .slice(0, 5); // Last 5 consolidated files
    
    return {
      pendingIncrementals: incrementals.length,
      lastConsolidatedFiles: consolidated,
    };
  } catch {
    return {
      pendingIncrementals: 0,
      lastConsolidatedFiles: [],
    };
  }
}
