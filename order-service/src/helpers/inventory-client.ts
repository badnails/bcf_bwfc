import { config } from '../config';

interface InventoryDeductRequest {
  order_id: string;
  product_id: string;
  quantity: number;
}

interface InventoryDeductResponse {
  order_id: string;
  product_id: string;
  quantity_deducted: number;
  new_stock_level: number;
  timestamp: string;
}

interface InventoryResult {
  success: boolean;
  data?: InventoryDeductResponse;
  error?: string | any;
}

export async function callInventoryDeduct(
  orderId: string,
  productId: string,
  quantity: number,
  headers: Record<string, string>
): Promise<InventoryResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.inventory.timeoutMs);

  try {
    const response = await fetch(`${config.inventory.serviceUrl}/internal/inventory/deduct`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Request-ID': headers['x-request-id'] || crypto.randomUUID(),
        'X-Correlation-ID': headers['x-correlation-id'] || crypto.randomUUID(),
      },
      body: JSON.stringify({ order_id: orderId, product_id: productId, quantity }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const error = await response.json();
      return { success: false, error: error.error || error };
    }

    return { success: true, data: await response.json() };
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      return { success: false, error: 'INVENTORY_SERVICE_TIMEOUT' };
    }
    return { success: false, error: error.message };
  }
}

export async function verifyInventoryDeduction(
  orderId: string,
  productId: string,
  quantity: number
): Promise<InventoryResult> {
  try {
    // Call the idempotent deduct endpoint - it will return existing operation if already processed
    const response = await fetch(`${config.inventory.serviceUrl}/internal/inventory/deduct`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Request-ID': crypto.randomUUID(),
        'X-Correlation-ID': crypto.randomUUID(),
      },
      body: JSON.stringify({ order_id: orderId, product_id: productId, quantity }),
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      const error = await response.json();
      return { success: false, error: error.error || error };
    }

    return { success: true, data: await response.json() };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function checkInventoryHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${config.inventory.serviceUrl}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
