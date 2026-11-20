package com.zdm.platform.storeexit;

import java.util.List;

public record StoreExitResult(String operationId, long storeId, String databaseStatus,
    String cleanupStatus, long pendingTasks, List<String> retained) {
  public StoreExitResult { retained = List.copyOf(retained); }
}
