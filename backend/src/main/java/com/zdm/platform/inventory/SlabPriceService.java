package com.zdm.platform.inventory;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class SlabPriceService {
  private final SlabPriceMapper mapper;
  private final SlabMarkupConfigurationService configurationService;

  public SlabPriceService(SlabPriceMapper mapper, SlabMarkupConfigurationService configurationService) {
    this.mapper = mapper;
    this.configurationService = configurationService;
  }

  public List<SlabPrice> listPrices(Long slabId) {
    return mapper.selectList(Wrappers.<SlabPrice>lambdaQuery()
        .eq(SlabPrice::getSlabId, slabId).orderByAsc(SlabPrice::getId));
  }

  @Transactional
  public void replacePrices(Long slabId, List<SlabPrice> requestedPrices) {
    List<SlabMarkupConfiguration> configurations = configurationService.listConfigurations(true);
    if (configurations.isEmpty()) {
      throw new IllegalArgumentException("请先配置并启用至少一条大板价格层级");
    }
    if (requestedPrices == null || requestedPrices.isEmpty()) {
      throw new IllegalArgumentException("请完善全部大板价格");
    }
    Map<Long, SlabMarkupConfiguration> byId = configurations.stream()
        .collect(Collectors.toMap(SlabMarkupConfiguration::getId, item -> item));
    Set<Long> actualIds = requestedPrices.stream().map(SlabPrice::getMarkupConfigurationId)
        .collect(Collectors.toSet());
    if (!actualIds.equals(byId.keySet()) || actualIds.size() != requestedPrices.size()) {
      throw new IllegalArgumentException("必须填写全部启用的大板价格层级");
    }
    List<SlabPrice> normalized = new ArrayList<>();
    requestedPrices.forEach(price -> normalized.add(normalize(slabId, price, byId.get(price.getMarkupConfigurationId()))));
    mapper.delete(Wrappers.<SlabPrice>lambdaQuery().eq(SlabPrice::getSlabId, slabId));
    normalized.forEach(mapper::insert);
  }

  private SlabPrice normalize(Long slabId, SlabPrice price, SlabMarkupConfiguration configuration) {
    if (configuration == null) {
      throw new IllegalArgumentException("大板价格层级不存在或已停用");
    }
    BigDecimal rate = price.getMarkupRate();
    BigDecimal cost = price.getCostPrice();
    BigDecimal value = price.getPrice();
    if (rate == null || rate.signum() < 0 || cost == null || cost.signum() < 0 || value == null) {
      throw new IllegalArgumentException("加价率、成本价和价格不能为空且不能小于0");
    }
    BigDecimal expected = cost.multiply(BigDecimal.ONE.add(
        rate.divide(BigDecimal.valueOf(100), 8, RoundingMode.HALF_UP))).setScale(2, RoundingMode.HALF_UP);
    if (value.setScale(2, RoundingMode.HALF_UP).compareTo(expected) != 0) {
      throw new IllegalArgumentException("价格必须等于成本价按加价率计算后的结果");
    }
    SlabPrice normalized = new SlabPrice();
    normalized.setSlabId(slabId);
    normalized.setMarkupConfigurationId(configuration.getId());
    normalized.setMarkupRate(rate.setScale(4, RoundingMode.HALF_UP));
    normalized.setCostPrice(cost.setScale(2, RoundingMode.HALF_UP));
    normalized.setPrice(expected);
    return normalized;
  }
}
