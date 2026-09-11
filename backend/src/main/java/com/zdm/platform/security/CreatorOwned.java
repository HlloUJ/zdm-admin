package com.zdm.platform.security;

/** Stable account ownership, independent of display names and organization scope. */
public interface CreatorOwned {
  Long getCreatedByAccountId();
  void setCreatedByAccountId(Long accountId);
}
