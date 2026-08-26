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
    List<SlabPrice> prices = mapper.selectList(Wrappers.<SlabPrice>lambdaQuery()
        .eq(SlabPrice::getSlabId, slabId).orderByAsc(SlabPrice::getId));
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
    Map<Long, String> levelNames = existingPrices.isEmpty()
        ? configurationService.listConfigurations(true).stream().collect(Collectors.toMap(
            SlabMarkupConfiguration::getStoreLevelId,
            SlabMarkupConfiguration::getName))
        : existingPrices.stream().collect(Collectors.toMap(
            SlabPrice::getStoreLevelId,
            SlabPrice::getStoreLevelName));
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
      throw new IllegalArgumentException("必须填写全部启用的大板价格层级");
    }
    List<SlabPrice> normalized = new ArrayList<>();
    requestedPrices.forEach(price -> normalized.add(normalize(slabId, price, levelNames)));
    mapper.delete(Wrappers.<SlabPrice>lambdaQuery()
        .eq(SlabPrice::getSlabId, slabId));
    normalized.forEach(mapper::insert);
  }

  private SlabPrice normalize(Long slabId, SlabPrice price, Map<Long, String> levelNames) {
    if (price.getStoreLevelId() == null || !levelNames.containsKey(price.getStoreLevelId())) {
      throw new IllegalArgumentException("大板价格层级不存在或已停用");
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
    SlabPrice normalized = new SlabPrice();
    normalized.setSlabId(slabId);
    normalized.setStoreLevelId(price.getStoreLevelId());
    normalized.setStoreLevelName(levelNames.get(price.getStoreLevelId()));
    normalized.setPriceCoefficient(coefficient.setScale(4, RoundingMode.HALF_UP));
    normalized.setCostPrice(cost.setScale(2, RoundingMode.HALF_UP));
    normalized.setPrice(expected);
    return normalized;
  }

}
