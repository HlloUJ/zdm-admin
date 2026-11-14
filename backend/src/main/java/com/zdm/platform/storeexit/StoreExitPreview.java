package com.zdm.platform.storeexit;

import java.util.List;
import java.util.Map;

public record StoreExitPreview(
    Long storeId, Long tenantId, String storeName, String ruleVersion, String planHash,
    Map<String, Long> counts, List<String> retained, List<String> blockers) {
  public StoreExitPreview {
    counts = Map.copyOf(counts);
    retained = List.copyOf(retained);
    blockers = List.copyOf(blockers);
  }

  @com.fasterxml.jackson.annotation.JsonProperty("eligible")
  public boolean eligible() {
    return blockers.isEmpty();
  }
}
