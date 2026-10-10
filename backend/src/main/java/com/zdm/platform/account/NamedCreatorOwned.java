package com.zdm.platform.account;

/** Only the creator display contract; ownership and data permissions remain separate. */
public interface NamedCreatorOwned {
  Long getCreatedByAccountId();
  void setCreatedByName(String name);
}
