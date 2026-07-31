package com.zdm.platform.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
public class TokenAuthenticationFilter extends OncePerRequestFilter {
  public static final String DEV_TOKEN = "dev-token";

  private final SessionTokenService sessionTokenService;

  public TokenAuthenticationFilter(SessionTokenService sessionTokenService) {
    this.sessionTokenService = sessionTokenService;
  }

  public static String createAccountToken(Long accountId) {
    return SessionTokenService.createDevelopmentAccountToken(accountId);
  }

  @Override
  protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
      throws ServletException, IOException {
    String authorization = request.getHeader("Authorization");
    String token = authorization == null || !authorization.startsWith("Bearer ") ? "" : authorization.substring(7);
    CurrentIdentity identity = sessionTokenService.authenticate(token);
    if (identity != null) {
      List<SimpleGrantedAuthority> authorities = new ArrayList<>();
      identity.roles().forEach(role -> authorities.add(new SimpleGrantedAuthority("ROLE_" + role)));
      identity.permissions().forEach(permission -> authorities.add(new SimpleGrantedAuthority(permission)));
      var authentication = new UsernamePasswordAuthenticationToken(identity, null, authorities);
      SecurityContextHolder.getContext().setAuthentication(authentication);
    }
    filterChain.doFilter(request, response);
  }
}
