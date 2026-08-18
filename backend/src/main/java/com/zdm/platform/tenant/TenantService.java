package com.zdm.platform.tenant;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.zdm.platform.security.CurrentIdentity;
import com.zdm.platform.security.CurrentIdentityProvider;
import com.zdm.platform.security.CreatorOwnershipGuard;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.simple.SimpleJdbcInsert;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

@Service
public class TenantService extends ServiceImpl<TenantMapper, Tenant> {
  private static final String DEFAULT_CREATED_BY_NAME = "韩健";
  private static final Set<String> BUSINESS_TYPES =
      Set.of("cityPartner", "slabSupplier", "finishedSupplier", "factory");

  private final JdbcTemplate jdbcTemplate;
  private final SimpleJdbcInsert accountInsert;
  private final CurrentIdentityProvider identityProvider;
  private final CreatorOwnershipGuard ownershipGuard;

  public TenantService(
      JdbcTemplate jdbcTemplate,
      CurrentIdentityProvider identityProvider,
      CreatorOwnershipGuard ownershipGuard) {
    this.jdbcTemplate = jdbcTemplate;
    this.identityProvider = identityProvider;
    this.ownershipGuard = ownershipGuard;
    this.accountInsert = new SimpleJdbcInsert(jdbcTemplate)
        .withTableName("accounts")
        .usingColumns("phone", "display_name", "account_type", "status")
        .usingGeneratedKeyColumns("id");
  }

  public List<Tenant> listTenants() {
    return lambdaQuery()
        .orderByDesc(Tenant::getCreatedAt)
        .orderByDesc(Tenant::getId)
        .list();
  }

  @Transactional
  public Tenant createTenant(Tenant tenant) {
    List<String> businesses = List.of();
    tenant.setBusinessTypes("");
    tenant.setCreatedByName(resolveCreatedByName());
    tenant.setCreatedByAccountId(ownershipGuard.currentAccountId());
    requireAvailableTenantPhone(tenant.getContactPhone(), null);
    Long accountId;
    try {
      accountId = findOrCreateAccount(tenant.getContactPhone(), tenant.getContactName());
      save(tenant);
    } catch (DuplicateKeyException exception) {
      throw new IllegalArgumentException("该手机号已存在", exception);
    }
    syncBusinesses(tenant.getId(), businesses);
    syncTenantAdminIdentity(tenant, accountId);
    return tenant;
  }

  @Transactional
  public Tenant updateTenant(Long id, Tenant payload) {
    Tenant existing = getById(id);
    if (existing == null) {
      throw new IllegalArgumentException("租户不存在");
    }
    ownershipGuard.requireCreator(
        existing.getCreatedByAccountId(), existing.getCreatedByName());
    Long ownerAccountId = requireOwnerAccountId(id);
    requireAvailableTenantPhone(payload.getContactPhone(), id);
    requireAvailablePhone(payload.getContactPhone(), ownerAccountId);
    payload.setId(id);
    payload.setStatus(existing.getStatus());
    payload.setBusinessTypes(existing.getBusinessTypes());
    payload.setCreatedByName(existing.getCreatedByName());
    payload.setCreatedByAccountId(existing.getCreatedByAccountId());
    try {
      updateById(payload);
      jdbcTemplate.update(
          "UPDATE accounts SET phone = ?, display_name = ? WHERE id = ?",
          payload.getContactPhone(),
          payload.getContactName(),
          ownerAccountId);
    } catch (DuplicateKeyException exception) {
      throw new IllegalArgumentException("该手机号已存在", exception);
    }
    return getById(id);
  }

  @Transactional
  public Tenant updateBusinesses(Long id, String businessTypes) {
    Tenant existing = requireTenant(id);
    ownershipGuard.requireCreator(
        existing.getCreatedByAccountId(), existing.getCreatedByName());
    List<String> businesses = normalizeBusinesses(businessTypes);
    existing.setBusinessTypes(String.join(",", businesses));
    updateById(existing);
    syncBusinesses(id, businesses);
    return getById(id);
  }

  @Transactional
  public Tenant updateStatus(Long id, String status) {
    Tenant existing = requireTenant(id);
    ownershipGuard.requireCreator(
        existing.getCreatedByAccountId(), existing.getCreatedByName());
    if (!Set.of("enabled", "disabled").contains(status)) {
      throw new IllegalArgumentException("存在无效的租户状态");
    }
    existing.setStatus(status);
    updateById(existing);
    syncTenantIdentityStatus(id, status);
    return getById(id);
  }

  @Transactional
  public boolean deleteTenant(Long id) {
    Tenant existing = getById(id);
    if (existing == null) {
      return false;
    }
    ownershipGuard.requireCreator(
        existing.getCreatedByAccountId(), existing.getCreatedByName());
    Integer storeCount = jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM stores WHERE tenant_id = ?", Integer.class, id);
    Integer employeeCount = jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM employees WHERE tenant_id = ?", Integer.class, id);
    if ((storeCount != null && storeCount > 0) || (employeeCount != null && employeeCount > 0)) {
      throw new IllegalArgumentException("该租户已开通门店或存在员工，不能删除，请先停用租户");
    }
    jdbcTemplate.update(
        "DELETE FROM auth_sessions WHERE identity_id IN (SELECT id FROM account_identities WHERE tenant_id = ?)",
        id);
    jdbcTemplate.update("DELETE FROM account_roles WHERE tenant_id = ?", id);
    jdbcTemplate.update("DELETE FROM account_identities WHERE tenant_id = ?", id);
    jdbcTemplate.update("DELETE FROM tenant_businesses WHERE tenant_id = ?", id);
    return removeById(id);
  }

