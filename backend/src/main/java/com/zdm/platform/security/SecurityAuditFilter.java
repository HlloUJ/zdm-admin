package com.zdm.platform.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.Set;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
public class SecurityAuditFilter extends OncePerRequestFilter {
  private static final Set<String> AUDITED_METHODS = Set.of("POST", "PUT", "PATCH", "DELETE");

  private final CurrentIdentityProvider identityProvider;
  private final SecurityAuditService auditService;

  public SecurityAuditFilter(CurrentIdentityProvider identityProvider, SecurityAuditService auditService) {
    this.identityProvider = identityProvider;
    this.auditService = auditService;
  }

  @Override
  protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
      throws ServletException, IOException {
    try {
      filterChain.doFilter(request, response);
    } finally {
      if (shouldAudit(request)) {
        auditService.record(
            identityProvider.current().orElse(null),
            request.getMethod(),
            request.getRequestURI(),
            response.getStatus());
      }
    }
  }

  private boolean shouldAudit(HttpServletRequest request) {
    return request.getRequestURI().startsWith("/api/admin/")
        && AUDITED_METHODS.contains(request.getMethod());
  }
}
