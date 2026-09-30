package com.zdm.platform.inventory;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class SlabInventoryLogDetailsTest {
  @Test
  void creationSnapshotKeepsClientStatusAndPriceSource() {
    SlabInventory slab = new SlabInventory();
    slab.setStatus("selling");
    slab.setSourceStatus("warehouse");
    slab.setMarkupPrices(List.of(price("auto", "10.00")));

    Map<String, Object> management = SlabInventoryLogDetails.creationDetails(slab, false);
    Map<String, Object> supplyChain = SlabInventoryLogDetails.creationDetails(slab, true);

    assertThat(management.get("状态")).isEqualTo("selling");
    assertThat(supplyChain.get("状态")).isEqualTo("warehouse");
    assertThat(management.get("一级价格来源")).isEqualTo("跟随配置");
    assertThat(management.get("一级来源配置ID")).isEqualTo(3L);
  }

  @Test
  void changesIgnoreEquivalentCostScaleAndPreservePriceSourceChange() {
    SlabInventory before = new SlabInventory();
    before.setCostPrice(new BigDecimal("10.0"));
    SlabInventory after = new SlabInventory();
    after.setCostPrice(new BigDecimal("10.00"));
    after.setMarkupPrices(List.of(price("manual", "12.00")));

    Map<String, Object> changes = SlabInventoryLogDetails.collectChanges(
        before, List.of(price("auto", "10.00")), after);

    assertThat(changes).doesNotContainKey("成本价");
    assertThat(changes).containsKey("价格层级")
        .containsEntry("一级价格来源", Map.of("before", "跟随配置", "after", "手工价格"));
  }

  private SlabPrice price(String source, String value) {
    SlabPrice price = new SlabPrice();
    price.setStoreLevelId(1L);
    price.setStoreLevelName("一级");
    price.setPriceSource(source);
    price.setPrice(new BigDecimal(value));
    price.setSourceConfigurationId(3L);
    return price;
  }
}
