package com.zdm.platform.store;

import java.util.List;

public record StoreReferenceSummary(long totalCount, List<StoreReferenceItem> references) {
  public StoreReferenceSummary {
    references = List.copyOf(references);
  }
}
