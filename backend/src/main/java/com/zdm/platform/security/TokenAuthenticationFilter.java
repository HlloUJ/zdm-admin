package com.zdm.platform.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.List;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
public class TokenAuthenticationFilter extends OncePerRequestFilter {
  public static final String DEV_TOKEN = "dev-token";
  public static final String ACCOUNT_TOKEN_PREFIX = DEV_TOKEN + ":";

  public static String createAccountToken(Long accountId) {
    if (accountId == null) {
      return DEV_TOKEN;
    }
    return ACCOUNT_TOKEN_PREFIX + accountId;
  }

  @Override
  protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
      throws ServletException, IOException {
    String authorization = request.getHeader("Authorization");
    String token = authorization == null || !authorization.startsWith("Bearer ") ? "" : authorization.substring(7);
    String principal = resolvePrincipal(token);
    if (principal != null) {
      var authentication = new UsernamePasswordAuthenticationToken(
          principal,
          null,
          List.of(new SimpleGrantedAuthority("ROLE_ADMIN")));
      SecurityContextHolder.getContext().setAuthentication(authentication);
    }
    filterChain.doFilter(request, response);
  }

  private String resolvePrincipal(String token) {
    if (DEV_TOKEN.equals(token)) {
      return "admin";
    }
    if (!token.startsWith(ACCOUNT_TOKEN_PREFIX)) {
      return null;
    }
    String accountId = token.substring(ACCOUNT_TOKEN_PREFIX.length());
    if (accountId.isBlank() || !accountId.chars().allMatch(Character::isDigit)) {
      return null;
    }
    return "account:" + accountId;
  }
}
