package com.zdm.platform.inventory;

import java.util.List;

public record AccessorySpecDimension(String key, String name, List<String> values) {
  public AccessorySpecDimension {
    values = values == null ? List.of() : List.copyOf(values);
  }
}
