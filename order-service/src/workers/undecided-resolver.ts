import { sql } from '../db';
import { verifyInventoryDeduction } from '../helpers/inventory-client';
import { consumeRetryEvents, publishRetryEvent } from '../helpers/retry-events';
import { publishOrderStatusChange } from '../helpers/order-status-events';
import { config } from '../config';

let isRunning = false;

export async function startUndecidedOrderWorker(): Promise<void> {
  if (isRunning) {
    console.warn('Undecided order worker is already running');
    return;
  }

  isRunning = true;
  console.log('🔄 Starting undecided order worker...');

  // Main worker loop
  while (isRunning) {
    try {
      await processRetryEvents();
      
      // Poll every 2 seconds
      await sleep(2000);
    } catch (error) {
      console.error('Error in worker loop:', error);
      // Continue running even if there's an error
      await sleep(5000); // Wait longer on error
    }
  }
}

export function stopUndecidedOrderWorker(): void {
  console.log('🛑 Stopping undecided order worker...');
  isRunning = false;
}

async function processRetryEvents(): Promise<void> {
  const events = await consumeRetryEvents();

  if (events.length === 0) {
    return;
  }

  console.log(`📦 Processing ${events.length} retry event(s)...`);

  // Process events in parallel
  await Promise.all(events.map(processRetryEvent));
}

async function processRetryEvent(event: any): Promise<void> {
  const { order_id, product_id, quantity, attempt, max_attempts } = event;

  try {
    console.log(`🔍 Verifying order ${order_id}, attempt ${attempt + 1}/${max_attempts}`);

    // Verify with inventory service
    const result = await verifyInventoryDeduction(order_id, product_id, quantity);

    if (result.success) {
      // Inventory was deducted - update order to confirmed
      await sql`
        UPDATE orders
        SET status = 'confirmed', error_message = NULL, updated_at = NOW()
        WHERE order_id = ${order_id} AND status = 'undecided'
      `;

      console.log(`✅ Order ${order_id} confirmed (inventory was deducted)`);
      
      // Publish status change event for SSE clients
      await publishOrderStatusChange(order_id, 'confirmed');
    } else {
      // Check if it's a transient error (timeout, network issue) or permanent failure
      const errorMessage = typeof result.error === 'string'
        ? result.error
        : result.error?.message || 'Unknown error';

      const isTransientError = errorMessage.includes('timeout') || 
                                errorMessage.includes('network') ||
                                errorMessage.includes('ECONNREFUSED');

      if (isTransientError && attempt < max_attempts - 1) {
        // Retry again with exponential backoff
        console.log(`⏳ Transient error for order ${order_id}: ${errorMessage}. Retrying...`);
        
        await publishRetryEvent({
          order_id,
          product_id,
          quantity,
          attempt: attempt + 1,
          max_attempts,
        });
      } else {
        // Permanent failure or max attempts reached
        await sql`
          UPDATE orders
          SET status = 'failed', error_message = ${errorMessage}, updated_at = NOW()
          WHERE order_id = ${order_id} AND status = 'undecided'
        `;

        // Publish status change event for SSE clients
        await publishOrderStatusChange(order_id, 'failed', errorMessage);

        if (attempt >= max_attempts - 1) {
          console.log(`❌ Order ${order_id} failed after ${max_attempts} attempts: ${errorMessage}`);
        } else {
          console.log(`❌ Order ${order_id} failed (permanent): ${errorMessage}`);
        }
      }
    }
  } catch (error: any) {
    console.error(`Error processing retry event for order ${order_id}:`, error);
    
    // If we hit an error processing the event, retry if we haven't exceeded max attempts
    if (attempt < max_attempts - 1) {
      await publishRetryEvent({
        order_id,
        product_id,
        quantity,
        attempt: attempt + 1,
        max_attempts,
      });
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
