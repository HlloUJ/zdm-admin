package com.zdm.platform.store;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

@Service
public class StoreService extends ServiceImpl<StoreMapper, Store> {
  private final JdbcTemplate jdbcTemplate;

  public StoreService(JdbcTemplate jdbcTemplate) {
    this.jdbcTemplate = jdbcTemplate;
  }

  public List<Store> listForCurrentAdmin() {
    AdminEmployee currentEmployee = currentAdminEmployee();
    if (currentEmployee == null) {
      return list();
    }
    if ("all".equals(currentEmployee.dataPermission())) {
      return list();
    }
    return lambdaQuery().eq(Store::getCreatedBy, currentEmployee.name()).list();
  }

  @Transactional
  public boolean createStore(Store store) {
    AdminEmployee currentEmployee = currentAdminEmployee();
    if (currentEmployee != null) {
      store.setCreatedBy(currentEmployee.name());
    } else if (!StringUtils.hasText(store.getCreatedBy())) {
      store.setCreatedBy("韩健");
    }
    return save(store);
  }

  private AdminEmployee currentAdminEmployee() {
    Long accountId = currentAccountId();
    if (accountId == null) {
      return null;
    }
    return jdbcTemplate.query(
        """
        SELECT name, data_permission
        FROM employees
        WHERE account_id = ?
          AND status = 'enabled'
        ORDER BY id DESC
        LIMIT 1
        """,
        (rs, rowNum) -> new AdminEmployee(rs.getString("name"), rs.getString("data_permission")),
        accountId)
        .stream()
        .findFirst()
        .orElse(null);
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

  private record AdminEmployee(String name, String dataPermission) {}
}
