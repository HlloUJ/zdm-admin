package com.zdm.platform.common;

import java.util.List;

/** Public contract used by slab forms without depending on supplier module internals. */
public interface SlabSupplierOptionProvider {
  List<Option> listSelectableSlabSuppliers();

  boolean isSelectableSlabSupplier(Long supplierId);

  record Option(Long id, String label, String status) {}
}
