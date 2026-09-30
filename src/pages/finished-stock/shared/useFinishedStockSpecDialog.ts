import { computed, ref, type Ref } from 'vue';
import { adminFeedback } from '@/components/foundation';
import type { FinishedSpecDimension } from '@/services/finishedProducts';
import { materializeLayeredSpec, rebuildLayeredSpecs, specIdentity } from '../management/specModeConversion';
import { orderLayeredRows } from '../management/layeredSpecs';
import type {
  LayeredSpecField,
  PriceRow,
  SingleSpecItem,
  SpecGroup,
  SpecMode,
  SpecRow,
  SpecValue,
  LayeredSpecDraft,
} from './finishedStockPageModel';
import type { buildFinishedStockTemplateFields } from './finishedStockTemplateFields';

type SalesField = ReturnType<typeof buildFinishedStockTemplateFields>[number];
interface SpecDialogContext {
  validatedSpecDraftIds: Ref<Set<number>>;
  specRows: Ref<SpecRow[]>;
  specMode: Ref<SpecMode>;
  singleSpecs: Ref<SingleSpecItem[]>;
  specGroups: SpecGroup[];
  specDialogVisible: Ref<boolean>;
  confirmedSpecMode: Ref<SpecMode>;
  confirmedLayeredFields: Ref<LayeredSpecField[]>;
  confirmedSpecDimensions: Ref<FinishedSpecDimension[]>;
  confirmedImageField: Ref<LayeredSpecField | null>;
  priceRows: Ref<PriceRow[]>;
  salesAttributeFields: Readonly<Ref<SalesField[]>>;
  refreshPriceConfigurations: () => Promise<void>;
  createSingleSpecItem: (text?: string, imageUploaded?: boolean) => SingleSpecItem;
  createSpecValue: (value?: string, imageUploaded?: boolean) => SpecValue;
  createBaseSpecRow: (partial: Partial<SpecRow>) => SpecRow;
  salesAttributeByKey: (key: LayeredSpecField) => SalesField | undefined;
}

