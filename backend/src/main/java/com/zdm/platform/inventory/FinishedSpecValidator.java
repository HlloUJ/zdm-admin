package com.zdm.platform.inventory;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

final class FinishedSpecValidator {
  private FinishedSpecValidator() {}

  static void validate(FinishedProduct product) {
    List<FinishedProductVariant> variants = product.getVariants();
    boolean layered = variants.stream().anyMatch(v -> "layered".equals(v.getDisplayMode()));
    List<FinishedSpecDimension> dimensions = product.getSpecDimensions();
    if (!layered) {
      product.setSpecDimensions(List.of());
      return;
    }
    // Legacy records have no dimension snapshot. Keep them readable without inventing an order.
    if (dimensions == null) {
      return;
    }
    if (dimensions.isEmpty() || dimensions.size() > 3) {
      throw new IllegalArgumentException("分层规格必须选择 1 至 3 个销售属性");
    }
    Set<String> keys = new HashSet<>();
    for (FinishedSpecDimension dimension : dimensions) {
      if (dimension == null || dimension.key() == null || !dimension.key().matches("attribute_\\d+")
          || !keys.add(dimension.key()) || dimension.name() == null || dimension.name().isBlank()
          || dimension.values().isEmpty()) {
        throw new IllegalArgumentException("规格属性定义不完整或重复");
      }
      Set<String> values = new HashSet<>();
      for (String value : dimension.values()) {
        if (value == null || value.isBlank() || !value.equals(value.trim()) || !values.add(value)) {
          throw new IllegalArgumentException("同一属性的值不能为空或重复");
        }
      }
    }
    Set<List<String>> combinations = new HashSet<>();
    for (FinishedProductVariant variant : variants) {
      if (!"layered".equals(variant.getDisplayMode()) || variant.getSalesAttributes() == null) {
        throw new IllegalArgumentException("规格展示方式与属性定义不一致");
      }
      List<String> combination = dimensions.stream().map(d -> {
        String value = variant.getSalesAttributes().get(d.key());
        if (value == null || !d.values().contains(value)) {
          throw new IllegalArgumentException("规格属性值不属于已定义的组合选项");
        }
        return value;
      }).toList();
      if (!combinations.add(combination)) {
        throw new IllegalArgumentException("销售规格组合重复，请重新编辑规格");
      }
    }
  }
}
