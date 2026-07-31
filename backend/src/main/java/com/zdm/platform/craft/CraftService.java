package com.zdm.platform.craft;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

@Service
public class CraftService extends ServiceImpl<CraftMapper, Craft> {
  private static final String DEFAULT_CREATED_BY_NAME = "韩健";

  private final JdbcTemplate jdbcTemplate;

  public CraftService(JdbcTemplate jdbcTemplate) {
    this.jdbcTemplate = jdbcTemplate;
  }

  @Transactional
  public Craft createCraft(Craft craft) {
    craft.setId(null);
    craft.setCreatedByName(resolveCreatedByName());
    save(craft);
    return craft;
  }

  @Transactional
  public Craft updateCraft(Long id, Craft payload) {
    Craft existing = getById(id);
    if (existing == null) {
      return null;
    }

    payload.setId(id);
    payload.setCreatedByName(existing.getCreatedByName());
    updateById(payload);
    return getById(id);
  }

  private String resolveCreatedByName() {
    Long accountId = currentAccountId();
    if (accountId == null) {
      return DEFAULT_CREATED_BY_NAME;
    }
    return jdbcTemplate.query(
        """
        SELECT name
        FROM employees
        WHERE account_id = ?
          AND status = 'enabled'
        ORDER BY id DESC
        LIMIT 1
        """,
        (rs, rowNum) -> rs.getString("name"),
        accountId)
        .stream()
        .filter(StringUtils::hasText)
        .findFirst()
        .orElse(DEFAULT_CREATED_BY_NAME);
  }

  private Long currentAccountId() {
    Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
    if (authentication == null || authentication.getPrincipal() == null) {
      return null;
    }
    String principal = String.valueOf(authentication.getPrincipal());
    if (!principal.startsWith("account:")) {
      return null;
    }
    try {
      return Long.parseLong(principal.substring("account:".length()));
    } catch (NumberFormatException ex) {
      return null;
    }
  }
}
