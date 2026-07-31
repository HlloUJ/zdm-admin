package com.zdm.platform.security;

import com.zdm.platform.auth.AuthAccount;
import com.zdm.platform.auth.AuthAccountMapper;
import com.zdm.platform.common.FunctionPermissionNormalizer;
import com.zdm.platform.config.SecurityProperties;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.LocalDateTime;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

@Service
public class SessionTokenService {
  private static final SecureRandom SECURE_RANDOM = new SecureRandom();
  private static final String DEV_TOKEN = "dev-token";
  private static final String DEV_ACCOUNT_TOKEN_PREFIX = DEV_TOKEN + ":";

  private record SessionRecord(Long id, Long identityId) {}

  private final JdbcTemplate jdbcTemplate;
  private final AuthAccountMapper authAccountMapper;
  private final SecurityProperties securityProperties;

  public SessionTokenService(
      JdbcTemplate jdbcTemplate,
      AuthAccountMapper authAccountMapper,
      SecurityProperties securityProperties) {
    this.jdbcTemplate = jdbcTemplate;
    this.authAccountMapper = authAccountMapper;
    this.securityProperties = securityProperties;
  }

  @Transactional
  public String issue(AuthAccount account) {
    byte[] tokenBytes = new byte[32];
    SECURE_RANDOM.nextBytes(tokenBytes);
    String token = Base64.getUrlEncoder().withoutPadding().encodeToString(tokenBytes);
    LocalDateTime expiresAt = LocalDateTime.now().plus(securityProperties.getSessionDuration());
    jdbcTemplate.update(
        """
        INSERT INTO auth_sessions
          (token_hash, account_id, identity_id, client_code, expires_at, last_used_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        """,
        hash(token),
        account.getId(),
        account.getIdentityId(),
        account.getClientCode(),
        expiresAt);
    return token;
  }

  @Transactional
  public CurrentIdentity authenticate(String token) {
    if (!StringUtils.hasText(token)) {
      return null;
    }
    if (securityProperties.isDevTokensEnabled() && isDevelopmentToken(token)) {
      return authenticateDevelopmentToken(token);
    }

    SessionRecord session = jdbcTemplate.query(
        """
        SELECT s.id, s.identity_id
        FROM auth_sessions s
        JOIN accounts a ON a.id = s.account_id AND a.status = 'enabled'
        JOIN account_identities ai
          ON ai.id = s.identity_id
         AND ai.account_id = s.account_id
         AND ai.client_code = s.client_code
         AND ai.status = 'enabled'
        JOIN employees e
          ON e.id = ai.subject_id
         AND e.account_id = a.id
         AND e.status = 'enabled'
        WHERE s.token_hash = ?
          AND s.client_code = 'admin'
          AND s.revoked_at IS NULL
          AND s.expires_at > CURRENT_TIMESTAMP
        LIMIT 1
        """,
        (rs, rowNum) -> new SessionRecord(rs.getLong("id"), rs.getLong("identity_id")),
        hash(token))
        .stream()
        .findFirst()
        .orElse(null);
    if (session == null) {
      return null;
    }

    AuthAccount account = authAccountMapper.findByIdentityId(session.identityId());
    if (account == null) {
      return null;
    }
    jdbcTemplate.update("UPDATE auth_sessions SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?", session.id());
    return toCurrentIdentity(session.id(), account);
  }

  @Transactional
  public void revoke(Long sessionId) {
    if (sessionId != null) {
      jdbcTemplate.update(
          "UPDATE auth_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE id = ? AND revoked_at IS NULL",
          sessionId);
    }
  }

  public static String createDevelopmentAccountToken(Long accountId) {
    return accountId == null ? DEV_TOKEN : DEV_ACCOUNT_TOKEN_PREFIX + accountId;
  }

  private CurrentIdentity authenticateDevelopmentToken(String token) {
    Long accountId = developmentAccountId(token);
    if (accountId == null) {
      return null;
    }
    AuthAccount account = authAccountMapper.findLatestEnabledByAccountId(accountId);
    return account == null ? null : toCurrentIdentity(null, account);
  }

  private CurrentIdentity toCurrentIdentity(Long sessionId, AuthAccount account) {
    List<String> roles = authAccountMapper.findAdminRoleCodes(account.getId(), account.getIdentityId());
    if (roles.isEmpty()) {
      return null;
    }
    List<String> permissions = FunctionPermissionNormalizer.normalize(
        authAccountMapper.findAdminPermissionValues(account.getId(), account.getIdentityId()));
    return new CurrentIdentity(
        sessionId,
        account.getId(),
        account.getIdentityId(),
        account.getEmployeeId(),
        account.getClientCode(),
        account.getTenantId(),
        account.getStoreId(),
        account.getDisplayName(),
        account.getDataPermission(),
        roles,
        permissions);
  }

  private boolean isDevelopmentToken(String token) {
    return DEV_TOKEN.equals(token) || token.startsWith(DEV_ACCOUNT_TOKEN_PREFIX);
  }

  private Long developmentAccountId(String token) {
    if (DEV_TOKEN.equals(token)) {
      return 1L;
    }
    String accountId = token.substring(DEV_ACCOUNT_TOKEN_PREFIX.length());
    if (accountId.isBlank() || !accountId.chars().allMatch(Character::isDigit)) {
      return null;
    }
    try {
      return Long.valueOf(accountId);
    } catch (NumberFormatException ex) {
      return null;
    }
  }

  private String hash(String token) {
    try {
      byte[] digest = MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8));
      return HexFormat.of().formatHex(digest);
    } catch (NoSuchAlgorithmException ex) {
      throw new IllegalStateException("SHA-256 is unavailable", ex);
    }
  }
}
