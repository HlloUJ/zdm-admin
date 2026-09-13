package com.zdm.platform.common;

import java.util.List;

/** Read-only supplier options without contact data, scoped to the current identity. */
public interface ProductFormSupplierDirectory {
  record SupplyType(Long id, String code, String name) {}
  record Supplier(Long id, String name, String status, List<Long> supplyTypeIds, List<SupplyType> supplyTypes) {
    public Supplier {
      supplyTypeIds = List.copyOf(supplyTypeIds);
      supplyTypes = List.copyOf(supplyTypes);
    }
  }

  List<Supplier> suppliers();
}
