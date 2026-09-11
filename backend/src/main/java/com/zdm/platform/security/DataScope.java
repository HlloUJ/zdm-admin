package com.zdm.platform.security;

import java.util.List;
import java.util.Objects;
import org.springframework.security.access.AccessDeniedException;

/** The same scope applies to reading and writing; function/organization checks remain separate. */
public final class DataScope {
  private DataScope() {}

  public static boolean isAll(CurrentIdentity identity) {
    requireConfigured(identity);
    return identity.isSuperAdmin() || "all".equals(identity.dataPermission());
  }

  public static void requireConfigured(CurrentIdentity identity) {
    if (!identity.isSuperAdmin() && !List.of("self", "all").contains(
        Objects.toString(identity.dataPermission(), ""))) {
      throw new AccessDeniedException("尚未配置数据权限");
    }
  }

  public static boolean canAccess(CurrentIdentity identity, Long creatorAccountId) {
    return isAll(identity) || (identity.accountId() != null && creatorAccountId != null
        && identity.accountId().equals(creatorAccountId));
  }

  public static void requireAccess(CurrentIdentity identity, Long creatorAccountId) {
    if (!canAccess(identity, creatorAccountId)) {
      throw new AccessDeniedException("当前数据权限不允许访问该数据");
    }
  }

  public static <T extends CreatorOwned> List<T> filter(CurrentIdentity identity, List<T> records) {
    requireConfigured(identity);
    return records.stream().filter(record -> canAccess(identity, record.getCreatedByAccountId())).toList();
  }
}
