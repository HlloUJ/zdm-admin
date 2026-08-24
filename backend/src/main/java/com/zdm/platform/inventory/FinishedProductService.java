package com.zdm.platform.inventory;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class FinishedProductService extends ServiceImpl<FinishedProductMapper, FinishedProduct> {
  private final FinishedProductPriceService priceService;
  private final FinishedProductGuidePriceService guidePriceService;

  public FinishedProductService(
      FinishedProductPriceService priceService,
      FinishedProductGuidePriceService guidePriceService) {
    this.priceService = priceService;
    this.guidePriceService = guidePriceService;
  }

  public List<FinishedProduct> listWithPrices() {
    List<FinishedProduct> products = list();
    products.forEach(this::attachPrices);
    return products;
  }

  @Transactional
  public FinishedProduct createWithPrices(FinishedProduct product) {
    List<FinishedProductPrice> markupPrices = product.getMarkupPrices();
    List<FinishedProductGuidePrice> guidePrices = product.getGuidePrices();
    if (guidePrices != null && !guidePrices.isEmpty()) {
      product.setGuidePrice(guidePrices.getFirst().getPrice());
    }
    product.setId(null);
    save(product);
    priceService.replacePrices(product.getId(), markupPrices);
    guidePriceService.replacePrices(product.getId(), guidePrices);
    return attachPrices(product);
  }

  @Transactional
  public FinishedProduct updateWithPrices(Long id, FinishedProduct product) {
    List<FinishedProductPrice> markupPrices = product.getMarkupPrices();
    List<FinishedProductGuidePrice> guidePrices = product.getGuidePrices();
    if (guidePrices != null && !guidePrices.isEmpty()) {
      product.setGuidePrice(guidePrices.getFirst().getPrice());
    }
    product.setId(id);
    updateById(product);
    if (markupPrices != null) {
      priceService.replacePrices(id, markupPrices);
    }
    if (guidePrices != null) {
      guidePriceService.replacePrices(id, guidePrices);
    }
    return attachPrices(getById(id));
  }

  private FinishedProduct attachPrices(FinishedProduct product) {
    product.setMarkupPrices(priceService.listPrices(product.getId()));
    product.setGuidePrices(guidePriceService.listPrices(product.getId()));
    return product;
  }
}
