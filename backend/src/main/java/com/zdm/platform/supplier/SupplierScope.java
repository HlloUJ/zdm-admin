package com.zdm.platform.supplier;

import com.zdm.platform.security.CurrentIdentity;
import org.springframework.security.access.AccessDeniedException;

record SupplierScope(String ownerScope, Long ownerId, Long tenantId, Long storeId) {
  static SupplierScope from(CurrentIdentity identity) {
    if (identity.storeId() != null) {
      if (identity.tenantId() == null) {
        throw new AccessDeniedException("当前经营组织无效");
      }
      return new SupplierScope("store", identity.storeId(), identity.tenantId(), identity.storeId());
    }
    if (identity.tenantId() == null) {
      return new SupplierScope("platform", 0L, null, null);
    }
    throw new AccessDeniedException("请先切换到具体经营组织");
  }
}
