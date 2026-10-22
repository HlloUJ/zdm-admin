/** Prototype collision check. The backend must enforce uniqueness across all orders. */
export function generateOrderNumber(existing: Iterable<string> = []) {
  const used = new Set(existing);
  for (;;) {
    const timestamp = Math.floor(Date.now() / 1000);
    const random = String(crypto.getRandomValues(new Uint32Array(1))[0]! % 1000).padStart(3, '0');
    const number = `XS${timestamp}${random}`;
    if (!used.has(number)) return number;
  }
}
