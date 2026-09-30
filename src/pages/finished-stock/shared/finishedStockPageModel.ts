import type { TableRowData } from 'tdesign-vue-next';
import type {
  FinishedProductAttributeEntry,
  FinishedProductGuidePrice,
  FinishedProductPrice,
  FinishedProductVariant,
  FinishedSpecDimension,
} from '@/services/finishedProducts';

export interface FinishedStockToolbarAction {
  id: string;
  label: string;
  theme: 'primary' | 'default' | 'danger' | 'warning';
  variant?: 'base' | 'outline' | 'text';
  icon?: string;
  className?: string;
  disabled?: boolean;
}
export interface FinishedStockRowAction {
  id: string;
  label: string;
  theme: 'primary' | 'default' | 'danger' | 'warning';
}
export type StockStatus = 'warehouse' | 'selling' | 'offShelf' | 'soldOut' | 'recycle';
export type PublisherType = '平台发布' | '接口获取';
export type RowAction = 'detail' | 'price' | 'shelf' | 'edit' | 'delete' | 'offShelf' | 'restore' | 'purge';
export type BatchAction = 'publish' | 'batchShelf' | 'batchOffShelf' | 'batchRestore' | 'batchPurge' | 'clearRecycle';
export type FormSectionKey = 'description' | 'base' | 'sales';
export type SpecMode = 'single' | 'layered';
export type LayeredSpecField = 'material' | 'length' | 'color' | 'size' | `attribute_${number}`;
export type BatchFilterField = 'specText' | LayeredSpecField;
export type DecimalField =
  | 'cost'
  | 'guideCoefficient'
  | 'guide'
  | 'level1Coefficient'
  | 'level1'
  | 'level2Coefficient'
  | 'level2'
  | 'level3Coefficient'
  | 'level3';
export type ConfirmType =
  'shelf' | 'delete' | 'restore' | 'purge' | 'batchShelf' | 'batchRestore' | 'batchPurge' | 'clearRecycle';
export type ProductFormMode = 'create' | 'edit';
export interface TabConfig {
  value: StockStatus;
  label: string;
  count?: number;
}
export interface FilterState {
  keyword: string;
  category: string;
  supplier: string;
}
export interface PaginationState {
  current: number;
  pageSize: number;
}
export interface StockItem {
  sourceUnavailable?: boolean;
  sourceStatus?: string;
  sourceMessage?: string;
  id: number;
  createdByName: string;
  offShelfByName?: string;
  createdAt?: string;
  code: string;
  image: string;
  name: string;
  categoryId?: number;
  supplierId?: number;
  category: string;
  stock: number;
  supplier: string;
  publisherType: PublisherType;
  isExternalSupplier: boolean;
  guidePrice?: number;
  priceRange: string;
  status: StockStatus;
  offShelfReason?: string;
  offShelfAt?: string;
  offShelfDetail?: string;
  markupPrices?: FinishedProductPrice[];
  guidePrices?: FinishedProductGuidePrice[];
  mainImageMediaId?: number;
  mainImageMediaIds?: number[];
  mainImageUrls?: string[];
  videoMediaId?: number;
  videoUrl?: string;
  detail: string;
  attributes: FinishedProductAttributeEntry[];
  variants: FinishedProductVariant[];
  specDimensions?: FinishedSpecDimension[];
}
export interface ProductForm {
  supplier: string;
  name: string;
  brand: string;
  model: string;
  style: string;
  shape: string;
  material: string;
  craftTexture: string;
  layers: string;
  functionText: string;
  waterproof: string;
  loadBearing: string;
  origin: string;
  installDesc: string;
  detail: string;
  totalStock: number;
  merchantCode: string;
  shelfNow: 'now' | 'later';
  [key: string]: string | number;
}
export interface SpecRow extends TableRowData {
  _specOriginFields?: LayeredSpecField[];
  _specValueIds?: Partial<Record<LayeredSpecField, number>>;
  id: number;
  skuId?: number;
  mode: SpecMode;
  specText: string;
  specImage: boolean;
  material: string;
  materialImage: boolean;
  length: string;
  lengthImage: boolean;
  color: string;
  colorImage: boolean;
  size: string;
  sizeImage: boolean;
  costCoefficient: string;
  cost: string;
  guideCoefficient: string;
  guide: string;
  level1Coefficient: string;
  level1: string;
  level2Coefficient: string;
  level2: string;
  level3Coefficient: string;
  level3: string;
  quantity: number | null;
  markupPrices: Record<
    number,
    {
      coefficient: string;
      price: string;
      priceSource?: 'auto' | 'manual';
      sourceConfigurationId?: number;
    }
  >;
}
export interface PriceRow extends TableRowData {
  id: number;
  mode: SpecMode;
  specText: string;
  material: string;
  length: string;
  color: string;
  size: string;
  stock: number;
  costCoefficient: string;
  cost: string;
  guideCoefficient: string;
  guide: string;
  level1Coefficient: string;
  level1: string;
  level2Coefficient: string;
  level2: string;
  level3Coefficient: string;
  level3: string;
}
export interface BatchFillForm {
  cost: string;
  guideCoefficient: string;
  guide: string;
  level1Coefficient: string;
  level1: string;
  level2Coefficient: string;
  level2: string;
  level3Coefficient: string;
  level3: string;
  quantity: number | null;
}
export interface SingleSpecItem {
  sourceRow?: SpecRow;
  id: number;
  text: string;
  imageUploaded: boolean;
}
export interface LayeredSpecDraft extends TableRowData {
  id: number;
  sourceRow: SpecRow;
  valueIds: Partial<Record<LayeredSpecField, number>>;
}
export interface SpecValue {
  id: number;
  value: string;
  imageUploaded: boolean;
}
export interface SpecGroup {
  field: LayeredSpecField;
  name: string;
  selected: boolean;
  withImage: boolean;
  values: SpecValue[];
}
export interface CategoryCascaderOption {
  label: string;
  value: string;
  children?: CategoryCascaderOption[];
}
