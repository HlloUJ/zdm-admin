/** Keep existing state-specific tests in their original warehouse context after adding the default All view. */
const productPaths = new Set([
  '/finished-stock-management',
  '/accessory-management',
  '/slab-management',
  '/supply-chain/finished-stock-management',
  '/supply-chain/accessory-management',
  '/supply-chain/slab-management',
  '/store/finished-stock-management',
  '/store/accessory-management',
]);
export function productWarehouseUrl(url: string): string {
  const [path] = url.split('?');
  return productPaths.has(path) && !/[?&]tab=/.test(url) ? `${url}${url.includes('?') ? '&' : '?'}tab=warehouse` : url;
}
