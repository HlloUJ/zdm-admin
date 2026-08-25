package com.zdm.platform.tenant;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.zdm.platform.security.CurrentIdentity;
import com.zdm.platform.security.CurrentIdentityProvider;
import java.util.Arrays;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
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

  public TenantService(
      JdbcTemplate jdbcTemplate,
      CurrentIdentityProvider identityProvider) {
    this.jdbcTemplate = jdbcTemplate;
    this.identityProvider = identityProvider;
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
    tenant.setCreatedByAccountId(identityProvider.require().accountId());
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
    List<String> businesses = normalizeBusinesses(businessTypes);
    existing.setBusinessTypes(String.join(",", businesses));
    updateById(existing);
    syncBusinesses(id, businesses);
    return getById(id);
  }

  @Transactional
  public Tenant updateStatus(Long id, String status) {
    Tenant existing = requireTenant(id);
    if (!Set.of("enabled", "disabled").contains(status)) {
      throw new IllegalArgumentException("存在无效的租户状态");
    }
    existing.setStatus(status);
    updateById(existing);
    if ("disabled".equals(status)) {
      jdbcTemplate.update(
          """
          UPDATE stores
          SET status = 'disabled', archived_by_tenant = 1
          WHERE tenant_id = ? AND status = 'enabled'
          """,
          id);
      jdbcTemplate.update(
          """
          UPDATE auth_sessions
          SET revoked_at = CURRENT_TIMESTAMP
          WHERE revoked_at IS NULL
            AND identity_id IN (SELECT id FROM account_identities WHERE tenant_id = ?)
          """,
          id);
    } else {
      jdbcTemplate.update(
          """
          UPDATE stores
          SET status = 'enabled', archived_by_tenant = 0
          WHERE tenant_id = ?
            AND status = 'disabled'
            AND archived_by_tenant = 1
          """,
          id);
    }
    return getById(id);
  }

  public TenantPurgePreview getPurgePreview(Long id) {
    Tenant existing = requireTenant(id);
    return buildPurgePreview(existing);
  }

  @Transactional
  public TenantPurgeResult purgeTenant(Long id, String confirmationName) {
    Tenant existing = lockTenant(id);
    if (!existing.getName().equals(confirmationName)) {
      throw new IllegalArgumentException("请输入完整租户名称确认删除");
    }
    TenantPurgePreview preview = buildPurgePreview(existing);
    if (!preview.eligible()) {
      throw new IllegalArgumentException(preview.blockers().getFirst());
    }

    List<Long> candidateAccountIds = findTenantAccountIds(id);
    Set<Long> retainedAccountIds = findRetainedAccountIds(id, candidateAccountIds);
    List<Long> deletedAccountIds = candidateAccountIds.stream()
        .filter(accountId -> !retainedAccountIds.contains(accountId))
        .toList();

    jdbcTemplate.update(
        "DELETE FROM auth_sessions WHERE identity_id IN (SELECT id FROM account_identities WHERE tenant_id = ?)",
        id);
    deleteSessionsForAccounts(deletedAccountIds);
    jdbcTemplate.update("DELETE FROM account_roles WHERE tenant_id = ?", id);
    jdbcTemplate.update(
        "DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE tenant_id = ?)",
        id);
    jdbcTemplate.update("DELETE FROM account_identities WHERE tenant_id = ?", id);
    deleteTenantProductCategories(id);
    jdbcTemplate.update("DELETE FROM employee_invites WHERE tenant_id = ?", id);
    int employeeDeleteCount = jdbcTemplate.update("DELETE FROM employees WHERE tenant_id = ?", id);
    int roleDeleteCount = jdbcTemplate.update("DELETE FROM roles WHERE tenant_id = ?", id);
    deleteTenantStoreCategories(id);
    int storeDeleteCount = jdbcTemplate.update("DELETE FROM stores WHERE tenant_id = ?", id);
    jdbcTemplate.update("DELETE FROM tenant_businesses WHERE tenant_id = ?", id);
    int tenantDeleteCount = jdbcTemplate.update("DELETE FROM tenants WHERE id = ?", id);
    deleteAccounts(deletedAccountIds);
    return new TenantPurgeResult(
        tenantDeleteCount,
        storeDeleteCount,
        employeeDeleteCount,
        roleDeleteCount,
        deletedAccountIds.size(),
        retainedAccountIds.size());
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

  private Tenant lockTenant(Long id) {
    return jdbcTemplate.query(
        "SELECT * FROM tenants WHERE id = ? FOR UPDATE",
        (rs, rowNum) -> {
          Tenant tenant = new Tenant();
          tenant.setId(rs.getLong("id"));
          tenant.setName(rs.getString("name"));
          tenant.setContactName(rs.getString("contact_name"));
          tenant.setContactPhone(rs.getString("contact_phone"));
          tenant.setStatus(rs.getString("status"));
          tenant.setCreatedByName(rs.getString("created_by_name"));
          tenant.setCreatedByAccountId(rs.getObject("created_by_account_id", Long.class));
          return tenant;
        },
        id).stream().findFirst().orElseThrow(() -> new IllegalArgumentException("租户不存在或已删除"));
  }

  private TenantPurgePreview buildPurgePreview(Tenant tenant) {
    Long tenantId = tenant.getId();
    List<String> blockers = new ArrayList<>();
    if (!"disabled".equals(tenant.getStatus())) {
      blockers.add("请先归档租户");
    }
    if (count(
        """
        SELECT COUNT(*)
        FROM finished_products fp
        JOIN product_categories pc ON pc.id = fp.category_id
        WHERE pc.tenant_id = ?
        """,
        tenantId) > 0
        || count(
            """
            SELECT COUNT(*)
            FROM product_categories child
            JOIN product_categories parent ON parent.id = child.parent_id
            WHERE parent.tenant_id = ?
              AND (child.tenant_id IS NULL OR child.tenant_id <> ?)
            """,
            tenantId,
            tenantId) > 0) {
      blockers.add("该租户存在暂不支持删除的跨组织业务数据");
    }

    List<Long> candidateAccountIds = findTenantAccountIds(tenantId);
    Set<Long> retainedAccountIds = findRetainedAccountIds(tenantId, candidateAccountIds);
    int accountDeleteCount = candidateAccountIds.size() - retainedAccountIds.size();
    return new TenantPurgePreview(
        blockers.isEmpty(),
        tenant.getName(),
        count("SELECT COUNT(*) FROM stores WHERE tenant_id = ?", tenantId),
        count("SELECT COUNT(*) FROM employees WHERE tenant_id = ?", tenantId),
        count("SELECT COUNT(*) FROM roles WHERE tenant_id = ?", tenantId),
        accountDeleteCount,
        retainedAccountIds.size(),
        blockers);
  }

  private List<Long> findTenantAccountIds(Long tenantId) {
    return jdbcTemplate.queryForList(
        """
        SELECT DISTINCT account_id
        FROM (
          SELECT account_id FROM account_identities WHERE tenant_id = ?
          UNION ALL
          SELECT account_id FROM employees WHERE tenant_id = ? AND account_id IS NOT NULL
          UNION ALL
          SELECT account_id FROM account_roles WHERE tenant_id = ?
        ) tenant_accounts
        WHERE account_id IS NOT NULL
        ORDER BY account_id
        """,
        Long.class,
        tenantId,
        tenantId,
        tenantId);
  }

  private Set<Long> findRetainedAccountIds(Long tenantId, List<Long> accountIds) {
    Set<Long> retained = new HashSet<>();
    for (Long accountId : accountIds) {
      if (hasExternalAccountReference(tenantId, accountId)) {
        retained.add(accountId);
      }
    }
    return retained;
  }

  private boolean hasExternalAccountReference(Long tenantId, Long accountId) {
    if (count(
        "SELECT COUNT(*) FROM account_identities WHERE account_id = ? AND (tenant_id IS NULL OR tenant_id <> ?)",
        accountId,
        tenantId) > 0
        || count(
            "SELECT COUNT(*) FROM employees WHERE account_id = ? AND (tenant_id IS NULL OR tenant_id <> ?)",
            accountId,
            tenantId) > 0
        || count(
            "SELECT COUNT(*) FROM account_roles WHERE account_id = ? AND (tenant_id IS NULL OR tenant_id <> ?)",
            accountId,
            tenantId) > 0
        || count(
            "SELECT COUNT(*) FROM tenants WHERE created_by_account_id = ? AND id <> ?",
            accountId,
            tenantId) > 0
        || count(
            "SELECT COUNT(*) FROM employee_invites WHERE created_by_account_id = ? AND tenant_id <> ?",
            accountId,
            tenantId) > 0
        || count(
            "SELECT COUNT(*) FROM employees WHERE created_by_account_id = ? AND (tenant_id IS NULL OR tenant_id <> ?)",
            accountId,
            tenantId) > 0
        || count(
            "SELECT COUNT(*) FROM roles WHERE created_by_account_id = ? AND (tenant_id IS NULL OR tenant_id <> ?)",
            accountId,
            tenantId) > 0
        || count(
            "SELECT COUNT(*) FROM product_categories WHERE created_by_account_id = ? AND (tenant_id IS NULL OR tenant_id <> ?)",
            accountId,
            tenantId) > 0) {
      return true;
    }
    for (String table : List.of(
        "store_levels",
        "product_attributes",
        "product_attribute_values",
        "category_attributes",
        "crafts",
        "slab_varieties",
        "slab_origins",
        "slab_textures",
        "slab_colors",
        "slab_color_categories",
        "slab_grades",
        "suppliers")) {
      if (count("SELECT COUNT(*) FROM " + table + " WHERE created_by_account_id = ?", accountId) > 0) {
        return true;
      }
    }
    return false;
  }

  private void deleteTenantProductCategories(Long tenantId) {
    List<Map<String, Object>> categoryRows = jdbcTemplate.queryForList(
        "SELECT id, parent_id FROM product_categories WHERE tenant_id = ?",
        tenantId);
    Set<Long> remaining = new LinkedHashSet<>();
    Map<Long, Long> parents = new HashMap<>();
    for (Map<String, Object> row : categoryRows) {
      Long id = ((Number) row.get("id")).longValue();
      remaining.add(id);
      Object parentId = row.get("parent_id");
      parents.put(id, parentId == null ? null : ((Number) parentId).longValue());
    }
    if (remaining.isEmpty()) {
      return;
    }
    jdbcTemplate.update(
        """
        DELETE cavb FROM category_attribute_value_bindings cavb
        JOIN category_attributes ca ON ca.id = cavb.category_attribute_id
        JOIN product_categories pc ON pc.id = ca.category_id
        WHERE pc.tenant_id = ?
        """,
        tenantId);
    jdbcTemplate.update(
        "DELETE ca FROM category_attributes ca JOIN product_categories pc ON pc.id = ca.category_id WHERE pc.tenant_id = ?",
        tenantId);
    while (!remaining.isEmpty()) {
      List<Long> leaves = remaining.stream()
          .filter(id -> remaining.stream().noneMatch(other -> id.equals(parents.get(other))))
          .toList();
      if (leaves.isEmpty()) {
        throw new IllegalStateException("租户商品分类层级异常，无法安全删除");
      }
      for (Long categoryId : leaves) {
        jdbcTemplate.update("DELETE FROM product_categories WHERE id = ?", categoryId);
        remaining.remove(categoryId);
      }
    }
  }

  private void deleteSessionsForAccounts(List<Long> accountIds) {
    for (Long accountId : accountIds) {
      jdbcTemplate.update("DELETE FROM auth_sessions WHERE account_id = ?", accountId);
    }
  }

  private void deleteTenantStoreCategories(Long tenantId) {
    int deletedCount;
    do {
      deletedCount = jdbcTemplate.update(
          """
          DELETE category
          FROM store_categories category
          JOIN stores store ON store.id = category.store_id
          LEFT JOIN store_categories child ON child.parent_id = category.id
          WHERE store.tenant_id = ? AND child.id IS NULL
          """,
          tenantId);
    } while (deletedCount > 0);
  }

  private void deleteAccounts(List<Long> accountIds) {
    for (Long accountId : accountIds) {
      jdbcTemplate.update("DELETE FROM accounts WHERE id = ?", accountId);
    }
  }

  private int count(String sql, Object... args) {
    Integer value = jdbcTemplate.queryForObject(sql, Integer.class, args);
    return value == null ? 0 : value;
  }
}
