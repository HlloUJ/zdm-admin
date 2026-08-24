package com.zdm.platform.inventory;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

@Service
public class FinishedProductPriceService {
  private final FinishedProductPriceMapper mapper;
  private final FinishedMarkupConfigurationService configurationService;

  public FinishedProductPriceService(FinishedProductPriceMapper mapper,
      FinishedMarkupConfigurationService configurationService) {
    this.mapper = mapper;
    this.configurationService = configurationService;
  }

  public List<FinishedProductPrice> listPrices(Long productId) {
    return mapper.selectList(Wrappers.<FinishedProductPrice>lambdaQuery()
        .eq(FinishedProductPrice::getFinishedProductId, productId)
        .orderByAsc(FinishedProductPrice::getVariantKey)
        .orderByAsc(FinishedProductPrice::getId));
  }

  @Transactional
  public void replacePrices(Long productId, List<FinishedProductPrice> requestedPrices) {
    List<FinishedMarkupConfiguration> configurations = configurationService.listConfigurations(true);
    if (configurations.isEmpty() && (requestedPrices == null || requestedPrices.isEmpty())) {
      return;
    }
    if (requestedPrices == null || requestedPrices.isEmpty()) {
      throw new IllegalArgumentException("请完善全部成品现货价格");
    }
    Map<Long, FinishedMarkupConfiguration> byId = configurations.stream()
        .collect(Collectors.toMap(FinishedMarkupConfiguration::getId, item -> item));
    Map<String, List<FinishedProductPrice>> byVariant = requestedPrices.stream().collect(Collectors.groupingBy(
        item -> normalizedVariantKey(item.getVariantKey()), LinkedHashMap::new, Collectors.toList()));
    List<FinishedProductPrice> normalized = new ArrayList<>();
    byVariant.forEach((variantKey, prices) -> {
      Set<Long> actualIds = prices.stream().map(FinishedProductPrice::getMarkupConfigurationId)
          .collect(Collectors.toSet());
      if (!actualIds.equals(byId.keySet()) || actualIds.size() != prices.size()) {
        throw new IllegalArgumentException("每个成品规格都必须填写全部启用的价格层级");
      }
      prices.forEach(price -> normalized.add(normalize(productId, variantKey, price,
          byId.get(price.getMarkupConfigurationId()))));
    });
    mapper.delete(Wrappers.<FinishedProductPrice>lambdaQuery()
        .eq(FinishedProductPrice::getFinishedProductId, productId)
        .in(FinishedProductPrice::getMarkupConfigurationId, byId.keySet()));
    normalized.forEach(mapper::insert);
  }

  private FinishedProductPrice normalize(Long productId, String variantKey, FinishedProductPrice price,
      FinishedMarkupConfiguration configuration) {
    if (configuration == null) {
      throw new IllegalArgumentException("成品现货价格层级不存在或已停用");
    }
    BigDecimal coefficient = price.getPriceCoefficient();
    BigDecimal cost = price.getCostPrice();
    BigDecimal value = price.getPrice();
    if (coefficient == null
        || coefficient.signum() < 0
        || cost == null
        || cost.signum() < 0
        || value == null
        || value.signum() < 0) {
      throw new IllegalArgumentException("价格系数、成本价和价格不能为空且不能小于0");
    }
    BigDecimal expected = cost.multiply(coefficient).setScale(2, RoundingMode.HALF_UP);
    if (value.setScale(2, RoundingMode.HALF_UP).compareTo(expected) != 0) {
      throw new IllegalArgumentException("价格必须等于成本价按价格系数计算后的结果");
    }
    FinishedProductPrice normalized = new FinishedProductPrice();
    normalized.setFinishedProductId(productId);
    normalized.setVariantKey(variantKey);
    normalized.setVariantLabel(StringUtils.hasText(price.getVariantLabel()) ? price.getVariantLabel().trim() : null);
    normalized.setMarkupConfigurationId(configuration.getId());
    normalized.setPriceCoefficient(coefficient.setScale(4, RoundingMode.HALF_UP));
    normalized.setCostPrice(cost.setScale(2, RoundingMode.HALF_UP));
    normalized.setPrice(expected);
    return normalized;
  }

  private String normalizedVariantKey(String value) {
    if (!StringUtils.hasText(value)) {
      throw new IllegalArgumentException("成品规格编码不能为空");
    }
    return value.trim();
  }
}
