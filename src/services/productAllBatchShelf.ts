import { request } from './http';
import type { BatchShelfResult } from './operationsBatchShelf';
export type AllBatchShelfResource =
  'finished-products' | 'accessory-products' | 'slabs' | 'store-finished-products' | 'store-accessory-products';
export async function shelfProductsFromAll(
  resource: AllBatchShelfResource,
  ids: number[],
  displayIds?: Record<number, number>,
) {
  const result = await request<BatchShelfResult>(`/admin/${resource}/all-batch-shelf`, {
    method: 'POST',
    body: JSON.stringify({ ids }),
  });
  // Requests always use scoped record IDs. Keep the selected row's displayed product ID even if it was deleted during submission.
  return displayIds
    ? {
        ...result,
        failures: result.failures.map((failure) => ({ ...failure, id: displayIds[failure.id] ?? failure.id })),
      }
    : result;
}
