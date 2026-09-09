package com.zdm.platform.inventory;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.zdm.platform.common.StoreLevelPricingDirectory;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import java.util.function.Function;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

@Service
public class FinishedProductPriceService {
  private final FinishedProductPriceMapper mapper;
  private final StoreLevelPricingDirectory storeLevelDirectory;
  private final FinishedMarkupConfigurationMapper configurationMapper;

  public FinishedProductPriceService(FinishedProductPriceMapper mapper,
      StoreLevelPricingDirectory storeLevelDirectory, FinishedMarkupConfigurationMapper configurationMapper) {
    this.mapper = mapper;
    this.configurationMapper = configurationMapper;
    this.storeLevelDirectory = storeLevelDirectory;
  }

  public List<FinishedProductPrice> listPrices(Long productId) {
    List<FinishedProductPrice> prices = mapper.selectList(Wrappers.<FinishedProductPrice>lambdaQuery()
        .eq(FinishedProductPrice::getFinishedProductId, productId)
        .orderByAsc(FinishedProductPrice::getVariantKey)
        .orderByAsc(FinishedProductPrice::getId));
    return prices;
  }

  @Transactional
  public void replacePrices(Long productId, List<FinishedProductPrice> requestedPrices) {
    List<FinishedProductPrice> existingPrices = listPrices(productId);
    Map<Long, String> levelNames = new LinkedHashMap<>();
    existingPrices.forEach(price -> levelNames.putIfAbsent(price.getStoreLevelId(), price.getStoreLevelName()));
    storeLevelDirectory.listEnabledLevels().forEach(level -> levelNames.putIfAbsent(level.id(), level.name()));
    Set<Long> expectedIds = levelNames.keySet();
    if (expectedIds.isEmpty() && (requestedPrices == null || requestedPrices.isEmpty())) {
      return;
    }
    if (requestedPrices == null || requestedPrices.isEmpty()) {
      throw new IllegalArgumentException("请完善全部成品现货价格");
    }
    Map<String, List<FinishedProductPrice>> byVariant = requestedPrices.stream().collect(Collectors.groupingBy(
        item -> normalizedVariantKey(item.getVariantKey()), LinkedHashMap::new, Collectors.toList()));
    Map<Long, FinishedMarkupConfiguration> configurations = configurationMapper.selectList(
        Wrappers.<FinishedMarkupConfiguration>lambdaQuery()).stream()
        .collect(Collectors.toMap(FinishedMarkupConfiguration::getStoreLevelId, Function.identity()));
    List<FinishedProductPrice> normalized = new ArrayList<>();
    byVariant.forEach((variantKey, prices) -> {
      Set<Long> actualIds = prices.stream().map(FinishedProductPrice::getStoreLevelId)
          .collect(Collectors.toSet());
      if (!actualIds.equals(expectedIds) || actualIds.size() != prices.size()) {
        throw new IllegalArgumentException("每个成品规格都必须填写全部启用的价格层级");
      }
      prices.forEach(price -> {
        FinishedProductPrice result = normalize(productId, variantKey, price, levelNames);
        FinishedProductPrice existing = existingPrices.stream().filter(item ->
            variantKey.equals(item.getVariantKey()) && price.getStoreLevelId().equals(item.getStoreLevelId()))
            .findFirst().orElse(null);
        applySource(result, price, existing, configurations.get(price.getStoreLevelId()));
        normalized.add(result);
      });
    });
    mapper.delete(Wrappers.<FinishedProductPrice>lambdaQuery()
        .eq(FinishedProductPrice::getFinishedProductId, productId));
    normalized.forEach(mapper::insert);
  }

  private FinishedProductPrice normalize(Long productId, String variantKey, FinishedProductPrice price,
      Map<Long, String> levelNames) {
    if (price.getStoreLevelId() == null || !levelNames.containsKey(price.getStoreLevelId())) {
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
    normalized.setStoreLevelId(price.getStoreLevelId());
    normalized.setStoreLevelName(levelNames.get(price.getStoreLevelId()));
    normalized.setPriceCoefficient(coefficient.setScale(4, RoundingMode.HALF_UP));
    normalized.setCostPrice(cost.setScale(2, RoundingMode.HALF_UP));
    normalized.setPrice(expected);
    return normalized;
  }

  private void applySource(FinishedProductPrice result, FinishedProductPrice requested,
      FinishedProductPrice existing, FinishedMarkupConfiguration configuration) {
    String source = requested.getPriceSource();
    boolean matches = configuration != null
        && result.getPriceCoefficient().compareTo(configuration.getPriceCoefficient()) == 0
        && ("enabled".equals(configuration.getStatus()) || (existing != null
            && "auto".equals(existing.getPriceSource())
            && configuration.getId().equals(existing.getSourceConfigurationId())));
    if (source != null && !List.of("auto", "manual").contains(source)) {
      throw new IllegalArgumentException("成品价格来源不正确");
    }
    boolean auto = source == null
        ? matches && (existing == null || "auto".equals(existing.getPriceSource())) : "auto".equals(source);
    if (auto && !matches) {
      throw new IllegalArgumentException("跟随配置价格必须使用当前有效系数");
    }
    result.setPriceSource(auto ? "auto" : "manual");
    result.setSourceConfigurationId(auto ? configuration.getId() : null);
  }

  private String normalizedVariantKey(String value) {
    if (!StringUtils.hasText(value)) {
      throw new IllegalArgumentException("成品规格编码不能为空");
    }
    return value.trim();
  }
}
