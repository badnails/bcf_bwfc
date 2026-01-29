let gremlinEnabled = false;
let requestCounter = 0;

export function isGremlinEnabled(): boolean {
  return gremlinEnabled;
}

export function getRequestCounter(): number {
  return requestCounter;
}

export function enableGremlin(): void {
  gremlinEnabled = true;
  requestCounter = 0;
}

export function disableGremlin(): void {
  gremlinEnabled = false;
  requestCounter = 0;
}

export function shouldDelayRequest(): boolean {
  if (!gremlinEnabled) return false;
  
  requestCounter++;
  // Every 3rd request gets delayed
  return requestCounter % 3 === 0;
}

export function resetCounter(): void {
  requestCounter = 0;
}
