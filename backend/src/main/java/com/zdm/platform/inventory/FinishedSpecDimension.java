package com.zdm.platform.inventory;

import java.util.List;

public record FinishedSpecDimension(String key, String name, List<String> values) {
  public FinishedSpecDimension {
    values = values == null ? List.of() : List.copyOf(values);
  }
}
