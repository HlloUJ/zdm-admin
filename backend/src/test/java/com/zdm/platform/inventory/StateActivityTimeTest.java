package com.zdm.platform.inventory;

import static org.assertj.core.api.Assertions.assertThat;
import java.sql.Timestamp;
import java.time.LocalDateTime;
import org.junit.jupiter.api.Test;

class StateActivityTimeTest {
  @Test void preservesUtcTimeAndMicrosecondsForBothJdbcTypes() {
    LocalDateTime time = LocalDateTime.of(2026, 10, 27, 2, 33, 58, 199429000);
    assertThat(StateActivityTime.read(time)).isEqualTo(time);
    assertThat(StateActivityTime.read(Timestamp.valueOf(time))).isEqualTo(time);
    assertThat(StateActivityTime.read(null)).isNull();
  }
}
