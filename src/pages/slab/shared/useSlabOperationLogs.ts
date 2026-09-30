import { reactive, ref } from 'vue';
import { adminFeedback } from '@/components/foundation';
import { listSlabOperationLogs, type SlabOperationLogRecord } from '@/services/slabs';
import type { OperationLogFilterState } from './slabPageModel';

/** List and detail state shared by the two slab clients; presentation stays with each client. */
export function useSlabOperationLogs() {
  const operationLogDrawerVisible = ref(false);
  const operationLogLoading = ref(false);
  const operationLogs = ref<SlabOperationLogRecord[]>([]);
  const operationLogTotal = ref(0);
  const operationLogDetailVisible = ref(false);
  const operationLogDetail = ref<SlabOperationLogRecord | null>(null);
  const makeOperationLogFilter = (): OperationLogFilterState => ({
    keyword: '',
    operationType: '',
    operatorName: '',
    dateRange: [],
  });
  const operationLogFilter = reactive(makeOperationLogFilter());
  const appliedOperationLogFilter = reactive(makeOperationLogFilter());
  const operationLogPagination = reactive({ current: 1, pageSize: 10 });
  const updateOperationLogFilter = (field: string, value: string | string[]) =>
    Object.assign(operationLogFilter, { [field]: value });
  const changeOperationLogPage = (page: { current: number; pageSize: number }) => {
    Object.assign(operationLogPagination, page);
    void loadOperationLogs();
  };
  const loadOperationLogs = async () => {
    operationLogLoading.value = true;
    try {
      const [startDate, endDate] = appliedOperationLogFilter.dateRange;
      const result = await listSlabOperationLogs({
        keyword: appliedOperationLogFilter.keyword.trim(),
        operationType: appliedOperationLogFilter.operationType,
        operatorName: appliedOperationLogFilter.operatorName.trim(),
        startDate,
        endDate,
        page: operationLogPagination.current,
        pageSize: operationLogPagination.pageSize,
      });
      operationLogs.value = result.records;
      operationLogTotal.value = result.total;
    } catch (error) {
      adminFeedback.actionError({ action: '加载操作日志', error, fallback: '请稍后重试' });
    } finally {
      operationLogLoading.value = false;
    }
  };
  const openOperationLogDrawer = async () => {
    operationLogDrawerVisible.value = true;
    operationLogPagination.current = 1;
    await loadOperationLogs();
  };
  const handleOperationLogSearch = async () => {
    Object.assign(appliedOperationLogFilter, operationLogFilter, { dateRange: [...operationLogFilter.dateRange] });
    operationLogPagination.current = 1;
    await loadOperationLogs();
  };
  const handleOperationLogReset = async () => {
    Object.assign(operationLogFilter, makeOperationLogFilter());
    await handleOperationLogSearch();
  };
  const openOperationLogDetailById = (id: number) => {
    operationLogDetail.value = operationLogs.value.find((record) => record.id === id) || null;
    operationLogDetailVisible.value = Boolean(operationLogDetail.value);
  };
  return {
    operationLogDrawerVisible,
    operationLogLoading,
    operationLogs,
    operationLogTotal,
    operationLogDetailVisible,
    operationLogDetail,
    operationLogFilter,
    operationLogPagination,
    updateOperationLogFilter,
    changeOperationLogPage,
    openOperationLogDrawer,
    handleOperationLogSearch,
    handleOperationLogReset,
    openOperationLogDetailById,
  };
}
