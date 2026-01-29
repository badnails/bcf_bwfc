export function generateOrderId(): string {
  return `ORD-${crypto.randomUUID()}`;
}
