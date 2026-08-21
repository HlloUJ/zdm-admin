package com.zdm.platform.inventory;

public enum MarkupProductType {
  FINISHED("finished"),
  SLAB("slab");

  private final String value;

  MarkupProductType(String value) {
    this.value = value;
  }

  public String value() {
    return value;
  }

  public static MarkupProductType require(String value) {
    for (MarkupProductType type : values()) {
      if (type.value.equals(value)) {
        return type;
      }
    }
    throw new IllegalArgumentException("商品类型无效");
  }
}
