import { computed, reactive, ref } from 'vue';
import { adminFeedback, getSafeErrorMessage } from '@/components/foundation';
import { productLogFilterOptions } from '@/services/productOperationLog';
import { getStoreFinishedLog, listStoreFinishedLogs, type StoreFinishedLog } from '@/services/storeFinishedStock';
import {
  isStoreStatusOperation,
  parseStoreOperationLogChanges,
  toStoreOperationLogRow as toLogRow,
} from './storeOperationLog';

/** State and requests for the store-owned operation log, independent of the public product log. */
export function useStoreFinishedLogs(stateLabel: (value?: string | null) => string) {
  const logsVisible = ref(false);
  const logs = ref<StoreFinishedLog[]>([]);
  const logTotal = ref(0);
  const logLoading = ref(false);
  const logDetail = ref<StoreFinishedLog | null>(null);
  const logDetailVisible = ref(false);
  const logDetailRow = computed(() => logDetail.value && toLogRow(logDetail.value));
  const logChanges = computed(() =>
    logDetail.value && isStoreStatusOperation(logDetail.value.operationType)
      ? {}
      : parseStoreOperationLogChanges(logDetail.value?.changeDetails, stateLabel),
  );
  const logSnapshot = computed(() =>
    Object.fromEntries(Object.entries(logChanges.value).map(([field, change]) => [field, change.after])),
  );
  const logMedia = computed(() => {
    const items = logChanges.value['媒体']?.after;
    return Array.isArray(items)
      ? (items as {
          field: string;
          mediaId: number;
          resource?: { available: boolean; url?: string; mediaType: string; message?: string };
        }[])
      : [];
  });
  const logAfterHtml = computed(() =>
    String(logChanges.value['宝贝详情']?.after || '').replace(
      /media:(\d+)/g,
      (_match, id) => logMedia.value.find((media) => media.mediaId === Number(id))?.resource?.url || '',
    ),
  );
  const logFilter = reactive({ keyword: '', operationType: '', operatorName: '', dateRange: [] as string[] });
  const appliedLogFilter = reactive({ keyword: '', operationType: '', operatorName: '', dateRange: [] as string[] });
  const logPagination = reactive({ current: 1, pageSize: 10 });
  const logTypeOptions = productLogFilterOptions('store');
  const logRows = computed(() => logs.value.map(toLogRow));

  async function openLogDetail(id: number) {
    try {
      logDetail.value = await getStoreFinishedLog(id);
      logDetailVisible.value = true;
    } catch (error) {
      adminFeedback.error(getSafeErrorMessage(error, '操作详情加载失败'));
    }
  }
  const updateLogFilter = (field: string, value: string | string[]) => Object.assign(logFilter, { [field]: value });
  function changeLogPage(page: { current: number; pageSize: number }) {
    Object.assign(logPagination, page);
    void loadLogs();
  }
  async function openLogs() {
    Object.assign(logFilter, { keyword: '', operationType: '', operatorName: '', dateRange: [] });
    Object.assign(appliedLogFilter, logFilter);
    logPagination.current = 1;
    logsVisible.value = true;
    await loadLogs();
  }
  async function loadLogs() {
    logLoading.value = true;
    try {
      const result = await listStoreFinishedLogs({
        keyword: appliedLogFilter.keyword,
        operationType: appliedLogFilter.operationType,
        operatorName: appliedLogFilter.operatorName,
        startDate: appliedLogFilter.dateRange[0] || '',
        endDate: appliedLogFilter.dateRange[1] || '',
        page: logPagination.current,
        pageSize: logPagination.pageSize,
      });
      logs.value = result.records;
      logTotal.value = result.total;
    } catch (error) {
      adminFeedback.error(getSafeErrorMessage(error, '操作日志加载失败'));
    } finally {
      logLoading.value = false;
    }
  }
  function searchLogs() {
    Object.assign(appliedLogFilter, logFilter, { dateRange: [...logFilter.dateRange] });
    logPagination.current = 1;
    void loadLogs();
  }
  function resetLogFilter() {
    Object.assign(logFilter, { keyword: '', operationType: '', operatorName: '', dateRange: [] });
    searchLogs();
  }
  return {
    logsVisible,
    logTotal,
    logLoading,
    logDetailVisible,
    logDetailRow,
    logChanges,
    logSnapshot,
    logMedia,
    logAfterHtml,
    logFilter,
    logPagination,
    logTypeOptions,
    logRows,
    openLogDetail,
    updateLogFilter,
    changeLogPage,
    openLogs,
    searchLogs,
    resetLogFilter,
  };
}
