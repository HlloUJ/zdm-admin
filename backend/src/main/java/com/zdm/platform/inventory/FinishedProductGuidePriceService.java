package com.zdm.platform.inventory;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

@Service
public class FinishedProductGuidePriceService {
  private final FinishedProductGuidePriceMapper mapper;

  public FinishedProductGuidePriceService(FinishedProductGuidePriceMapper mapper) {
    this.mapper = mapper;
  }

  public List<FinishedProductGuidePrice> listPrices(Long productId) {
    return mapper.selectList(Wrappers.<FinishedProductGuidePrice>lambdaQuery()
        .eq(FinishedProductGuidePrice::getFinishedProductId, productId)
        .orderByAsc(FinishedProductGuidePrice::getVariantKey));
  }

  @Transactional
  public void replacePrices(Long productId, List<FinishedProductGuidePrice> requestedPrices) {
    if (requestedPrices == null || requestedPrices.isEmpty()) {
      throw new IllegalArgumentException("请完善每个成品规格的指导价");
    }
    List<FinishedProductGuidePrice> normalized = requestedPrices.stream()
        .map(price -> normalize(productId, price))
        .toList();
    long distinctVariants = normalized.stream().map(FinishedProductGuidePrice::getVariantKey).distinct().count();
    if (distinctVariants != normalized.size()) {
      throw new IllegalArgumentException("同一成品规格只能填写一条指导价");
    }
    mapper.delete(Wrappers.<FinishedProductGuidePrice>lambdaQuery()
        .eq(FinishedProductGuidePrice::getFinishedProductId, productId));
    normalized.forEach(mapper::insert);
  }

  private FinishedProductGuidePrice normalize(Long productId, FinishedProductGuidePrice price) {
    if (!StringUtils.hasText(price.getVariantKey())) {
      throw new IllegalArgumentException("成品规格编码不能为空");
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
    FinishedProductGuidePrice normalized = new FinishedProductGuidePrice();
    normalized.setFinishedProductId(productId);
    normalized.setVariantKey(price.getVariantKey().trim());
    normalized.setVariantLabel(StringUtils.hasText(price.getVariantLabel()) ? price.getVariantLabel().trim() : null);
    normalized.setPriceCoefficient(coefficient.setScale(4, RoundingMode.HALF_UP));
    normalized.setCostPrice(cost.setScale(2, RoundingMode.HALF_UP));
    normalized.setPrice(expected);
    return normalized;
  }
}
