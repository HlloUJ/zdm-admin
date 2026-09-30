import { computed, type Ref } from 'vue';
import type { SlabMarkupConfigurationRecord } from '@/services/slabMarkupConfigurations';
import type { SlabOperationLogRecord, SlabStatus } from '@/services/slabs';
import type { OperationLogChangeRow, OperationLogMediaValue } from './slabPageModel';
import { buildSlabPriceTierComparison, formatSlabPriceTierChanges } from './operationLogPriceTiers';

export const useSlabOperationLogPresentation = (
  detail: Ref<SlabOperationLogRecord | null>,
  getConfigurations: () => SlabMarkupConfigurationRecord[],
  getStatusLabels: () => Record<string, string>,
) => {
  const formatPriceTierChanges = (value: unknown) => formatSlabPriceTierChanges(value, getConfigurations());
  const formatOperationValue = (value: unknown, field?: string): string => {
    if (value == null || value === '') return '未填写';
    if (field === '状态' || field === '来源状态') return getStatusLabels()[value as SlabStatus] || String(value);
    if (field === '价格层级') return formatPriceTierChanges(value) || '未填写';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  };
  const buildPriceTierComparison = (before: unknown, after: unknown) =>
    buildSlabPriceTierComparison(before, after, getConfigurations());
  const operationLogReferenceLabels: Record<string, string> = {
    供应商ID: '供应商',
    品种ID: '品种',
    产地ID: '产地',
    纹理ID: '纹理',
    色系ID: '色系',
    等级ID: '等级',
    商品视频: '视频',
  };
  const operationLogMediaTypes: Record<string, 'image' | 'video'> = {
    '1:1主图': 'image',
    扫描图: 'image',
    设计图: 'image',
    商品视频: 'video',
    视频封面: 'image',
  };
  const operationLogFieldOrder = [
    '1:1主图',
    '扫描图',
    '设计图',
    '商品视频',
    '大板名称',
    '品种ID',
    '产地ID',
    '纹理ID',
    '色系ID',
    '等级ID',
    '长度',
    '宽度',
    '高度',
    '面积',
    '误差',
    '扣角1长',
    '扣角1宽',
    '扣角2长',
    '扣角2宽',
    '扣角3长',
    '扣角3宽',
    '扣角4长',
    '扣角4宽',
    '成本价',
    '供应商ID',
    '供应商',
    '库存',
    '大板编号',
    '上架',
    '状态',
    '指导价系数',
    '指导价',
    '价格层级',
  ];
  const operationLogFieldOrderIndex = new Map(operationLogFieldOrder.map((field, index) => [field, index]));
  const normalizeOperationLogMedia = (value: unknown, field: string): OperationLogMediaValue | undefined => {
    if (value == null || value === '') return undefined;
    const fallbackType = operationLogMediaTypes[field];
    if (typeof value !== 'object') {
      return { available: false, mediaType: fallbackType, message: '媒体信息暂不可用' };
    }
    const media = value as Partial<OperationLogMediaValue>;
    return {
      available: Boolean(media.available && media.url),
      url: media.url,
      mediaType: media.mediaType === 'video' || media.mediaType === 'image' ? media.mediaType : fallbackType,
      mimeType: media.mimeType,
      originalName: media.originalName,
      previewOnly: media.previewOnly,
      message: media.message,
    };
  };
  const mediaAfterFallback = (media?: OperationLogMediaValue) =>
    media?.message || (media ? '历史媒体已不可用' : '未填写');
  const operationLogIsCreate = computed(() => {
    const log = detail.value;
    return log?.operationType === 'CREATE' || (log?.operationType === 'SOURCE_SHELF' && !log.beforeStatus);
  });
  const operationLogChangeRows = computed<OperationLogChangeRow[]>(() => {
    const details = detail.value?.changeDetails;
    if (!details) return [];
    try {
      const parsed = JSON.parse(details) as Record<
        string,
        {
          before?: unknown;
          after?: unknown;
        }
      >;
      const sourceValue = (value: unknown): 'auto' | 'manual' | undefined =>
        value === '跟随配置' || value === 'auto'
          ? 'auto'
          : value === '手工价格' || value === 'manual'
            ? 'manual'
            : undefined;
      const tierChange = parsed['价格层级'];
      const comparedTiers = buildPriceTierComparison(tierChange?.before, tierChange?.after);
      if (!operationLogIsCreate.value) {
        for (const [field, change] of Object.entries(parsed)) {
          if (!field.endsWith('价格来源')) continue;
          const label = field.slice(0, -4);
          let tier = comparedTiers.find((item) => item.label === label);
          if (!tier) {
            tier = {
              key: label,
              label,
              beforeCoefficient: '未填写',
              afterCoefficient: '未填写',
              beforePrice: '未填写',
              afterPrice: '未填写',
            };
            comparedTiers.push(tier);
          }
          tier.beforeSource = sourceValue(change.before);
          tier.afterSource = sourceValue(change.after);
        }
        if (!tierChange && comparedTiers.length) parsed['价格层级'] = {};
      }
      return Object.entries(parsed)
        .filter(([field]) => operationLogIsCreate.value || (field !== '视频封面' && !field.endsWith('价格来源')))
        .sort(
          ([leftField], [rightField]) =>
            (operationLogFieldOrderIndex.get(leftField) ?? Number.MAX_SAFE_INTEGER) -
            (operationLogFieldOrderIndex.get(rightField) ?? Number.MAX_SAFE_INTEGER),
        )
        .map(([field, change]) => {
          const allPriceTiers = field === '价格层级' ? comparedTiers : undefined;
          const priceTiers = operationLogIsCreate.value
            ? allPriceTiers
            : allPriceTiers?.filter(
                (tier) =>
                  tier.beforePrice !== tier.afterPrice ||
                  tier.beforeCoefficient !== tier.afterCoefficient ||
                  tier.beforeSource !== tier.afterSource,
              );
          const mediaType = operationLogMediaTypes[field];
          return {
            field: operationLogReferenceLabels[field] || field,
            before: formatOperationValue(change.before, field),
            after: formatOperationValue(change.after, field),
            priceTiers,
            mediaType,
            beforeMedia: mediaType ? normalizeOperationLogMedia(change.before, field) : undefined,
            afterMedia: mediaType ? normalizeOperationLogMedia(change.after, field) : undefined,
          };
        })
        .filter((row) => operationLogIsCreate.value || row.priceTiers === undefined || row.priceTiers.length > 0);
    } catch {
      return [];
    }
  });
  const creationLogImages = computed(() => operationLogChangeRows.value.filter((row) => row.mediaType));
  const creationLogSalesFields = new Set(['库存', '供应商', '大板编号', '仓库', '发布类型', '状态']);
  const creationLogMetadataFields = new Set(['来源状态', '大板ID', '创建人', '创建账号ID', '创建时间']);
  const creationLogPriceFields = new Set(['成本价', '指导价', '指导价系数', '价格层级']);
  const creationLogBaseFieldOrder = [
    '品种',
    '产地',
    '纹理',
    '色系',
    '等级',
    '长度',
    '宽度',
    '高度',
    '面积',
    '误差',
    '扣角1长',
    '扣角1宽',
    '扣角2长',
    '扣角2宽',
    '扣角3长',
    '扣角3宽',
    '扣角4长',
    '扣角4宽',
  ];
  const creationLogBase = computed(() =>
    operationLogChangeRows.value
      .filter(
        (row) =>
          row.field !== '大板名称' &&
          !row.mediaType &&
          !creationLogSalesFields.has(row.field) &&
          !creationLogMetadataFields.has(row.field) &&
          !creationLogPriceFields.has(row.field) &&
          !row.field.endsWith('价格来源') &&
          !row.field.endsWith('来源配置ID'),
      )
      .sort((a, b) => {
        const rank = (field: string) => {
          const index = creationLogBaseFieldOrder.indexOf(field);
          return index < 0 ? creationLogBaseFieldOrder.length : index;
        };
        return rank(a.field) - rank(b.field);
      })
      .map((row) => ({
        ...row,
        field:
          row.field === '面积'
            ? '面积（㎡）'
            : ['长度', '宽度', '高度', '误差'].includes(row.field) || /^扣角[1-4][长宽]$/.test(row.field)
              ? `${row.field === '误差' ? '±误差' : row.field}（mm）`
              : row.field,
      })),
  );
  const creationLogSales = computed(() => {
    const rows = operationLogChangeRows.value;
    const value = (field: string) => rows.find((row) => row.field === field)?.after ?? '未填写';
    return [
      { field: '成本价', after: value('成本价') },
      { field: '供应商', after: value('供应商') },
      { field: '库存', after: value('库存') },
      { field: '大板编号', after: value('大板编号') },
      {
        field: '上架',
        after:
          detail.value?.afterStatus === 'selling'
            ? '立刻上架'
            : detail.value?.afterStatus === 'warehouse'
              ? '暂不上架'
              : value('状态'),
      },
    ];
  });
  return {
    mediaAfterFallback,
    operationLogIsCreate,
    operationLogChangeRows,
    creationLogImages,
    creationLogBase,
    creationLogSales,
  };
};
