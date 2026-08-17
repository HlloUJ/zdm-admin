package com.zdm.platform.store;

import java.util.List;

public record StoreReferenceItem(String code, String name, long count, List<String> examples) {
  public StoreReferenceItem {
    examples = List.copyOf(examples);
  }
}
