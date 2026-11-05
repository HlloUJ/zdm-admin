import { onMounted, onScopeDispose, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { adminFeedback, getSafeErrorMessage } from '@/components/foundation/feedback/adminFeedback';
import { ApiError, SessionExpiredError, getAuthToken, request } from '@/services/http';

export type OperationType = 'single' | 'batch-partial' | 'batch-atomic' | 'form';
export class OperationBlocked extends Error {}
export class OperationCheckHandled extends Error {}
export function blockOperation(message: string): never {
  throw new OperationBlocked(message);
}
export function operationMessage(message: string) {
  return message === '请选择门店分类' ? '请先选择门店分类后再上架' : message;
}
export function createOperationPreflight(context: () => string, feedback = adminFeedback) {
  let checking = false;
  let disposed = false;
  let generation = 0;
  const executing = ref(false);
  return {
    executing,
    async execute<T>(operation: () => T | Promise<T>): Promise<T | undefined> {
      if (disposed || executing.value) return undefined;
      executing.value = true;
      try {
        return await operation();
      } finally {
        executing.value = false;
      }
    },
    invalidate() {
      generation++;
    },
    dispose() {
      disposed = true;
    },
    async run(check: () => unknown | Promise<unknown>): Promise<boolean> {
      if (checking || disposed || executing.value) return false;
      checking = true;
      const identity = context();
      const revision = generation;
      try {
        await check();
        return !disposed && revision === generation && identity === context();
      } catch (error) {
        if (
          disposed ||
          revision !== generation ||
          identity !== context() ||
          error instanceof SessionExpiredError ||
          error instanceof OperationCheckHandled
        )
          return false;
        const message = operationMessage(getSafeErrorMessage(error, '操作条件检查失败，请稍后重试'));
        if (
          error instanceof OperationBlocked ||
          (error instanceof ApiError && error.status >= 400 && error.status < 500)
        )
          feedback.warning(message);
        else feedback.error(message);
        return false;
      } finally {
        checking = false;
      }
    },
  };
}
export function useOperationPreflight(extraContext: () => unknown = () => null) {
  const route = useRoute();
  const context = () => JSON.stringify([getAuthToken(), route.fullPath, extraContext()]);
  const preflight = createOperationPreflight(context);
  let stop: (() => void) | undefined;
  // Consumers may declare refs later in setup; begin reactive tracking after setup finishes.
  onMounted(() => {
    stop = watch(
      () => [route.fullPath, extraContext()],
      () => preflight.invalidate(),
      { flush: 'sync' },
    );
  });
  onScopeDispose(() => {
    stop?.();
    preflight.dispose();
  });
  return preflight;
}
export type PreflightResource =
  | 'supplier-supply-types'
  | 'product-categories'
  | 'suppliers'
  | 'slab-varieties'
  | 'slab-origins'
  | 'slab-colors/categories'
  | 'stores'
  | 'finished-markup-configurations'
  | 'accessory-markup-configurations'
  | 'store-finished-products'
  | 'store-accessory-products';
export function checkOperation(
  resource: PreflightResource,
  id: number,
  action: 'delete' | 'restore' | 'shelf' = 'delete',
) {
  return request<boolean>(`/admin/${resource}/${id}/${action}-check`);
}
