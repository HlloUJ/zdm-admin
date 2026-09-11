package com.zdm.platform.inventory;

import java.util.List;

public record FinishedOperationLogPage(
    List<FinishedOperationLog> records,
    long total,
    int page,
    int pageSize) {
  public FinishedOperationLogPage {
    records = List.copyOf(records);
  }
}
