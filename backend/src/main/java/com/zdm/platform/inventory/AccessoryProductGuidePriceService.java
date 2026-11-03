package com.zdm.platform.inventory;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

@Service
public class AccessoryProductGuidePriceService {
  private final AccessoryProductGuidePriceMapper mapper;
  private final AccessoryGuidePriceSettingMapper settingMapper;

  public AccessoryProductGuidePriceService(AccessoryProductGuidePriceMapper mapper, AccessoryGuidePriceSettingMapper settingMapper) {
    this.mapper = mapper;
    this.settingMapper = settingMapper;
  }

  public List<AccessoryProductGuidePrice> listPrices(Long productId) {
    return mapper.selectList(Wrappers.<AccessoryProductGuidePrice>lambdaQuery()
        .eq(AccessoryProductGuidePrice::getAccessoryProductId, productId)
        .orderByAsc(AccessoryProductGuidePrice::getSkuId));
  }

  public Map<Long, List<AccessoryProductGuidePrice>> listPricesByProductIds(List<Long> productIds) {
    if (productIds.isEmpty()) {
      return Map.of();
    }
    return mapper.selectList(Wrappers.<AccessoryProductGuidePrice>lambdaQuery()
        .in(AccessoryProductGuidePrice::getAccessoryProductId, productIds)
        .orderByAsc(AccessoryProductGuidePrice::getAccessoryProductId)
        .orderByAsc(AccessoryProductGuidePrice::getSkuId)).stream()
        .collect(Collectors.groupingBy(AccessoryProductGuidePrice::getAccessoryProductId));
  }

  @Transactional
  public void replacePrices(Long productId, List<AccessoryProductGuidePrice> requestedPrices) {
    if (requestedPrices == null || requestedPrices.isEmpty()) {
      throw new IllegalArgumentException("请完善每个配件规格的指导价");
    }
    var previous = listPrices(productId).stream().collect(Collectors.toMap(AccessoryProductGuidePrice::getSkuId, java.util.function.Function.identity()));
    var setting = settingMapper.selectById(1L);
    List<AccessoryProductGuidePrice> normalized = requestedPrices.stream()
        .map(price -> {
          var normalizedPrice = normalize(productId, price);
          var existing = previous.get(price.getSkuId());
          String source = price.getPriceSource() == null
              ? (existing == null || existing.getPriceSource() == null ? "manual" : existing.getPriceSource())
              : price.getPriceSource();
          if (!List.of("auto", "manual").contains(source)) {
            throw new IllegalArgumentException("指导价来源不正确");
          }
          if ("auto".equals(source) && (setting == null
              || normalizedPrice.getPriceCoefficient().compareTo(setting.getPriceCoefficient()) != 0)) {
            throw new IllegalArgumentException("跟随配置指导价必须使用当前有效系数");
          }
          normalizedPrice.setPriceSource(source);
          return normalizedPrice;
        })
        .toList();
    long distinctVariants = normalized.stream().map(AccessoryProductGuidePrice::getSkuId).distinct().count();
    if (distinctVariants != normalized.size()) {
      throw new IllegalArgumentException("同一配件规格只能填写一条指导价");
    }
    mapper.delete(Wrappers.<AccessoryProductGuidePrice>lambdaQuery()
        .eq(AccessoryProductGuidePrice::getAccessoryProductId, productId));
    normalized.forEach(mapper::insert);
  }

  private AccessoryProductGuidePrice normalize(Long productId, AccessoryProductGuidePrice price) {
    if (price.getSkuId() == null || price.getSkuId() <= 0) {
      throw new IllegalArgumentException("SKU ID 不能为空");
    }
    BigDecimal coefficient = price.getPriceCoefficient();
    BigDecimal cost = price.getCostPrice();
    BigDecimal value = price.getPrice();
    if (coefficient == null || coefficient.signum() < 0
        || cost == null || cost.signum() < 0
        || value == null || value.signum() < 0) {
      throw new IllegalArgumentException("指导价系数、成本价和指导价不能为空且不能小于0");
    }
    BigDecimal expected = cost.multiply(coefficient).setScale(2, RoundingMode.HALF_UP);
    if (value.setScale(2, RoundingMode.HALF_UP).compareTo(expected) != 0) {
      throw new IllegalArgumentException("指导价必须等于成本价按指导价系数计算后的结果");
    }
    AccessoryProductGuidePrice normalized = new AccessoryProductGuidePrice();
    normalized.setAccessoryProductId(productId);
    normalized.setSkuId(price.getSkuId());
    normalized.setVariantLabel(StringUtils.hasText(price.getVariantLabel()) ? price.getVariantLabel().trim() : null);
    normalized.setPriceCoefficient(coefficient.setScale(4, RoundingMode.HALF_UP));
    normalized.setCostPrice(cost.setScale(2, RoundingMode.HALF_UP));
    normalized.setPrice(expected);
    return normalized;
  }
}
