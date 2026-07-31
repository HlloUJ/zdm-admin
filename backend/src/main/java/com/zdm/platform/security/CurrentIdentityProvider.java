package com.zdm.platform.security;

import java.util.Optional;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;

@Component
public class CurrentIdentityProvider {
  public Optional<CurrentIdentity> current() {
    Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
    if (authentication == null || !(authentication.getPrincipal() instanceof CurrentIdentity identity)) {
      return Optional.empty();
    }
    return Optional.of(identity);
  }

  public CurrentIdentity require() {
    return current().orElseThrow(() -> new AccessDeniedException("当前业务身份无效"));
  }
}
