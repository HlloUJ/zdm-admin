package com.zdm.platform.inventory;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

class AccessoryProductOffShelfOperatorTest {
  private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
  private final AccessoryStateActivityService activities = new AccessoryStateActivityService(jdbc);
  @Test
  void usesCurrentBusinessActivityInsteadOfAnOlderOffShelfLog() {
    AccessoryProduct product = new AccessoryProduct(); product.setId(7L); product.setStatus("warehouse"); product.setSourceStatus("warehouse");
    when(jdbc.queryForList(anyString(), any(Object[].class))).thenReturn(
        List.of(Map.of("record_id",7L,"state","warehouse","operator_name","运营入库人","warehouse_entry_type","offShelf","warehouse_entry_reason","价格调整")),
        List.of(Map.of("record_id",7L,"state","warehouse","operator_name","供应链入库人","warehouse_entry_type","recycleRestore")));
    activities.attach("accessory","admin",List.of(product));
    assertThat(product.getStateOperatorName()).isEqualTo("运营入库人");
    assertThat(product.getWarehouseEntryType()).isEqualTo("offShelf");
    assertThat(product.getWarehouseEntryReason()).isEqualTo("价格调整");
    activities.attach("accessory","supply-chain",List.of(product));
    assertThat(product.getStateOperatorName()).isEqualTo("供应链入库人");
    assertThat(product.getWarehouseEntryType()).isEqualTo("recycleRestore");
    assertThat(product.getWarehouseEntryReason()).isNull();
    verify(jdbc).queryForList(contains("a.business_client_code=?"), eq(new Object[]{"accessory","supply-chain",7L}));
  }
  @Test
  void unknownActivityNeverFallsBackToCreatorOrStaleDownInformation() {
    AccessoryProduct product = new AccessoryProduct(); product.setId(7L); product.setStatus("warehouse"); product.setCreatedByName("创建人"); product.setWarehouseEntryType("offShelf"); product.setWarehouseEntryReason("旧下架原因");
    activities.attach("accessory","admin",List.of(product));
    assertThat(product.getStateOperatorName()).isNull();
    assertThat(product.getWarehouseEntryType()).isNull();
    assertThat(product.getWarehouseEntryReason()).isNull();
    product.setStatus("selling");
    when(jdbc.queryForList(anyString(), any(Object[].class))).thenReturn(List.of(Map.of("record_id",7L,"state","selling","warehouse_entry_type","offShelf")));
    activities.attach("accessory","admin",List.of(product));
    assertThat(product.getWarehouseEntryType()).isNull();
  }
}
