package com.zdm.platform.inventory;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import org.springframework.stereotype.Service;

/** Captures persisted product data after warehouse pricing, without rendering temporary media URLs. */
@Service
public class FinishedProductArrivalLogService {
  private final FinishedProductMapper products;
  private final FinishedProductVariantMapper variants;
  private final FinishedProductAttributeEntryMapper attributes;
  private final FinishedProductGuidePriceService guidePrices;
  private final FinishedProductPriceService prices;
  private final FinishedOperationLogService logs;

  public FinishedProductArrivalLogService(FinishedProductMapper products, FinishedProductVariantMapper variants,
      FinishedProductAttributeEntryMapper attributes, FinishedProductGuidePriceService guidePrices,
      FinishedProductPriceService prices, FinishedOperationLogService logs) {
    this.products = products;
    this.variants = variants;
    this.attributes = attributes;
    this.guidePrices = guidePrices;
    this.prices = prices;
    this.logs = logs;
  }

  public void record(Long id, String sourceStatus) {
    FinishedProduct product = products.selectById(id);
    product.setVariants(variants.selectList(Wrappers.lambdaQuery(FinishedProductVariant.class)
        .eq(FinishedProductVariant::getFinishedProductId, id).orderByAsc(FinishedProductVariant::getId)));
    product.setAttributes(attributes.selectList(Wrappers.lambdaQuery(FinishedProductAttributeEntry.class)
        .eq(FinishedProductAttributeEntry::getFinishedProductId, id).orderByAsc(FinishedProductAttributeEntry::getId)));
    product.setGuidePrices(guidePrices.listPrices(id));
    product.setMarkupPrices(prices.listPrices(id));
    logs.recordArrival(product, sourceStatus);
  }
}
