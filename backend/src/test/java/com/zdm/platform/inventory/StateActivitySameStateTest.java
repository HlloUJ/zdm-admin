package com.zdm.platform.inventory;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockingDetails;
import static org.mockito.Mockito.verifyNoInteractions;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.jdbc.core.JdbcTemplate;

class StateActivitySameStateTest {
  @ParameterizedTest
  @ValueSource(strings = {"finished", "accessory", "slab"})
  void sameWarehouseReentryDoesNotOverwriteActorTimeOrEntry(String kind) {
    JdbcTemplate jdbc = mock(JdbcTemplate.class);
    record(jdbc, kind, "warehouse", "warehouse", "REENTRY");
    verifyNoInteractions(jdbc);
  }

  @ParameterizedTest
  @ValueSource(strings = {"finished", "accessory", "slab"})
  void actualStatusChangeStillRecordsActivity(String kind) {
    JdbcTemplate jdbc = mock(JdbcTemplate.class);
    record(jdbc, kind, "selling", "warehouse", "OFF_SHELF");
    assertThat(mockingDetails(jdbc).getInvocations()).hasSize(1);
  }

  private void record(JdbcTemplate jdbc, String kind, String before, String after, String operation) {
    if ("accessory".equals(kind)) {
      new AccessoryStateActivityService(jdbc).record(kind, "admin", 1L, before, after, 2L, "admin", operation, "价格调整", null);
    } else {
      new ProductStateActivityService(jdbc).record(kind, "admin", 1L, before, after, 2L, "admin", operation, "价格调整", null);
    }
  }
}