  public boolean hasEnabledBusiness(Long tenantId, String businessType) {
    if (!BUSINESS_TYPES.contains(businessType)) {
      return false;
    }
    Integer count = jdbcTemplate.queryForObject(
        """
        SELECT COUNT(*)
        FROM tenant_businesses tb
        JOIN tenants t ON t.id = tb.tenant_id AND t.status = 'enabled'
        WHERE tb.tenant_id = ? AND tb.business_type = ? AND tb.status = 'enabled'
        """,
        Integer.class,
        tenantId,
        businessType);
    return count != null && count > 0;
  }

  private List<String> normalizeBusinesses(String value) {
    if (!StringUtils.hasText(value)) {
      return List.of();
    }
    List<String> values = Arrays.stream(value.split(","))
        .map(String::trim)
        .filter(StringUtils::hasText)
        .distinct()
        .toList();
    List<String> invalid = values.stream().filter(type -> !BUSINESS_TYPES.contains(type)).toList();
    if (!invalid.isEmpty()) {
      throw new IllegalArgumentException("存在无效的租户业务类型");
    }
    return values;
  }

  private Tenant requireTenant(Long id) {
    Tenant tenant = getById(id);
    if (tenant == null) {
      throw new IllegalArgumentException("租户不存在");
    }
    return tenant;
  }

  private void syncBusinesses(Long tenantId, List<String> businesses) {
    jdbcTemplate.update("DELETE FROM tenant_businesses WHERE tenant_id = ?", tenantId);
    for (String business : businesses) {
      jdbcTemplate.update(
          "INSERT INTO tenant_businesses (tenant_id, business_type, status) VALUES (?, ?, 'enabled')",
          tenantId,
          business);
    }
  }

  private Long findOrCreateAccount(String phone, String displayName) {
    Optional<Long> accountId = findAccountId(phone);
    if (accountId.isPresent()) {
      return accountId.get();
    }
    Map<String, Object> values = new HashMap<>();
    values.put("phone", phone);
    values.put("display_name", displayName);
    values.put("account_type", "person");
    values.put("status", "enabled");
    return accountInsert.executeAndReturnKey(values).longValue();
  }

  private Optional<Long> findAccountId(String phone) {
    return jdbcTemplate.query(
        "SELECT id FROM accounts WHERE phone = ? LIMIT 1",
        (rs, rowNum) -> rs.getLong("id"),
        phone).stream().findFirst();
  }

  private void requireAvailablePhone(String phone, Long ownerAccountId) {
    findAccountId(phone).ifPresent(accountId -> {
      if (!accountId.equals(ownerAccountId)) {
        throw new IllegalArgumentException("该手机号已属于其他账号");
      }
    });
  }

  private void requireAvailableTenantPhone(String phone, Long tenantId) {
    Integer count = tenantId == null
        ? jdbcTemplate.queryForObject(
            "SELECT COUNT(*) FROM tenants WHERE contact_phone = ?", Integer.class, phone)
        : jdbcTemplate.queryForObject(
            "SELECT COUNT(*) FROM tenants WHERE contact_phone = ? AND id <> ?", Integer.class, phone, tenantId);
    if (count != null && count > 0) {
      throw new IllegalArgumentException("该手机号已存在");
    }
  }

  private String resolveCreatedByName() {
    return identityProvider.current()
        .map(CurrentIdentity::displayName)
        .filter(StringUtils::hasText)
        .orElse(DEFAULT_CREATED_BY_NAME);
  }

  private Long requireOwnerAccountId(Long tenantId) {
    return jdbcTemplate.query(
        """
        SELECT account_id FROM account_identities
        WHERE identity_type = 'tenant_admin' AND tenant_id = ?
        ORDER BY id LIMIT 1
        """,
        (rs, rowNum) -> rs.getLong("account_id"),
        tenantId).stream().findFirst().orElseThrow(() -> new IllegalArgumentException("租户管理员身份不存在"));
  }

  private void syncTenantAdminIdentity(Tenant tenant, Long accountId) {
    jdbcTemplate.update(
        """
        INSERT INTO account_identities
          (account_id, client_code, identity_type, subject_id, tenant_id, store_id, status)
        VALUES (?, 'admin', 'tenant_admin', ?, ?, NULL, ?)
        ON DUPLICATE KEY UPDATE account_id = VALUES(account_id), status = VALUES(status)
        """,
        accountId,
        tenant.getId(),
        tenant.getId(),
        tenant.getStatus());
  }

  private void syncTenantIdentityStatus(Long tenantId, String status) {
    jdbcTemplate.update(
        """
        UPDATE account_identities
        SET status = ?
        WHERE tenant_id = ? AND identity_type IN ('tenant_admin', 'store_admin')
        """,
        status,
        tenantId);
  }
}
