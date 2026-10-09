import type { SlabOffShelfRecord, SlabOperationType, SlabPrice, SlabPublisherType, SlabStatus } from '@/services/slabs';
import type { OperationLogPriceTierRow } from './operationLogPriceTiers';

export interface FilterState {
  keyword: string;
  variety: string;
  origin: string;
  texture: string;
  color: string;
  grade: string;
  supplier: string;
  offShelfReason: string;
  offShelvedBy: string;
  offShelfDateRange: string[];
}
export interface OperationLogFilterState {
  keyword: string;
  operationType: '' | SlabOperationType;
  operatorName: string;
  dateRange: string[];
}
export interface OperationLogChangeRow {
  field: string;
  before: string;
  after: string;
  priceTiers?: OperationLogPriceTierRow[];
  mediaType?: 'image' | 'video';
  afterMedia?: OperationLogMediaValue;
  beforeMedia?: OperationLogMediaValue;
}
export interface OperationLogMediaValue {
  available: boolean;
  url?: string;
  mediaType: 'image' | 'video';
  mimeType?: string;
  originalName?: string;
  previewOnly?: boolean;
  message?: string;
}
export interface PriceGroup {
  cost: string;
  guide: string;
  level1: string;
  level2: string;
  level3: string;
}
export interface DrawerPriceRow {
  configurationId?: number;
  label: string;
  ratio?: string;
  price: string;
  priceSource?: 'auto' | 'manual';
  sourceConfigurationId?: number;
}
export interface DetailMediaItem {
  label: string;
  url?: string;
  coverUrl?: string;
  type: 'image' | 'video';
}
export interface SlabItem {
  sourceUnavailable?: boolean;
  sourceStatus?: string;
  sourceMessage?: string;
  operationsSnapshotMissing?: boolean;
  stock?: number;
  sourceOffShelfRecords?: SlabOffShelfRecord[];
  id: number;
  supplierId?: number;
  varietyId?: number;
  originId?: number;
  textureId?: number;
  colorId?: number;
  gradeId?: number;
  code: string;
  image: string;
  mainImageMediaId?: number;
  scanImageMediaId?: number;
  designImageMediaId?: number;
  videoMediaId?: number;
  videoCoverMediaId?: number;
  scanImageUrl?: string;
  designImageUrl?: string;
  videoUrl?: string;
  videoCoverUrl?: string;
  name: string;
  size: string;
  origin: string;
  texture: string;
  color: string;
  grade: string;
  tenant: string;
  store: string;
  publisherType: SlabPublisherType;
  createdByName: string;
  createdAt: string;
  price: PriceGroup;
  status: SlabStatus;
  variety: string;
  sku: string;
  lengthMm?: number;
  widthMm?: number;
  thicknessMm?: number;
  toleranceMm?: number;
  corner1LengthMm?: number;
  corner1WidthMm?: number;
  corner2LengthMm?: number;
  corner2WidthMm?: number;
  corner3LengthMm?: number;
  corner3WidthMm?: number;
  corner4LengthMm?: number;
  corner4WidthMm?: number;
  areaSquareMeter?: number;
  guidePriceCoefficient?: number;
  markupPrices?: SlabPrice[];
  offShelfRecords: SlabOffShelfRecord[];
}
export interface ProductForm {
  variety: string;
  origin: string;
  textureId?: number;
  colorId?: number;
  gradeId?: number;
  length: string;
  width: string;
  height: string;
  tolerance: string;
  corner1Length: string;
  corner1Width: string;
  corner2Length: string;
  corner2Width: string;
  corner3Length: string;
  corner3Width: string;
  corner4Length: string;
  corner4Width: string;
  supplier: string;
  cost: string;
  stock: string;
  sku: string;
  guideRatio: string;
  guidePrice: string;
  level1Ratio: string;
  level1Price: string;
  level2Ratio: string;
  level2Price: string;
  level3Ratio: string;
  level3Price: string;
  markupPrices: Record<
    number,
    {
      ratio: string;
      price: string;
      priceSource: 'auto' | 'manual';
      sourceConfigurationId?: number;
    }
  >;
}
export type CornerFieldKey =
  | 'corner1Length'
  | 'corner1Width'
  | 'corner2Length'
  | 'corner2Width'
  | 'corner3Length'
  | 'corner3Width'
  | 'corner4Length'
  | 'corner4Width';
export type MeasurementField = 'length' | 'width' | 'height' | 'tolerance' | CornerFieldKey;
export const tabs: {
  value: SlabStatus;
  label: string;
}[] = [
  { value: 'warehouse', label: '仓库中' },
  { value: 'selling', label: '已上架' },
  { value: 'offShelf', label: '已下架' },
  { value: 'soldOut', label: '已售完' },
  { value: 'recycle', label: '回收站' },
];
export const pageSizeOptions = [10, 20, 50];
export const externalDeleteReasons = ['图片不清晰', '资料不完整', '规格填写异常', '价格信息缺失', '其他'];
export const offShelfReasons = ['库存异常', '价格调整', '图片更新', '供应商申请'];
export const makeFilterState = (): FilterState => ({
  keyword: '',
  variety: '',
  origin: '',
  texture: '',
  color: '',
  grade: '',
  supplier: '',
  offShelfReason: '',
  offShelvedBy: '',
  offShelfDateRange: [],
});
export const makeProductForm = (): ProductForm => ({
  variety: '',
  origin: '',
  textureId: undefined,
  colorId: undefined,
  gradeId: undefined,
  length: '',
  width: '',
  height: '',
  tolerance: '',
  corner1Length: '',
  corner1Width: '',
  corner2Length: '',
  corner2Width: '',
  corner3Length: '',
  corner3Width: '',
  corner4Length: '',
  corner4Width: '',
  supplier: '',
  cost: '',
  stock: '',
  sku: '',
  guideRatio: '',
  guidePrice: '',
  level1Ratio: '1.45',
  level1Price: '',
  level2Ratio: '1.30',
  level2Price: '',
  level3Ratio: '1.18',
  level3Price: '',
  markupPrices: {},
});
