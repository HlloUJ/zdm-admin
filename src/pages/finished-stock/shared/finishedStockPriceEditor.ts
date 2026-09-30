import type { Ref } from 'vue';
import { isValidSpecPriceNumber } from '../management/priceValidation';
import type { BatchFillForm, DecimalField, PriceRow, SpecRow } from './finishedStockPageModel';

interface PriceLevel {
  id: number;
  configurationId?: number;
  priceCoefficient?: number;
}

interface BatchMarkupPrice {
  coefficient: string;
  price: string;
}

export const useFinishedStockPriceEditor = (
  getPriceLevels: () => PriceLevel[],
  batchFillForm: BatchFillForm,
  batchMarkupPrices: Ref<Record<number, BatchMarkupPrice>>,
) => {
  const formatDecimalValue = (row: SpecRow | PriceRow | BatchFillForm, field: DecimalField) => {
    const rawValue = String(row[field] ?? '').trim();
    if (!rawValue) {
      row[field] = '';
      return;
    }
    const value = Number(rawValue);
    row[field] = Number.isFinite(value) ? value.toFixed(2) : '';
  };
  const decimalNumber = (value: string) => {
    if (!isValidSpecPriceNumber(value)) return null;
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : null;
  };
  const syncSpecPriceByCoefficient = (row: SpecRow, coefficientField: DecimalField, priceField: DecimalField) => {
    const cost = decimalNumber(row.cost);
    const coefficient = decimalNumber(row[coefficientField]);
    if (cost === null || coefficient === null) return;
    row[priceField] = (cost * coefficient).toFixed(2);
  };
  const syncSpecCoefficientByPrice = (row: SpecRow, priceField: DecimalField, coefficientField: DecimalField) => {
    const cost = decimalNumber(row.cost);
    const price = decimalNumber(row[priceField]);
    if (cost === null || cost === 0 || price === null) return;
    row[coefficientField] = (price / cost).toFixed(2);
  };
  const syncAllSpecPricesByCost = (row: SpecRow) => {
    (
      [
        ['guideCoefficient', 'guide'],
        ['level1Coefficient', 'level1'],
        ['level2Coefficient', 'level2'],
        ['level3Coefficient', 'level3'],
      ] as [DecimalField, DecimalField][]
    ).forEach(([coefficientField, priceField]) => {
      syncSpecPriceByCoefficient(row, coefficientField, priceField);
    });
    getPriceLevels().forEach((configuration) => {
      const editor = row.markupPrices[configuration.id];
      const cost = decimalNumber(row.cost);
      const coefficient = decimalNumber(editor?.coefficient);
      if (editor && cost !== null && coefficient !== null) editor.price = (cost * coefficient).toFixed(2);
    });
  };
  const handleSpecCostChange = (row: SpecRow, value: unknown) => {
    row.cost = String(value ?? '');
    if (!row.cost.trim()) {
      row.guide = '';
      Object.values(row.markupPrices).forEach((editor) => {
        editor.price = '';
      });
      return;
    }
    if (!isValidSpecPriceNumber(row.cost)) return;
    syncAllSpecPricesByCost(row);
  };
  const handleSpecCoefficientChange = (
    row: SpecRow,
    coefficientField: DecimalField,
    priceField: DecimalField,
    value: unknown,
  ) => {
    row[coefficientField] = String(value ?? '');
    if (!isValidSpecPriceNumber(row[coefficientField])) return;
    syncSpecPriceByCoefficient(row, coefficientField, priceField);
  };
  const handleSpecPriceChange = (
    row: SpecRow,
    priceField: DecimalField,
    coefficientField: DecimalField,
    value: unknown,
  ) => {
    row[priceField] = String(value ?? '');
    if (!isValidSpecPriceNumber(row[priceField])) return;
    syncSpecCoefficientByPrice(row, priceField, coefficientField);
  };
  const toggleSpecPriceSource = (row: SpecRow, levelId: number) => {
    const editor = row.markupPrices[levelId];
    if (editor.priceSource === 'auto') {
      editor.priceSource = 'manual';
      editor.sourceConfigurationId = undefined;
    } else restoreSpecAutoPrice(row, levelId);
  };
  const restoreSpecAutoPrice = (row: SpecRow, levelId: number) => {
    const configuration = getPriceLevels().find((level) => level.id === levelId);
    if (!configuration?.configurationId || configuration.priceCoefficient == null) return;
    const editor = row.markupPrices[levelId];
    editor.coefficient = String(configuration.priceCoefficient);
    editor.priceSource = 'auto';
    editor.sourceConfigurationId = configuration.configurationId;
    if (isValidSpecPriceNumber(row.cost)) editor.price = (Number(row.cost) * configuration.priceCoefficient).toFixed(2);
  };
  const markSpecPriceManual = (row: SpecRow, levelId: number) => {
    row.markupPrices[levelId].priceSource = 'manual';
    row.markupPrices[levelId].sourceConfigurationId = undefined;
  };
  const handleMarkupCoefficientChange = (row: SpecRow, configurationId: number, value: unknown) => {
    const editor = row.markupPrices[configurationId];
    if (!editor) return;
    editor.coefficient = String(value ?? '');
    if (!isValidSpecPriceNumber(editor.coefficient)) return;
    const cost = decimalNumber(row.cost);
    const coefficient = decimalNumber(editor.coefficient);
    if (cost !== null && coefficient !== null && coefficient >= 0) editor.price = (cost * coefficient).toFixed(2);
  };
  const handleMarkupPriceChange = (row: SpecRow, configurationId: number, value: unknown) => {
    const editor = row.markupPrices[configurationId];
    if (!editor) return;
    editor.price = String(value ?? '');
    if (!isValidSpecPriceNumber(editor.price)) return;
    const cost = decimalNumber(row.cost);
    const price = decimalNumber(editor.price);
    if (cost !== null && cost > 0 && price !== null && price >= 0) editor.coefficient = (price / cost).toFixed(2);
  };
  const syncBatchPriceByCoefficient = (coefficientField: DecimalField, priceField: DecimalField) => {
    if (!isValidSpecPriceNumber(batchFillForm.cost) || !isValidSpecPriceNumber(batchFillForm[coefficientField])) return;
    const cost = decimalNumber(batchFillForm.cost);
    const coefficient = decimalNumber(batchFillForm[coefficientField]);
    if (cost === null || coefficient === null) return;
    batchFillForm[priceField] = (cost * coefficient).toFixed(2);
  };
  const syncBatchCoefficientByPrice = (priceField: DecimalField, coefficientField: DecimalField) => {
    if (!isValidSpecPriceNumber(batchFillForm.cost) || !isValidSpecPriceNumber(batchFillForm[priceField])) return;
    const cost = decimalNumber(batchFillForm.cost);
    const price = decimalNumber(batchFillForm[priceField]);
    if (cost === null || cost === 0 || price === null) return;
    batchFillForm[coefficientField] = (price / cost).toFixed(2);
  };
  const syncAllBatchPricesByCost = () => {
    (
      [
        ['guideCoefficient', 'guide'],
        ['level1Coefficient', 'level1'],
        ['level2Coefficient', 'level2'],
        ['level3Coefficient', 'level3'],
      ] as [DecimalField, DecimalField][]
    ).forEach(([coefficientField, priceField]) => {
      syncBatchPriceByCoefficient(coefficientField, priceField);
    });
  };
  const handleBatchMarkupChange = (id: number, field: 'coefficient' | 'price', value: unknown) => {
    const editor = batchMarkupPrices.value[id];
    editor[field] = String(value ?? '');
    if (!isValidSpecPriceNumber(editor[field]) || !isValidSpecPriceNumber(batchFillForm.cost)) return;
    const cost = decimalNumber(batchFillForm.cost);
    const amount = decimalNumber(editor[field]);
    if (cost === null || amount === null) return;
    if (field === 'coefficient') editor.price = (cost * amount).toFixed(2);
    else if (cost > 0) editor.coefficient = (amount / cost).toFixed(2);
  };
  const handleBatchCostChange = (value: unknown) => {
    batchFillForm.cost = String(value ?? '');
    if (!isValidSpecPriceNumber(batchFillForm.cost)) return;
    syncAllBatchPricesByCost();
    for (const [id, editor] of Object.entries(batchMarkupPrices.value)) {
      handleBatchMarkupChange(Number(id), 'coefficient', editor.coefficient);
    }
  };
  const handleBatchCoefficientChange = (coefficientField: DecimalField, priceField: DecimalField, value: unknown) => {
    batchFillForm[coefficientField] = String(value ?? '');
    syncBatchPriceByCoefficient(coefficientField, priceField);
  };
  const handleBatchPriceChange = (priceField: DecimalField, coefficientField: DecimalField, value: unknown) => {
    batchFillForm[priceField] = String(value ?? '');
    syncBatchCoefficientByPrice(priceField, coefficientField);
  };
  return {
    formatDecimalValue,
    decimalNumber,
    handleSpecCostChange,
    handleSpecCoefficientChange,
    handleSpecPriceChange,
    toggleSpecPriceSource,
    markSpecPriceManual,
    handleMarkupCoefficientChange,
    handleMarkupPriceChange,
    handleBatchMarkupChange,
    handleBatchCostChange,
    handleBatchCoefficientChange,
    handleBatchPriceChange,
  };
};
