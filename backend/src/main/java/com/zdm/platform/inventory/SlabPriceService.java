package com.zdm.platform.inventory;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.zdm.platform.common.StoreLevelPricingDirectory;
import com.zdm.platform.security.CurrentIdentity;
import com.zdm.platform.security.CurrentIdentityProvider;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class SlabPriceService {
  private final SlabPriceMapper mapper;
  private final StoreLevelPricingDirectory storeLevelDirectory;
  private final SlabMarkupConfigurationMapper configurationMapper;
  private final CurrentIdentityProvider identityProvider;

  public SlabPriceService(
      SlabPriceMapper mapper,
      StoreLevelPricingDirectory storeLevelDirectory,
      SlabMarkupConfigurationMapper configurationMapper,
      CurrentIdentityProvider identityProvider) {
    this.mapper = mapper;
    this.storeLevelDirectory = storeLevelDirectory;
    this.configurationMapper = configurationMapper;
    this.identityProvider = identityProvider;
  }

  public List<SlabPrice> listPrices(Long slabId) {
    List<SlabPrice> prices = mapper.selectList(Wrappers.<SlabPrice>lambdaQuery()
        .eq(SlabPrice::getSlabId, slabId).orderByAsc(SlabPrice::getId));
    prices.forEach(price -> {
      StoreLevelPricingDirectory.Level level = storeLevelDirectory.findLevel(price.getStoreLevelId());
      if (level != null) {
        price.setStoreLevelName(level.name());
      }
    });
    return prices;
  }

  public void requireCompletePrices(Long slabId) {
    if (listPrices(slabId).isEmpty()) {
      throw new IllegalArgumentException("请完善全部大板价格");
    }
  }

  @Transactional
  public void replacePrices(Long slabId, List<SlabPrice> requestedPrices) {
    List<SlabPrice> existingPrices = listPrices(slabId);
    Map<Long, SlabPrice> existingByLevel = existingPrices.stream()
        .collect(Collectors.toMap(SlabPrice::getStoreLevelId, price -> price));
    Map<Long, SlabMarkupConfiguration> configurationsByLevel = configurationMapper.selectList(
            Wrappers.<SlabMarkupConfiguration>lambdaQuery()
                .eq(SlabMarkupConfiguration::getLegacySeeded, false))
        .stream()
        .collect(Collectors.toMap(SlabMarkupConfiguration::getStoreLevelId, configuration -> configuration));
    Map<Long, String> levelNames = new LinkedHashMap<>();
    existingPrices.forEach(price -> levelNames.put(price.getStoreLevelId(), price.getStoreLevelName()));
    storeLevelDirectory.listEnabledLevels().forEach(level -> levelNames.putIfAbsent(level.id(), level.name()));
    Set<Long> expectedIds = levelNames.keySet();
    if (expectedIds.isEmpty() && (requestedPrices == null || requestedPrices.isEmpty())) {
      return;
    }
    if (requestedPrices == null || requestedPrices.isEmpty()) {
      throw new IllegalArgumentException("请完善全部大板价格");
    }
    Set<Long> actualIds = requestedPrices.stream().map(SlabPrice::getStoreLevelId)
        .collect(Collectors.toSet());
    if (!actualIds.equals(expectedIds) || actualIds.size() != requestedPrices.size()) {
      throw new IllegalArgumentException("必须填写全部展示的门店级别价格");
    }
    List<SlabPrice> normalized = new ArrayList<>();
    requestedPrices.forEach(price -> normalized.add(normalize(
        slabId,
        price,
        existingByLevel.get(price.getStoreLevelId()),
        configurationsByLevel.get(price.getStoreLevelId()),
        levelNames)));
    normalized.forEach(price -> {
      if (price.getId() == null) {
        mapper.insert(price);
      } else {
        mapper.updateById(price);
      }
    });
  }

  private SlabPrice normalize(
      Long slabId,
      SlabPrice price,
      SlabPrice existing,
      SlabMarkupConfiguration configuration,
      Map<Long, String> levelNames) {
    if (price.getStoreLevelId() == null || !levelNames.containsKey(price.getStoreLevelId())) {
      throw new IllegalArgumentException("大板价格层级不存在或已停用");
    }
    BigDecimal coefficient = price.getPriceCoefficient();
    BigDecimal cost = price.getCostPrice();
    BigDecimal value = price.getPrice();
    if (coefficient == null
        || coefficient.signum() <= 0
        || cost == null
        || cost.signum() < 0
        || value == null
        || value.signum() < 0) {
      throw new IllegalArgumentException("价格系数必须大于0，成本价和价格不能为空且不能小于0");
    }
    BigDecimal expected = cost.multiply(coefficient).setScale(2, RoundingMode.HALF_UP);
    if (value.setScale(2, RoundingMode.HALF_UP).compareTo(expected) != 0) {
      throw new IllegalArgumentException("价格必须等于成本价按价格系数计算后的结果");
    }
    SlabPrice normalized = new SlabPrice();
    normalized.setId(existing == null ? null : existing.getId());
    normalized.setSlabId(slabId);
    normalized.setStoreLevelId(price.getStoreLevelId());
    normalized.setStoreLevelName(levelNames.get(price.getStoreLevelId()));
    normalized.setPriceCoefficient(coefficient.setScale(4, RoundingMode.HALF_UP));
    normalized.setCostPrice(cost.setScale(2, RoundingMode.HALF_UP));
    normalized.setPrice(expected);
    applyPriceSource(normalized, price, existing, configuration);
    return normalized;
  }

  private void applyPriceSource(
      SlabPrice normalized,
      SlabPrice requested,
      SlabPrice existing,
      SlabMarkupConfiguration configuration) {
    String requestedSource = requested.getPriceSource();
    boolean matchesConfiguration = configuration != null
        && normalized.getPriceCoefficient().compareTo(
            configuration.getPriceCoefficient().setScale(4, RoundingMode.HALF_UP)) == 0
        && ("enabled".equals(configuration.getStatus())
            || (existing != null
                && "auto".equals(existing.getPriceSource())
                && configuration.getId().equals(existing.getSourceConfigurationId())));
    boolean auto;
    if (requestedSource != null) {
      if (!List.of("auto", "manual").contains(requestedSource)) {
        throw new IllegalArgumentException("大板价格来源不正确");
      }
      auto = "auto".equals(requestedSource);
      if (auto && !matchesConfiguration) {
        throw new IllegalArgumentException("跟随配置价格必须使用当前有效价格系数");
      }
    } else {
      auto = matchesConfiguration && (existing == null || "auto".equals(existing.getPriceSource()));
    }
    if (auto) {
      normalized.setPriceSource("auto");
      normalized.setSourceConfigurationId(configuration.getId());
      normalized.setManualUpdatedByName(null);
      normalized.setManualUpdatedByAccountId(null);
      normalized.setManualUpdatedAt(null);
      return;
    }
    CurrentIdentity identity = identityProvider.require();
    normalized.setPriceSource("manual");
    normalized.setSourceConfigurationId(null);
    normalized.setManualUpdatedByName(identity.displayName());
    normalized.setManualUpdatedByAccountId(identity.accountId());
    normalized.setManualUpdatedAt(LocalDateTime.now());
  }

}
