package com.zdm.platform.supplier;

import com.zdm.platform.common.ProductFormSupplierDirectory;
import com.zdm.platform.security.PermissionGuard;
import java.util.List;
import org.springframework.stereotype.Service;

@Service
public class ProductFormSupplierService implements ProductFormSupplierDirectory {
  private final SupplierService service;
  private final PermissionGuard guard;

  public ProductFormSupplierService(SupplierService service, PermissionGuard guard) {
    this.service = service;
    this.guard = guard;
  }

  @Override
  public List<ProductFormSupplierDirectory.Supplier> suppliers() {
    return guard.filterData(service.listSuppliers()).stream()
        .map(item -> new ProductFormSupplierDirectory.Supplier(item.getId(), item.getName(), item.getStatus(),
            item.getSupplyTypeIds(), item.getSupplyTypes().stream()
                .map(type -> new SupplyType(type.getId(), type.getCode(), type.getName())).toList())).toList();
  }
}
