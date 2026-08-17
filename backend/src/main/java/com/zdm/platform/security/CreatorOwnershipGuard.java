package com.zdm.platform.security;

import java.util.Objects;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Component;

@Component
public class CreatorOwnershipGuard {
  public static final String OTHER_CREATOR_MESSAGE = "不可操作其他用户添加的数据";

  private final CurrentIdentityProvider identityProvider;

  public CreatorOwnershipGuard(CurrentIdentityProvider identityProvider) {
    this.identityProvider = identityProvider;
  }

  public Long currentAccountId() {
    return identityProvider.require().accountId();
  }

  public void requireCreator(Long createdByAccountId, String createdByName) {
    CurrentIdentity identity = identityProvider.require();
    boolean ownsData = createdByAccountId != null
        ? Objects.equals(createdByAccountId, identity.accountId())
        : Objects.equals(createdByName, identity.displayName());
    if (!ownsData) {
      throw new AccessDeniedException(OTHER_CREATOR_MESSAGE);
    }
  }
}
