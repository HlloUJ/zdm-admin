package com.zdm.platform.security;

import java.util.Optional;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;

@Component
public class CurrentIdentityProvider {
  private final com.zdm.platform.storeexit.StoreExitRecoveryState exits;
  public CurrentIdentityProvider(com.zdm.platform.storeexit.StoreExitRecoveryState exits) { this.exits = exits; }
  public Optional<CurrentIdentity> current() {
    Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
    if (authentication == null || !(authentication.getPrincipal() instanceof CurrentIdentity identity)) {
      return Optional.empty();
    }
    return Optional.of(identity);
  }

  public CurrentIdentity require() {
    CurrentIdentity identity = current().orElseThrow(() -> new AccessDeniedException("当前业务身份无效"));
    exits.requireAvailable(identity.storeId());
    return identity;
  }
}
