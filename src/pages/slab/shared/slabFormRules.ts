import type { Ref } from 'vue';
import type { FormRule } from 'tdesign-vue-next';
import type { CornerFieldKey, MeasurementField } from './slabPageModel';

export const createSlabFormRules = (
  invalidMeasurementFields: Set<MeasurementField>,
  stockHasLeadingZero: Ref<boolean>,
  cornerFields: { key: CornerFieldKey; label: string }[],
) => {
  const isValidMeasurement = (value: unknown, required: boolean) => {
    const normalizedValue = String(value ?? '').trim();
    if (!normalizedValue) return !required;
    return /^(?:0\.\d{1,2}|[1-9]\d*(?:\.\d{1,2})?)$/.test(normalizedValue) && Number(normalizedValue) > 0;
  };
  const createOptionalMeasurementRule = (field: MeasurementField, label: string): FormRule => ({
    validator: (value) => !invalidMeasurementFields.has(field) && isValidMeasurement(value, false),
    message: `请输入正确的${label}`,
    type: 'error',
    trigger: 'blur',
  });
  const requiredSalesFieldRules = (message: string): FormRule[] => [
    { required: true, message, type: 'error', trigger: 'submit' },
  ];
  const isValidSalesNumber = (value: unknown, minimum: number) => {
    const normalizedValue = String(value ?? '').trim();
    return /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(normalizedValue) && Number(normalizedValue) >= minimum;
  };
  const salesRules: Record<string, FormRule[]> = {
    supplier: requiredSalesFieldRules('请选择供应商'),
    stock: [
      { required: true, message: '请输入库存', type: 'error', trigger: 'submit' },
      {
        validator: (value) => Boolean(String(value ?? '').trim()),
        message: '请输入库存',
        type: 'error',
        trigger: 'blur',
      },
      {
        validator: (value) => !String(value ?? '').trim() || String(value).trim() !== '0',
        message: '库存不能为0',
        type: 'error',
        trigger: 'blur',
      },
      {
        validator: (value) => {
          const normalizedValue = String(value ?? '').trim();
          return (
            !normalizedValue ||
            normalizedValue === '0' ||
            (!stockHasLeadingZero.value && /^[1-9]\d*$/.test(normalizedValue))
          );
        },
        message: '请输入正确的库存',
        type: 'error',
        trigger: 'blur',
      },
      {
        validator: (value) => !String(value ?? '').trim() || String(value).trim() !== '0',
        message: '库存不能为0',
        type: 'error',
        trigger: 'submit',
      },
      {
        validator: (value) => {
          const normalizedValue = String(value ?? '').trim();
          return (
            !normalizedValue ||
            normalizedValue === '0' ||
            (!stockHasLeadingZero.value && /^[1-9]\d*$/.test(normalizedValue))
          );
        },
        message: '请输入正确的库存',
        type: 'error',
        trigger: 'submit',
      },
    ],
  };
  const stockInputProps = {
    onPaste: ({ e, pasteValue }: { e: ClipboardEvent; pasteValue: string }) => {
      if (!/^\d+$/.test(pasteValue)) e.preventDefault();
    },
  };
  const productRules: Record<string, FormRule[]> = {
    variety: [{ required: true, message: '请选择品种', type: 'error', trigger: 'submit' }],
    origin: [{ required: true, message: '请选择产地', type: 'error', trigger: 'submit' }],
    textureId: [{ required: true, message: '请选择纹理', type: 'error', trigger: 'submit' }],
    colorId: [{ required: true, message: '请选择色系', type: 'error', trigger: 'submit' }],
    gradeId: [{ required: true, message: '请选择等级', type: 'error', trigger: 'submit' }],
    length: [
      { required: true, message: '请输入长度', type: 'error', trigger: 'submit' },
      {
        validator: (value) => Boolean(String(value ?? '').trim()),
        message: '请输入长度',
        type: 'error',
        trigger: 'blur',
      },
      {
        validator: (value) => !String(value ?? '').trim() || isValidMeasurement(value, true),
        message: '请输入正确的长度',
        type: 'error',
        trigger: 'blur',
      },
    ],
    width: [
      { required: true, message: '请输入宽度', type: 'error', trigger: 'submit' },
      {
        validator: (value) => Boolean(String(value ?? '').trim()),
        message: '请输入宽度',
        type: 'error',
        trigger: 'blur',
      },
      {
        validator: (value) => !String(value ?? '').trim() || isValidMeasurement(value, true),
        message: '请输入正确的宽度',
        type: 'error',
        trigger: 'blur',
      },
    ],
    height: [
      { required: true, message: '请输入高度', type: 'error', trigger: 'submit' },
      {
        validator: (value) => Boolean(String(value ?? '').trim()),
        message: '请输入高度',
        type: 'error',
        trigger: 'blur',
      },
      {
        validator: (value) => !String(value ?? '').trim() || isValidMeasurement(value, true),
        message: '请输入正确的高度',
        type: 'error',
        trigger: 'blur',
      },
    ],
    tolerance: [createOptionalMeasurementRule('tolerance', '土误差')],
    ...Object.fromEntries(
      cornerFields.map((item) => [item.key, [createOptionalMeasurementRule(item.key, item.label)]]),
    ),
  };
  return { isValidMeasurement, isValidSalesNumber, salesRules, stockInputProps, productRules };
};
