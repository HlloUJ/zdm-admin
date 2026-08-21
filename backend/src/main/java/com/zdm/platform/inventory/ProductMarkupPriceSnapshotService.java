package com.zdm.platform.inventory;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

@Service
public class ProductMarkupPriceSnapshotService {
  private final ProductMarkupPriceSnapshotMapper mapper;
  private final MarkupConfigurationService configurationService;

  public ProductMarkupPriceSnapshotService(
      ProductMarkupPriceSnapshotMapper mapper,
      MarkupConfigurationService configurationService) {
    this.mapper = mapper;
    this.configurationService = configurationService;
  }

  public List<ProductMarkupPriceSnapshot> listCurrentPrices(String productType, Long productId) {
    String normalizedType = MarkupProductType.require(productType).value();
    List<ProductMarkupPriceSnapshot> prices = mapper.selectList(
        Wrappers.<ProductMarkupPriceSnapshot>lambdaQuery()
            .eq(ProductMarkupPriceSnapshot::getProductType, normalizedType)
            .eq(ProductMarkupPriceSnapshot::getProductId, productId)
            .eq(ProductMarkupPriceSnapshot::getIsCurrent, true)
            .orderByAsc(ProductMarkupPriceSnapshot::getVariantKey)
            .orderByAsc(ProductMarkupPriceSnapshot::getId));
    Map<Long, String> currentNames = currentConfigurationNames(normalizedType);
    prices.forEach(price -> price.setCurrentName(
        currentNames.getOrDefault(price.getMarkupConfigurationId(), price.getMarkupNameSnapshot())));
    return prices;
  }

  @Transactional
  public void appendCurrentPrices(
      String productType,
      Long productId,
      List<ProductMarkupPriceSnapshot> requestedPrices) {
    String normalizedType = MarkupProductType.require(productType).value();
    List<MarkupConfiguration> enabledConfigurations =
        configurationService.listConfigurations(normalizedType, true);
    if (enabledConfigurations.isEmpty()) {
      throw new IllegalArgumentException("请先配置并启用至少一条加价规则");
    }
    if (requestedPrices == null || requestedPrices.isEmpty()) {
      throw new IllegalArgumentException("请完善全部加价价格");
    }

    Map<Long, MarkupConfiguration> configurationsById = enabledConfigurations.stream()
        .collect(Collectors.toMap(MarkupConfiguration::getId, item -> item));
    Map<String, List<ProductMarkupPriceSnapshot>> pricesByVariant = requestedPrices.stream()
        .collect(Collectors.groupingBy(
            item -> normalizedVariantKey(normalizedType, item.getVariantKey()),
            LinkedHashMap::new,
            Collectors.toList()));
    Set<Long> requiredConfigurationIds = configurationsById.keySet();
    long nextVersion = nextVersion(normalizedType, productId);
    List<ProductMarkupPriceSnapshot> normalizedPrices = new ArrayList<>();

    pricesByVariant.forEach((variantKey, variantPrices) -> {
      Set<Long> actualConfigurationIds = variantPrices.stream()
          .map(ProductMarkupPriceSnapshot::getMarkupConfigurationId)
          .collect(Collectors.toSet());
      if (!actualConfigurationIds.equals(requiredConfigurationIds)
          || actualConfigurationIds.size() != variantPrices.size()) {
        throw new IllegalArgumentException("每个商品规格都必须填写全部启用的加价价格");
      }
      variantPrices.forEach(price -> normalizedPrices.add(normalizePrice(
          normalizedType,
          productId,
          variantKey,
          nextVersion,
          price,
          configurationsById.get(price.getMarkupConfigurationId()))));
    });

    mapper.update(
        null,
        Wrappers.<ProductMarkupPriceSnapshot>lambdaUpdate()
            .eq(ProductMarkupPriceSnapshot::getProductType, normalizedType)
            .eq(ProductMarkupPriceSnapshot::getProductId, productId)
            .eq(ProductMarkupPriceSnapshot::getIsCurrent, true)
            .set(ProductMarkupPriceSnapshot::getIsCurrent, false));
    normalizedPrices.forEach(mapper::insert);
  }

  private ProductMarkupPriceSnapshot normalizePrice(
      String productType,
      Long productId,
      String variantKey,
      long snapshotVersion,
      ProductMarkupPriceSnapshot price,
      MarkupConfiguration configuration) {
    if (configuration == null) {
      throw new IllegalArgumentException("加价配置不存在或已停用");
    }
    BigDecimal rate = price.getMarkupRateSnapshot();
    BigDecimal cost = price.getCostPriceSnapshot();
    BigDecimal salePrice = price.getSalePrice();
    if (rate == null || rate.signum() < 0 || cost == null || cost.signum() < 0 || salePrice == null) {
      throw new IllegalArgumentException("加价率、成本价和价格不能为空且不能小于0");
    }
    BigDecimal expectedPrice = cost
        .multiply(BigDecimal.ONE.add(rate.divide(BigDecimal.valueOf(100), 8, RoundingMode.HALF_UP)))
        .setScale(2, RoundingMode.HALF_UP);
    if (salePrice.setScale(2, RoundingMode.HALF_UP).compareTo(expectedPrice) != 0) {
      throw new IllegalArgumentException("价格必须等于成本价按加价率计算后的结果");
    }

    ProductMarkupPriceSnapshot normalized = new ProductMarkupPriceSnapshot();
    normalized.setProductType(productType);
    normalized.setProductId(productId);
    normalized.setVariantKey(variantKey);
    normalized.setVariantLabel(
        StringUtils.hasText(price.getVariantLabel()) ? price.getVariantLabel().trim() : null);
    normalized.setSnapshotVersion(snapshotVersion);
    normalized.setIsCurrent(true);
    normalized.setMarkupConfigurationId(configuration.getId());
    normalized.setMarkupNameSnapshot(configuration.getName());
    normalized.setMarkupRateSnapshot(rate.setScale(4, RoundingMode.HALF_UP));
    normalized.setCostPriceSnapshot(cost.setScale(2, RoundingMode.HALF_UP));
    normalized.setSalePrice(expectedPrice);
    normalized.setStatus("enabled");
    return normalized;
  }

  private long nextVersion(String productType, Long productId) {
    return mapper.selectList(Wrappers.<ProductMarkupPriceSnapshot>lambdaQuery()
            .eq(ProductMarkupPriceSnapshot::getProductType, productType)
            .eq(ProductMarkupPriceSnapshot::getProductId, productId))
        .stream()
        .map(ProductMarkupPriceSnapshot::getSnapshotVersion)
        .filter(value -> value != null)
        .mapToLong(Long::longValue)
        .max()
        .orElse(0L) + 1L;
  }

  private String normalizedVariantKey(String productType, String value) {
    if (MarkupProductType.SLAB.value().equals(productType)) {
      return "";
    }
    if (!StringUtils.hasText(value)) {
      throw new IllegalArgumentException("成品规格编码不能为空");
    }
    return value.trim();
  }

  private Map<Long, String> currentConfigurationNames(String productType) {
    Map<Long, String> names = new HashMap<>();
    configurationService.listConfigurations(productType, false)
        .forEach(configuration -> names.put(configuration.getId(), configuration.getName()));
    return names;
  }
}
