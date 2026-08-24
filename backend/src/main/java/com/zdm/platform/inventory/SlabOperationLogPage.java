package com.zdm.platform.inventory;

import java.util.List;

public record SlabOperationLogPage(
    List<SlabOperationLog> records,
    long total,
    int page,
    int pageSize) {
  public SlabOperationLogPage {
    records = List.copyOf(records);
  }
}
