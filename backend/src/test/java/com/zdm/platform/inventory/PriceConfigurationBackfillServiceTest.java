package com.zdm.platform.inventory;

import static org.assertj.core.api.Assertions.assertThat;
import org.junit.jupiter.api.Test;

class PriceConfigurationBackfillServiceTest {
  @Test
  void priceConfigurationsNeverBackfillPublishedProducts() {
    PriceConfigurationBackfillService service = new PriceConfigurationBackfillService();

    assertThat(service.backfillSlabs(new SlabMarkupConfiguration())).isZero();
    assertThat(service.backfillFinishedProducts(new FinishedMarkupConfiguration())).isZero();
  }
}
