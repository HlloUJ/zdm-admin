package com.zdm.platform.inventory;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

class FinishedProductOffShelfOperatorTest {
  private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
  private final ProductLifecycleService lifecycle = mock(ProductLifecycleService.class);
  private final FinishedProductService service = new FinishedProductService(
      null, null, null, null, jdbc, null, null, null, null, null, lifecycle);

  @Test
  void usesCurrentBusinessLifecycleAndLatestOffShelfLog() {
    FinishedProduct product = new FinishedProduct();
    product.setId(7L);
    product.setStatus("offShelf");
    product.setSourceStatus("offShelf");
    when(jdbc.queryForList(anyString(), eq(String.class), eq(7L), eq("admin")))
        .thenReturn(List.of("运营下架人"));
    when(jdbc.queryForList(anyString(), eq(String.class), eq(7L), eq("supply-chain")))
        .thenReturn(List.of("供应链下架人"));
    service.attachOffShelfOperator(product);
    assertThat(product.getOffShelfByName()).isEqualTo("运营下架人");
    when(lifecycle.isSupplyChain()).thenReturn(true);
    service.attachOffShelfOperator(product);
    assertThat(product.getOffShelfByName()).isEqualTo("供应链下架人");
    verify(jdbc).queryForList(contains("ORDER BY operated_at DESC, id DESC LIMIT 1"),
        eq(String.class), eq(7L), eq("admin"));
  }

  @Test
  void neverFallsBackToCreatorAndClearsOtherStatuses() {
    FinishedProduct product = new FinishedProduct();
    product.setId(7L);
    product.setStatus("offShelf");
    product.setCreatedByName("创建人");
    service.attachOffShelfOperator(product);
    assertThat(product.getOffShelfByName()).isNull();
    product.setStatus("selling");
    product.setOffShelfByName("历史下架人");
    clearInvocations(jdbc);
    service.attachOffShelfOperator(product);
    assertThat(product.getOffShelfByName()).isNull();
    verifyNoInteractions(jdbc);
  }
}
