package com.zdm.platform.inventory;

import java.util.List;

public record AccessoryOperationLogPage(
    List<AccessoryOperationLog> records,
    long total,
    int page,
    int pageSize) {
  public AccessoryOperationLogPage {
    records = List.copyOf(records);
  }
}
