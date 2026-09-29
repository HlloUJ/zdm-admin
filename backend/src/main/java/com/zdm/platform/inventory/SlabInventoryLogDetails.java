package com.zdm.platform.inventory;

import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

final class SlabInventoryLogDetails {
  private SlabInventoryLogDetails() {}

  static Map<String, Object> creationDetails(SlabInventory created, boolean supplyChain) {
    Map<String, Object> values = new LinkedHashMap<>();
    values.put("库存", created.getStock());
    values.put("大板名称", created.getName());
    values.put("大板编号", created.getSerialNo());
    values.put("供应商ID", created.getSupplierId());
    values.put("品种ID", created.getVarietyId());
    values.put("产地ID", created.getOriginId());
    values.put("纹理ID", created.getTextureId());
    values.put("色系ID", created.getColorId());
    values.put("等级ID", created.getGradeId());
    values.put("仓库", created.getWarehouse());
    values.put("长度", created.getLengthMm());
    values.put("宽度", created.getWidthMm());
    values.put("高度", created.getThicknessMm());
    values.put("误差", created.getToleranceMm());
    values.put("扣角1长", created.getCorner1LengthMm());
    values.put("扣角1宽", created.getCorner1WidthMm());
    values.put("扣角2长", created.getCorner2LengthMm());
    values.put("扣角2宽", created.getCorner2WidthMm());
    values.put("扣角3长", created.getCorner3LengthMm());
    values.put("扣角3宽", created.getCorner3WidthMm());
    values.put("扣角4长", created.getCorner4LengthMm());
    values.put("扣角4宽", created.getCorner4WidthMm());
    values.put("1:1主图", created.getMainImageMediaId());
    values.put("扫描图", created.getScanImageMediaId());
    values.put("设计图", created.getDesignImageMediaId());
    values.put("商品视频", created.getVideoMediaId());
    values.put("视频封面", created.getVideoCoverMediaId());
    values.put("成本价", created.getCostPrice());
    values.put("指导价", created.getGuidePrice());
    values.put("指导价系数", created.getGuidePriceCoefficient());
    values.put("大板ID", created.getId());
    values.put("面积", created.getAreaSquareMeter());
    values.put("发布类型", created.getPublisherType());
    values.put("状态", supplyChain?created.getSourceStatus():created.getStatus());
    values.put("创建人", created.getCreatedByName());
    values.put("创建账号ID", created.getCreatedByAccountId());
    values.put("创建时间", created.getCreatedAt());
    values.put("价格层级", priceDetails(created.getMarkupPrices()));
    for (SlabPrice price : created.getMarkupPrices()) {
      values.put(price.getStoreLevelName() + "价格来源", priceSourceLabel(price));
      values.put(price.getStoreLevelName() + "来源配置ID", price.getSourceConfigurationId());
    }
    return values;
  }

