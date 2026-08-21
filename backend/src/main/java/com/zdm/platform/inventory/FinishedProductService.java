package com.zdm.platform.inventory;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class FinishedProductService extends ServiceImpl<FinishedProductMapper, FinishedProduct> {
  private final ProductMarkupPriceSnapshotService priceSnapshotService;

  public FinishedProductService(ProductMarkupPriceSnapshotService priceSnapshotService) {
    this.priceSnapshotService = priceSnapshotService;
  }

  public List<FinishedProduct> listWithPrices() {
    List<FinishedProduct> products = list();
    products.forEach(this::attachPrices);
    return products;
  }

  @Transactional
  public FinishedProduct createWithPrices(FinishedProduct product) {
    List<ProductMarkupPriceSnapshot> markupPrices = product.getMarkupPrices();
    product.setId(null);
    save(product);
    priceSnapshotService.appendCurrentPrices("finished", product.getId(), markupPrices);
    return attachPrices(product);
  }

  @Transactional
  public FinishedProduct updateWithPrices(Long id, FinishedProduct product) {
    List<ProductMarkupPriceSnapshot> markupPrices = product.getMarkupPrices();
    product.setId(id);
    updateById(product);
    if (markupPrices != null) {
      priceSnapshotService.appendCurrentPrices("finished", id, markupPrices);
    }
    return attachPrices(getById(id));
  }

  private FinishedProduct attachPrices(FinishedProduct product) {
    product.setMarkupPrices(priceSnapshotService.listCurrentPrices("finished", product.getId()));
    return product;
  }
}
