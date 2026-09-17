package com.zdm.platform.security;

import java.util.List;
import org.springframework.security.access.AccessDeniedException;

public final class ManagedClientScope {
  private ManagedClientScope() {}

  public static String resolve(CurrentIdentity identity, String requested) {
    String target = requested == null ? identity.clientCode() : requested;
    if (!List.of("admin", "supply-chain").contains(target)) {
      throw new AccessDeniedException("未知的业务端");
    }
    if (target.equals(identity.clientCode())) { return target; }
    if ("admin".equals(identity.clientCode()) && identity.tenantId() == null && identity.storeId() == null) {
      return target;
    }
    throw new AccessDeniedException("当前身份不能管理其他业务端");
  }
}