  static Map<String, Object> collectChanges(
      SlabInventory before,
      List<SlabPrice> beforePrices,
      SlabInventory after) {
    Map<String, Object> changes = new LinkedHashMap<>();
    addChange(changes, "库存", before.getStock(), after.getStock());
    addChange(changes, "大板名称", before.getName(), after.getName());
    addChange(changes, "大板编号", before.getSerialNo(), after.getSerialNo());
    addChange(changes, "供应商ID", before.getSupplierId(), after.getSupplierId());
    addChange(changes, "品种ID", before.getVarietyId(), after.getVarietyId());
    addChange(changes, "产地ID", before.getOriginId(), after.getOriginId());
    addChange(changes, "纹理ID", before.getTextureId(), after.getTextureId());
    addChange(changes, "色系ID", before.getColorId(), after.getColorId());
    addChange(changes, "等级ID", before.getGradeId(), after.getGradeId());
    addChange(changes, "仓库", before.getWarehouse(), after.getWarehouse());
    addChange(changes, "长度", before.getLengthMm(), after.getLengthMm());
    addChange(changes, "宽度", before.getWidthMm(), after.getWidthMm());
    addChange(changes, "高度", before.getThicknessMm(), after.getThicknessMm());
    addChange(changes, "面积", before.getAreaSquareMeter(), after.getAreaSquareMeter());
    addChange(changes, "误差", before.getToleranceMm(), after.getToleranceMm());
    addChange(changes, "扣角1长", before.getCorner1LengthMm(), after.getCorner1LengthMm());
    addChange(changes, "扣角1宽", before.getCorner1WidthMm(), after.getCorner1WidthMm());
    addChange(changes, "扣角2长", before.getCorner2LengthMm(), after.getCorner2LengthMm());
    addChange(changes, "扣角2宽", before.getCorner2WidthMm(), after.getCorner2WidthMm());
    addChange(changes, "扣角3长", before.getCorner3LengthMm(), after.getCorner3LengthMm());
    addChange(changes, "扣角3宽", before.getCorner3WidthMm(), after.getCorner3WidthMm());
    addChange(changes, "扣角4长", before.getCorner4LengthMm(), after.getCorner4LengthMm());
    addChange(changes, "扣角4宽", before.getCorner4WidthMm(), after.getCorner4WidthMm());
    addChange(changes, "1:1主图", before.getMainImageMediaId(), after.getMainImageMediaId());
    addChange(changes, "扫描图", before.getScanImageMediaId(), after.getScanImageMediaId());
    addChange(changes, "设计图", before.getDesignImageMediaId(), after.getDesignImageMediaId());
    addChange(changes, "商品视频", before.getVideoMediaId(), after.getVideoMediaId());
    addChange(changes, "视频封面", before.getVideoCoverMediaId(), after.getVideoCoverMediaId());
    addChange(changes, "成本价", before.getCostPrice(), after.getCostPrice());
    addChange(changes, "指导价", before.getGuidePrice(), after.getGuidePrice());
    addChange(changes, "指导价系数", before.getGuidePriceCoefficient(), after.getGuidePriceCoefficient());
    addChange(changes, "价格层级", priceDetails(beforePrices), priceDetails(after.getMarkupPrices()));
    for (SlabPrice price : after.getMarkupPrices()) {
      SlabPrice previous = beforePrices.stream()
          .filter(item -> Objects.equals(item.getStoreLevelId(), price.getStoreLevelId()))
          .findFirst().orElse(null);
      if (previous != null) {
        addChange(changes, price.getStoreLevelName() + "价格来源",
            priceSourceLabel(previous), priceSourceLabel(price));
      }
    }
    return changes;
  }

  private static String priceSourceLabel(SlabPrice price) {
    return "auto".equals(price.getPriceSource()) ? "跟随配置" : "手工价格";
  }

  private static List<Map<String, Object>> priceDetails(List<SlabPrice> prices) {
    if (prices == null) {
      return List.of();
    }
    return prices.stream()
        .sorted(java.util.Comparator.comparing(SlabPrice::getStoreLevelId))
        .map(price -> {
          Map<String, Object> value = new LinkedHashMap<>();
          value.put("storeLevelId", price.getStoreLevelId());
          value.put("storeLevelName", price.getStoreLevelName());
          value.put("priceCoefficient", price.getPriceCoefficient());
          value.put("costPrice", price.getCostPrice());
          value.put("price", price.getPrice());
          value.put("priceSource", price.getPriceSource());
          return value;
        })
        .toList();
  }

  private static void addChange(
      Map<String, Object> changes,
      String field,
      Object before,
      Object after) {
    if (Objects.deepEquals(before, after) || before instanceof BigDecimal left && after instanceof BigDecimal right && left.compareTo(right)==0) {
      return;
    }
    Map<String, Object> values = new LinkedHashMap<>();
    values.put("before", before);
    values.put("after", after);
    changes.put(field, values);
  }

}
