package com.zdm.platform.inventory;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.springframework.stereotype.Service;

@Service
public class PriceConfigurationBackfillService {
  private final SlabInventoryMapper slabMapper;
  private final SlabPriceMapper slabPriceMapper;
  private final FinishedProductPriceMapper finishedPriceMapper;
  private final FinishedProductGuidePriceMapper finishedGuidePriceMapper;

  public PriceConfigurationBackfillService(
      SlabInventoryMapper slabMapper,
      SlabPriceMapper slabPriceMapper,
      FinishedProductPriceMapper finishedPriceMapper,
      FinishedProductGuidePriceMapper finishedGuidePriceMapper) {
    this.slabMapper = slabMapper;
    this.slabPriceMapper = slabPriceMapper;
    this.finishedPriceMapper = finishedPriceMapper;
    this.finishedGuidePriceMapper = finishedGuidePriceMapper;
  }

  public int backfillSlabs(SlabMarkupConfiguration configuration) {
    List<SlabInventory> slabs = slabMapper.selectList(Wrappers.<SlabInventory>lambdaQuery()
        .isNotNull(SlabInventory::getCostPrice));
    Set<Long> existingSlabIds = new HashSet<>(slabPriceMapper.selectList(
            Wrappers.<SlabPrice>lambdaQuery()
                .eq(SlabPrice::getMarkupConfigurationId, configuration.getId()))
        .stream().map(SlabPrice::getSlabId).toList());
    int inserted = 0;
    for (SlabInventory slab : slabs) {
      if (existingSlabIds.contains(slab.getId())) {
        continue;
      }
      BigDecimal cost = slab.getCostPrice().setScale(2, RoundingMode.HALF_UP);
      BigDecimal coefficient = configuration.getPriceCoefficient().setScale(4, RoundingMode.HALF_UP);
      SlabPrice price = new SlabPrice();
      price.setSlabId(slab.getId());
      price.setMarkupConfigurationId(configuration.getId());
      price.setPriceCoefficient(coefficient);
      price.setCostPrice(cost);
      price.setPrice(cost.multiply(coefficient).setScale(2, RoundingMode.HALF_UP));
      slabPriceMapper.insert(price);
      inserted += 1;
    }
    return inserted;
  }

  public int backfillFinishedProducts(FinishedMarkupConfiguration configuration) {
    List<FinishedProductGuidePrice> guidePrices = finishedGuidePriceMapper.selectList(null);
    Set<String> existingKeys = new HashSet<>(finishedPriceMapper.selectList(
            Wrappers.<FinishedProductPrice>lambdaQuery()
                .eq(FinishedProductPrice::getMarkupConfigurationId, configuration.getId()))
        .stream().map(this::finishedVariantKey).toList());
    int inserted = 0;
    for (FinishedProductGuidePrice guidePrice : guidePrices) {
      String key = guidePrice.getFinishedProductId() + "\u0000" + guidePrice.getVariantKey();
      if (existingKeys.contains(key)) {
        continue;
      }
      BigDecimal cost = guidePrice.getCostPrice().setScale(2, RoundingMode.HALF_UP);
      BigDecimal coefficient = configuration.getPriceCoefficient().setScale(4, RoundingMode.HALF_UP);
      FinishedProductPrice price = new FinishedProductPrice();
      price.setFinishedProductId(guidePrice.getFinishedProductId());
      price.setVariantKey(guidePrice.getVariantKey());
      price.setVariantLabel(guidePrice.getVariantLabel());
      price.setMarkupConfigurationId(configuration.getId());
      price.setPriceCoefficient(coefficient);
      price.setCostPrice(cost);
      price.setPrice(cost.multiply(coefficient).setScale(2, RoundingMode.HALF_UP));
      finishedPriceMapper.insert(price);
      inserted += 1;
    }
    return inserted;
  }

  private String finishedVariantKey(FinishedProductPrice price) {
    return price.getFinishedProductId() + "\u0000" + price.getVariantKey();
  }
}
