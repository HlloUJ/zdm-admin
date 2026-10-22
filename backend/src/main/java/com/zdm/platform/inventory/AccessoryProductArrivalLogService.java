package com.zdm.platform.inventory;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import org.springframework.stereotype.Service;

/** Captures persisted product data after warehouse pricing, without rendering temporary media URLs. */
@Service
public class AccessoryProductArrivalLogService {
  private final AccessoryProductMapper products;
  private final AccessoryProductVariantMapper variants;
  private final AccessoryProductAttributeEntryMapper attributes;
  private final AccessoryProductGuidePriceService guidePrices;
  private final AccessoryProductPriceService prices;
  private final AccessoryOperationLogService logs;

  public AccessoryProductArrivalLogService(AccessoryProductMapper products, AccessoryProductVariantMapper variants,
      AccessoryProductAttributeEntryMapper attributes, AccessoryProductGuidePriceService guidePrices,
      AccessoryProductPriceService prices, AccessoryOperationLogService logs) {
    this.products = products;
    this.variants = variants;
    this.attributes = attributes;
    this.guidePrices = guidePrices;
    this.prices = prices;
    this.logs = logs;
  }

  public void record(Long id, String sourceStatus) {
    AccessoryProduct product = products.selectById(id);
    product.setVariants(variants.selectList(Wrappers.lambdaQuery(AccessoryProductVariant.class)
        .eq(AccessoryProductVariant::getAccessoryProductId, id).orderByAsc(AccessoryProductVariant::getId)));
    product.setAttributes(attributes.selectList(Wrappers.lambdaQuery(AccessoryProductAttributeEntry.class)
        .eq(AccessoryProductAttributeEntry::getAccessoryProductId, id).orderByAsc(AccessoryProductAttributeEntry::getId)));
    product.setGuidePrices(guidePrices.listPrices(id));
    product.setMarkupPrices(prices.listPrices(id));
    logs.recordArrival(product, sourceStatus);
  }
}
