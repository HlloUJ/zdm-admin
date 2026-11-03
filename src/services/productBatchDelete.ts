import { request } from './http';
import type { AllBatchShelfResource } from './productAllBatchShelf';
import type { BatchShelfResult } from './operationsBatchShelf';
export async function deleteProductsBatch(
  resource: AllBatchShelfResource,
  ids: number[],
  displayIds?: Record<number, number>,
): Promise<BatchShelfResult> {
  const result = await request<BatchShelfResult>(`/admin/${resource}/batch-delete`, {
    method: 'POST',
    body: JSON.stringify({ ids }),
  });
  return displayIds
    ? {
        ...result,
        failures: result.failures.map((failure) => ({ ...failure, id: displayIds[failure.id] ?? failure.id })),
      }
    : result;
}
