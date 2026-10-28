package com.zdm.platform.inventory;

import java.sql.Timestamp;
import java.time.LocalDateTime;

/** State activity values are already UTC; JDBC drivers may expose either Java time type. */
final class StateActivityTime {
  private StateActivityTime() {}
  static LocalDateTime read(Object value) {
    if (value instanceof LocalDateTime time) { return time; }
    if (value instanceof Timestamp time) { return time.toLocalDateTime(); }
    return null;
  }
}
