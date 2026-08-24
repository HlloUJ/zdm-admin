package com.zdm.platform.inventory;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.math.BigDecimal;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;

class PriceConfigurationBackfillServiceTest {
  @Test
  void newSlabLevelOnlyBackfillsMissingProductPrices() {
    SlabInventoryMapper slabMapper = Mockito.mock(SlabInventoryMapper.class);
    SlabPriceMapper slabPriceMapper = Mockito.mock(SlabPriceMapper.class);
    FinishedProductPriceMapper finishedPriceMapper = Mockito.mock(FinishedProductPriceMapper.class);
    FinishedProductGuidePriceMapper finishedGuidePriceMapper =
        Mockito.mock(FinishedProductGuidePriceMapper.class);
    SlabInventory first = slab(1L, "100.00");
    SlabInventory second = slab(2L, "200.00");
    SlabPrice existing = new SlabPrice();
    existing.setSlabId(1L);
    when(slabMapper.selectList(any())).thenReturn(List.of(first, second));
    when(slabPriceMapper.selectList(any())).thenReturn(List.of(existing));
    SlabMarkupConfiguration configuration = new SlabMarkupConfiguration();
    configuration.setId(8L);
    configuration.setPriceCoefficient(new BigDecimal("0.5000"));

    int inserted = new PriceConfigurationBackfillService(
        slabMapper, slabPriceMapper, finishedPriceMapper, finishedGuidePriceMapper)
        .backfillSlabs(configuration);

    ArgumentCaptor<SlabPrice> captor = ArgumentCaptor.forClass(SlabPrice.class);
    verify(slabPriceMapper).insert(captor.capture());
    assertThat(inserted).isEqualTo(1);
    assertThat(captor.getValue().getSlabId()).isEqualTo(2L);
    assertThat(captor.getValue().getPriceCoefficient()).isEqualByComparingTo("0.5000");
    assertThat(captor.getValue().getPrice()).isEqualByComparingTo("100.00");
  }

  @Test
  void newFinishedLevelOnlyBackfillsMissingVariantsFromOwnedGuidePrices() {
    SlabInventoryMapper slabMapper = Mockito.mock(SlabInventoryMapper.class);
    SlabPriceMapper slabPriceMapper = Mockito.mock(SlabPriceMapper.class);
    FinishedProductPriceMapper finishedPriceMapper = Mockito.mock(FinishedProductPriceMapper.class);
    FinishedProductGuidePriceMapper finishedGuidePriceMapper =
        Mockito.mock(FinishedProductGuidePriceMapper.class);
    FinishedProductGuidePrice first = guidePrice(10L, "SKU-A", "100.00");
    FinishedProductGuidePrice second = guidePrice(10L, "SKU-B", "200.00");
    FinishedProductPrice existing = new FinishedProductPrice();
    existing.setFinishedProductId(10L);
    existing.setVariantKey("SKU-A");
    when(finishedGuidePriceMapper.selectList(any())).thenReturn(List.of(first, second));
    when(finishedPriceMapper.selectList(any())).thenReturn(List.of(existing));
    FinishedMarkupConfiguration configuration = new FinishedMarkupConfiguration();
    configuration.setId(9L);
    configuration.setPriceCoefficient(new BigDecimal("1.2500"));

    int inserted = new PriceConfigurationBackfillService(
        slabMapper, slabPriceMapper, finishedPriceMapper, finishedGuidePriceMapper)
        .backfillFinishedProducts(configuration);

    ArgumentCaptor<FinishedProductPrice> captor = ArgumentCaptor.forClass(FinishedProductPrice.class);
    verify(finishedPriceMapper).insert(captor.capture());
    assertThat(inserted).isEqualTo(1);
    assertThat(captor.getValue().getVariantKey()).isEqualTo("SKU-B");
    assertThat(captor.getValue().getPriceCoefficient()).isEqualByComparingTo("1.2500");
    assertThat(captor.getValue().getPrice()).isEqualByComparingTo("250.00");
  }

  private static SlabInventory slab(Long id, String costPrice) {
    SlabInventory slab = new SlabInventory();
    slab.setId(id);
    slab.setCostPrice(new BigDecimal(costPrice));
    return slab;
  }

  private static FinishedProductGuidePrice guidePrice(Long productId, String variantKey, String costPrice) {
    FinishedProductGuidePrice price = new FinishedProductGuidePrice();
    price.setFinishedProductId(productId);
    price.setVariantKey(variantKey);
    price.setVariantLabel(variantKey);
    price.setCostPrice(new BigDecimal(costPrice));
    return price;
  }
}
