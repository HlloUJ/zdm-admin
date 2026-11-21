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
    boolean audited = shouldAudit(request);
    SecurityAuditService.AuditContext context = audited ? auditService.capture(identityProvider.current().orElse(null)) : null;
    try {
      filterChain.doFilter(request, response);
    } finally {
      if (audited) {
        auditService.recordCaptured(
            context,
            request.getMethod(),
            request.getRequestURI(),
            response.getStatus());
      }
    }
  }

  private boolean shouldAudit(HttpServletRequest request) {
    return request.getRequestURI().startsWith("/api/admin/")
        && (AUDITED_METHODS.contains(request.getMethod())
            || ("GET".equals(request.getMethod()) && request.getRequestURI().matches("/api/admin/(stores|tenants)/[0-9]+/purge-preview")));
  }
}