/** Shared specification draft lifecycle for admin and supply-chain product editors. */
export function useFinishedStockSpecDialog({
  validatedSpecDraftIds,
  specRows,
  specMode,
  singleSpecs,
  specGroups,
  specDialogVisible,
  confirmedSpecMode,
  confirmedLayeredFields,
  confirmedSpecDimensions,
  confirmedImageField,
  priceRows,
  salesAttributeFields,
  refreshPriceConfigurations,
  createSingleSpecItem,
  createSpecValue,
  createBaseSpecRow,
  salesAttributeByKey,
}: SpecDialogContext) {
  const openSpecDialog = async (preserveCurrent = false) => {
    validatedSpecDraftIds.value = new Set();
    try {
      await refreshPriceConfigurations();
    } catch {
      adminFeedback.error('价格配置加载失败，请重试');
      return;
    }
    clearSpecDraft();
    if (preserveCurrent && specRows.value.length) hydrateSpecDialogFromRows();
    if (specMode.value === 'single') {
      singleSpecs.value.forEach((item, index) => {
        item.sourceRow = cloneSpecDraft(specRows.value[index]);
      });
    } else {
      useLinkedLayeredDrafts.value = true;
      layeredSpecDrafts.value = specRows.value.map((row) => createLinkedSpecDraft(row));
      linkedSpecStructure.value = currentSpecStructure();
    }
    specOpeningDraft = captureSpecDraft();
    specDialogVisible.value = true;
  };
  const closeSpecDialog = () => {
    specModeConfirmVisible.value = false;
    specDialogVisible.value = false;
  };
  const layeredSpecDrafts = ref<LayeredSpecDraft[]>([]);
  const useLinkedLayeredDrafts = ref(false);
  const linkedSpecStructure = ref('');
  const currentSpecStructure = () =>
    JSON.stringify(
      specGroups
        .filter((group) => group.selected)
        .map((group) => [group.field, group.values.map((value) => value.id).sort((a, b) => a - b)])
        .sort(([left], [right]) => String(left).localeCompare(String(right))),
    );
  const specDraftError = ref('');
  const cloneSpecDraft = <T>(value: T): T => (value == null ? value : JSON.parse(JSON.stringify(value)));
  const captureSpecDraft = () =>
    cloneSpecDraft({
      mode: specMode.value,
      singles: singleSpecs.value,
      groups: specGroups,
      layered: layeredSpecDrafts.value,
      useLinkedRows: useLinkedLayeredDrafts.value,
      linkedStructure: linkedSpecStructure.value,
    });
  let specOpeningDraft: ReturnType<typeof captureSpecDraft> | undefined;
  const createLinkedSpecDraft = (source: SpecRow): LayeredSpecDraft => {
    const row = cloneSpecDraft(source);
    const valueIds: LayeredSpecDraft['valueIds'] = {};
    specGroups.forEach((group) => {
      const value = String(row[group.field] ?? '');
      const match =
        group.values.find((item) => item.id === row._specValueIds?.[group.field]) ||
        (value.trim()
          ? group.values.find((item) => normalizeLayeredValue(group.field, item.value) === value)
          : undefined);
      if (match) valueIds[group.field] = match.id;
    });
    return {
      id: row.id,
      sourceRow: row,
      valueIds,
    };
  };
  const specModeConfirmVisible = ref(false);
  const pendingSpecMode = ref<SpecMode>('single');
  const specModeConfirmMessage =
    '您正在从【单层展示】切换至【分层展示】。本次切换将清空已填写的规格数据，请按分层结构重新配置。点击下方「重置」可恢复本次打开时的配置。';
  const requestSpecModeChange = (value: unknown) => {
    if ((value !== 'single' && value !== 'layered') || value === specMode.value) return;
    if (value === 'layered' && singleSpecs.value.some((item) => item.text.trim())) {
      pendingSpecMode.value = value;
      specModeConfirmVisible.value = true;
      return;
    }
    handleSpecModeChange(value);
  };
  const confirmSpecModeChange = () => {
    specModeConfirmVisible.value = false;
    if (specDialogVisible.value) handleSpecModeChange(pendingSpecMode.value);
  };
  const handleSpecModeChange = (value: SpecMode) => {
    if (value === specMode.value) return;
    clearSpecDraft(false);
    specMode.value = value;
  };
  const materializeSpecDraft = (draft: LayeredSpecDraft): SpecRow =>
    materializeLayeredSpec(draft.sourceRow, draft.valueIds, selectedSpecGroups.value);
  const clearSpecDraft = (resetMode = true) => {
    validatedSpecDraftIds.value = new Set();
    specDraftError.value = '';
    layeredSpecDrafts.value = [];
    useLinkedLayeredDrafts.value = false;
    linkedSpecStructure.value = '';
    if (resetMode) {
      specMode.value = 'single';
    }
    singleSpecs.value = [createSingleSpecItem()];
    specGroups.forEach((group) => {
      group.selected = false;
      group.withImage = false;
      group.values = [createSpecValue()];
    });
  };
  const draggedSpecValue = ref<{
    field: LayeredSpecField;
    id: number;
  } | null>(null);
  const startSpecValueDrag = (event: DragEvent, field: LayeredSpecField, id: number) => {
    draggedSpecField.value = null;
    draggedSpecValue.value = { field, id };
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', String(id));
    }
  };
  const dropSpecValue = (event: DragEvent, group: SpecGroup, targetId: number) => {
    const source = draggedSpecValue.value;
    if (!source) return;
    event.stopPropagation();
    draggedSpecValue.value = null;
    if (source.field !== group.field) return;
    const sourceIndex = group.values.findIndex((value) => value.id === source.id);
    const targetIndex = group.values.findIndex((value) => value.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return;
    const [value] = group.values.splice(sourceIndex, 1);
    group.values.splice(targetIndex, 0, value);
  };
  const draggedSpecField = ref<LayeredSpecField | null>(null);
  const startSpecGroupDrag = (event: DragEvent, field: LayeredSpecField) => {
    draggedSpecValue.value = null;
    draggedSpecField.value = field;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', field);
    }
  };
  const dropSpecGroup = (targetField: LayeredSpecField) => {
    const sourceIndex = specGroups.findIndex((group) => group.field === draggedSpecField.value);
    const targetIndex = specGroups.findIndex((group) => group.field === targetField);
    draggedSpecField.value = null;
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return;
    const [group] = specGroups.splice(sourceIndex, 1);
    specGroups.splice(targetIndex, 0, group);
  };
  const selectedSpecGroups = computed(() => specGroups.filter((group) => group.selected));
  const selectedImageGroup = computed(() => selectedSpecGroups.value.find((group) => group.withImage));
  const addSingleSpec = () => {
    singleSpecs.value.push(createSingleSpecItem());
  };
  const removeSingleSpec = (index: number) => {
    if (singleSpecs.value.length <= 1) {
      adminFeedback.warning('至少需要输入一个商品规格');
      return;
    }
    singleSpecs.value.splice(index, 1);
  };
  const isDuplicateSingleSpec = (current: SingleSpecItem) => {
    const text = current.text.trim();
    return text !== '' && singleSpecs.value.some((item) => item.id !== current.id && item.text.trim() === text);
  };
  const isDuplicateSpecValue = (group: SpecGroup, current: SpecValue) => {
    if (salesAttributeByKey(group.field)?.type === 'select') return false;
    const value = (current.value ?? '').trim();
    return value !== '' && group.values.some((item) => item.id !== current.id && (item.value ?? '').trim() === value);
  };
  const isSpecOptionSelected = (group: SpecGroup, currentId: number, option: string) =>
    group.values.some((value) => value.id !== currentId && value.value === option);
  const canAddSpecValue = (group: SpecGroup) => {
    const field = salesAttributeByKey(group.field);
    return field?.type !== 'select' || group.values.length < (field.options?.length ?? 0);
  };
  const addSpecValue = (name: string) => {
    const group = specGroups.find((item) => item.name === name);
    if (!group || !canAddSpecValue(group)) return;
    group.values.push(createSpecValue());
  };
  const removeSpecValue = (name: string, index: number) => {
    const group = specGroups.find((item) => item.name === name);
    if (!group) return;
    if (group.values.length <= 1) {
      adminFeedback.warning('至少需要输入一个属性值');
      return;
    }
    const [removed] = group.values.splice(index, 1);
    layeredSpecDrafts.value.forEach((draft) => {
      if (draft.valueIds[group.field] === removed?.id) delete draft.valueIds[group.field];
    });
  };
  const MAX_SPEC_GROUPS = 3;
  const isSpecGroupDisabled = (group: SpecGroup) =>
    !group.selected && selectedSpecGroups.value.length >= MAX_SPEC_GROUPS;
  const toggleSpecGroup = (group: SpecGroup) => {
    if (isSpecGroupDisabled(group)) return;
    group.selected = !group.selected;
    if (!group.selected) {
      group.withImage = false;
      group.values = [createSpecValue()];
      layeredSpecDrafts.value.forEach((draft) => {
        delete draft.valueIds[group.field];
        draft.sourceRow[group.field] = '';
        draft.sourceRow[`${group.field}Image`] = false;
        if (draft.sourceRow._specValueIds) delete draft.sourceRow._specValueIds[group.field];
      });
      return;
    }
  };
  const resetSpecDialog = () => {
    if (!specOpeningDraft) {
      clearSpecDraft();
      return;
    }
    const saved = cloneSpecDraft(specOpeningDraft);
    specMode.value = saved.mode;
    singleSpecs.value = saved.singles;
    specGroups.splice(0, specGroups.length, ...saved.groups);
    validatedSpecDraftIds.value = new Set();
    layeredSpecDrafts.value = saved.layered;
    useLinkedLayeredDrafts.value = saved.useLinkedRows;
    linkedSpecStructure.value = saved.linkedStructure;
    specDraftError.value = '';
  };
  const hydrateSpecDialogFromRows = () => {
    specMode.value = confirmedSpecMode.value;
    if (confirmedSpecMode.value === 'single') {
      singleSpecs.value = specRows.value.map((row) => createSingleSpecItem(row.specText, row.specImage));
      if (!singleSpecs.value.length) singleSpecs.value = [createSingleSpecItem()];
      return;
    }
    const dimensionOrder = confirmedLayeredFields.value;
    specGroups.sort((a, b) => {
      const rank = (key: LayeredSpecField) =>
        dimensionOrder.includes(key) ? dimensionOrder.indexOf(key) : dimensionOrder.length;
      return rank(a.field) - rank(b.field);
    });
    let hasHydratedImageGroup = false;
    specGroups.forEach((group) => {
      const imageKey = `${group.field}Image` as 'materialImage' | 'lengthImage' | 'colorImage' | 'sizeImage';
      group.selected = confirmedLayeredFields.value.includes(group.field);
      const rowHasImage = specRows.value.some((row) => Boolean(row[imageKey]));
      group.withImage = rowHasImage && !hasHydratedImageGroup;
      if (group.withImage) hasHydratedImageGroup = true;
      group.values = Array.from(
        new Map(specRows.value.map((row) => [row[group.field], Boolean(row[imageKey])])).entries(),
      )
        .filter(([value]) => value)
        .map(([value, imageUploaded]) =>
          createSpecValue(group.field === 'length' ? value.replace('mm', '') : value, group.withImage && imageUploaded),
        );
      const dimension = confirmedSpecDimensions.value.find((item) => item.key === group.field);
      if (dimension) group.values.sort((a, b) => dimension.values.indexOf(a.value) - dimension.values.indexOf(b.value));
      if (!group.values.length) group.values = [createSpecValue()];
    });
  };
  const confirmCreateSpec = () => {
    specDraftError.value = '';
    validatedSpecDraftIds.value = new Set(
      specMode.value === 'single'
        ? singleSpecs.value.map((item) => item.id)
        : selectedSpecGroups.value.flatMap((group) => group.values.map((item) => item.id)),
    );
    if (specMode.value === 'layered' && selectedSpecGroups.value.length > MAX_SPEC_GROUPS) {
      specDraftError.value = '最多选择 3 个销售属性';
      return;
    }
    if (specMode.value === 'layered' && !selectedSpecGroups.value.length) {
      specDraftError.value = '请选择销售属性并填写规格属性值';
      return;
    }
    const hasEmptyValue =
      specMode.value === 'single'
        ? singleSpecs.value.some((item) => !item.text.trim())
        : selectedSpecGroups.value.some((group) => group.values.some((item) => !(item.value ?? '').trim()));
    if (hasEmptyValue) {
      specDraftError.value =
        specMode.value === 'single' ? '商品规格不能为空，请填写后再确认创建' : '请填写所有规格属性值后再确认创建';
      return;
    }
    if (specMode.value === 'single' && singleSpecs.value.some(isDuplicateSingleSpec)) {
      specDraftError.value = '商品规格名称不能重复，请修改后再确认创建';
      return;
    }
    if (
      specMode.value === 'layered' &&
      selectedSpecGroups.value.some((group) => group.values.some((value) => isDuplicateSpecValue(group, value)))
    ) {
      specDraftError.value = '同一属性的值不能重复，请修改后再确认创建';
      return;
    }
    const rows =
      specMode.value === 'single'
        ? singleSpecs.value.map((item) =>
            createBaseSpecRow({
              ...cloneSpecDraft(item.sourceRow || {}),
              mode: 'single',
              specText: item.text.trim(),
              specImage: item.imageUploaded,
            }),
          )
        : buildLayeredSpecRows();
    if (!rows.length) {
      specDraftError.value = '请至少配置一条商品规格';
      return;
    }
    const fields = selectedSpecGroups.value.map((group) => group.field);
    if (specMode.value === 'layered' && rows.some((row) => fields.some((field) => !String(row[field] || '').trim()))) {
      specDraftError.value = '请补充每条规格的属性值后再确认创建';
      return;
    }
    if (specMode.value === 'layered' && new Set(rows.map((row) => specIdentity(row, fields))).size !== rows.length) {
      specDraftError.value = '规格组合不能重复，请修改后再确认创建';
      return;
    }
    confirmedSpecDimensions.value =
      specMode.value === 'layered'
        ? selectedSpecGroups.value.map((group) => ({
            key: group.field,
            name: group.name,
            values: group.values.map((item) => normalizeLayeredValue(group.field, item.value)),
          }))
        : [];
    confirmedSpecMode.value = specMode.value;
    confirmedLayeredFields.value = specMode.value === 'layered' ? fields : [];
    confirmedImageField.value = specMode.value === 'layered' ? selectedImageGroup.value?.field || null : null;
    specRows.value = specMode.value === 'layered' ? orderLayeredRows(rows, confirmedSpecDimensions.value) : rows;
    priceRows.value = specRows.value.map(specToPriceRow);
    closeSpecDialog();
    adminFeedback.success('规格表格已生成');
  };
  const normalizeLayeredValue = (field: LayeredSpecField, value: string | null | undefined) => {
    const text = (value ?? '').trim();
    return field === 'length' && text && !text.endsWith('mm') ? `${text}mm` : text;
  };
  const buildLayeredSpecRows = () => {
    const groups = selectedSpecGroups.value;
    const fields = groups.map((group) => group.field);
    if (useLinkedLayeredDrafts.value) {
      const rows = layeredSpecDrafts.value.map(materializeSpecDraft);
      const bindingsComplete = layeredSpecDrafts.value.every((draft) =>
        groups.every((group) => group.values.some((value) => value.id === draft.valueIds[group.field])),
      );
      // An unchanged sparse set stays sparse; edited dimensions are regenerated below.
      if (
        linkedSpecStructure.value === currentSpecStructure() &&
        bindingsComplete &&
        new Set(rows.map((row) => specIdentity(row, fields))).size === rows.length
      )
        return rows;
    }
    const normalizedGroups = groups.map((group) => ({
      ...group,
      values: group.values
        .map((item) => ({ ...item, value: normalizeLayeredValue(group.field, item.value) }))
        .filter((item) => item.value),
    }));
    return rebuildLayeredSpecs(
      normalizedGroups,
      layeredSpecDrafts.value,
      () => createBaseSpecRow({ mode: 'layered', quantity: null }),
      salesAttributeFields.value.map((field) => field.key),
    );
  };
  const specToPriceRow = (row: SpecRow): PriceRow => ({
    ...Object.fromEntries(salesAttributeFields.value.map((field) => [field.key, row[field.key]])),
    id: row.id,
    mode: row.mode,
    specText: row.specText,
    material: row.material,
    length: row.length,
    color: row.color,
    size: row.size,
    stock: row.quantity ?? 0,
    costCoefficient: row.costCoefficient,
    cost: row.cost,
    guideCoefficient: row.guideCoefficient,
    guide: row.guide,
    level1Coefficient: row.level1Coefficient,
    level1: row.level1,
    level2Coefficient: row.level2Coefficient,
    level2: row.level2,
    level3Coefficient: row.level3Coefficient,
    level3: row.level3,
  });
  return {
    openSpecDialog,
    closeSpecDialog,
    specDraftError,
    specModeConfirmVisible,
    specModeConfirmMessage,
    requestSpecModeChange,
    confirmSpecModeChange,
    clearSpecDraft,
    draggedSpecValue,
    startSpecValueDrag,
    dropSpecValue,
    draggedSpecField,
    startSpecGroupDrag,
    dropSpecGroup,
    selectedSpecGroups,
    addSingleSpec,
    removeSingleSpec,
    isDuplicateSingleSpec,
    isDuplicateSpecValue,
    isSpecOptionSelected,
    canAddSpecValue,
    addSpecValue,
    removeSpecValue,
    isSpecGroupDisabled,
    toggleSpecGroup,
    resetSpecDialog,
    confirmCreateSpec,
    specToPriceRow,
  };
}
