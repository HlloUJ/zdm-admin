package com.zdm.platform.store;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.zdm.platform.security.CurrentIdentity;
import com.zdm.platform.security.CurrentIdentityProvider;
import java.util.List;
import java.util.Objects;
import java.util.function.LongFunction;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class StoreService extends ServiceImpl<StoreMapper, Store> {
  private static final String REFERENCED_MESSAGE = "该门店存在关联数据，不能删除，请先处理关联数据或停用该门店";

  private final CurrentIdentityProvider identityProvider;
  private final StoreLevelService storeLevelService;
  private final JdbcTemplate jdbcTemplate;

  public StoreService(
      CurrentIdentityProvider identityProvider,
      StoreLevelService storeLevelService,
      JdbcTemplate jdbcTemplate) {
    this.identityProvider = identityProvider;
    this.storeLevelService = storeLevelService;
    this.jdbcTemplate = jdbcTemplate;
  }

  public List<Store> listForCurrentAdmin() {
    CurrentIdentity identity = identityProvider.require();
    if (identity.isSuperAdmin() || "all".equals(identity.dataPermission())) {
      return list();
    }
    return lambdaQuery().eq(Store::getCreatedBy, identity.displayName()).list();
  }

  @Transactional
  public boolean createStore(Store store) {
    CurrentIdentity identity = identityProvider.require();
    requireOpenedBusiness(store.getTenantId(), store.getType());
    storeLevelService.requireSelectable(store.getStoreLevelId());
    store.setCreatedBy(identity.displayName());
    boolean saved = save(store);
    provisionStoreAdmins(store);
    return saved;
  }

  @Transactional
  public Store updateStore(Long id, Store payload) {
    Store existing = getById(id);
    if (existing == null) {
      return null;
    }
    requireAccessible(existing);
    payload.setTenantId(existing.getTenantId());
    if (!Objects.equals(existing.getType(), payload.getType())) {
      requireOpenedBusiness(existing.getTenantId(), payload.getType());
    }
    if (!Objects.equals(existing.getStoreLevelId(), payload.getStoreLevelId())) {
      storeLevelService.requireSelectable(payload.getStoreLevelId());
    }
    payload.setId(id);
    payload.setCreatedBy(existing.getCreatedBy());
    updateById(payload);
    jdbcTemplate.update(
        "UPDATE account_identities SET status = ? WHERE store_id = ? AND identity_type = 'store_admin'",
        payload.getStatus(),
        id);
    return getById(id);
  }

  @Transactional
  public boolean deleteStore(Long id) {
    Store existing = getById(id);
    if (existing == null) {
      return false;
    }
    requireAccessible(existing);
    StoreReferenceSummary summary = getReferenceSummary(id);
    if (summary.totalCount() > 0) {
      throw new IllegalArgumentException(referenceMessage(summary));
    }
    try {
      jdbcTemplate.update(
          "DELETE FROM auth_sessions WHERE identity_id IN (SELECT id FROM account_identities WHERE store_id = ?)",
          id);
      jdbcTemplate.update(
          "DELETE FROM account_roles WHERE store_id = ? OR role_id IN (SELECT id FROM roles WHERE store_id = ?)",
          id,
          id);
      jdbcTemplate.update(
          "DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE store_id = ?)",
          id);
      jdbcTemplate.update("DELETE FROM roles WHERE store_id = ?", id);
      jdbcTemplate.update("DELETE FROM account_identities WHERE store_id = ?", id);
      jdbcTemplate.update("DELETE FROM employee_invites WHERE store_id = ?", id);
      deleteStoreCategories(id);
      return removeById(id);
    } catch (DataIntegrityViolationException exception) {
      throw new IllegalArgumentException(REFERENCED_MESSAGE, exception);
    }
  }

  private void deleteStoreCategories(Long storeId) {
    int deletedCount;
    do {
      deletedCount = jdbcTemplate.update(
          """
          DELETE category
          FROM store_categories category
          LEFT JOIN store_categories child ON child.parent_id = category.id
          WHERE category.store_id = ? AND child.id IS NULL
          """,
          storeId);
    } while (deletedCount > 0);
  }

  public StoreReferenceSummary getDeletionReferences(Long id) {
    Store existing = getById(id);
    if (existing == null) {
      throw new IllegalArgumentException("门店不存在或已被删除");
    }
    requireAccessible(existing);
    return getReferenceSummary(id);
  }

  private StoreReferenceSummary getReferenceSummary(Long storeId) {
    List<StoreReferenceItem> references = List.of(
        reference(
            storeId,
            "employees",
            "员工",
            "SELECT COUNT(*) FROM employees WHERE store_id = ?",
            id -> jdbcTemplate.queryForList(
                """
                SELECT CONCAT(name, '（', IF(status = 'enabled', '启用', '停用'), '）')
                FROM employees WHERE store_id = ?
                ORDER BY status = 'enabled' DESC, id LIMIT 5
                """,
                String.class,
                id)),
        reference(
            storeId,
            "activeEmployeeInvites",
            "有效员工邀请",
            "SELECT COUNT(*) FROM employee_invites WHERE store_id = ? AND status = 'active' AND expires_at >= CURRENT_TIMESTAMP",
            id -> jdbcTemplate.queryForList(
                """
                SELECT CONCAT('有效至', DATE_FORMAT(expires_at, '%Y-%m-%d %H:%i'))
                FROM employee_invites
                WHERE store_id = ? AND status = 'active' AND expires_at >= CURRENT_TIMESTAMP
                ORDER BY expires_at LIMIT 5
                """,
                String.class,
                id)))
        .stream()
        .filter(reference -> reference.count() > 0)
        .toList();
    long totalCount = references.stream().mapToLong(StoreReferenceItem::count).sum();
    return new StoreReferenceSummary(totalCount, references);
  }

  private StoreReferenceItem reference(
      Long storeId,
      String code,
      String name,
      String countSql,
      LongFunction<List<String>> exampleQuery) {
    Long count = jdbcTemplate.queryForObject(countSql, Long.class, storeId);
    long resolvedCount = count == null ? 0 : count;
    return new StoreReferenceItem(
        code,
        name,
        resolvedCount,
        resolvedCount == 0 ? List.of() : exampleQuery.apply(storeId));
  }

  private String referenceMessage(StoreReferenceSummary summary) {
    String referenceCounts = summary.references().stream()
        .map(reference -> reference.name() + reference.count() + "条")
        .reduce((left, right) -> left + "、" + right)
        .orElse("");
    return REFERENCED_MESSAGE + "（" + referenceCounts + "）";
  }

  private void requireOpenedBusiness(Long tenantId, String storeType) {
    Integer count = jdbcTemplate.queryForObject(
        """
        SELECT COUNT(*)
        FROM tenant_businesses tb
        JOIN tenants t ON t.id = tb.tenant_id AND t.status = 'enabled'
        WHERE tb.tenant_id = ? AND tb.business_type = ? AND tb.status = 'enabled'
        """,
        Integer.class,
        tenantId,
        storeType);
    if (count == null || count == 0) {
      throw new IllegalArgumentException("该租户未启用对应业务，不能创建或变更为该类型门店");
    }
  }

  private void provisionStoreAdmins(Store store) {
    jdbcTemplate.update(
        """
        INSERT INTO account_identities
          (account_id, client_code, identity_type, subject_id, tenant_id, store_id, status)
        SELECT account_id, 'admin', 'store_admin', ?, ?, ?, ?
        FROM account_identities
        WHERE identity_type = 'tenant_admin' AND tenant_id = ? AND status = 'enabled'
        ON DUPLICATE KEY UPDATE status = VALUES(status)
        """,
        store.getId(),
        store.getTenantId(),
        store.getId(),
        store.getStatus(),
        store.getTenantId());
  }

  private void requireAccessible(Store store) {
    CurrentIdentity identity = identityProvider.require();
    if (!identity.isSuperAdmin()
        && !"all".equals(identity.dataPermission())
        && !Objects.equals(store.getCreatedBy(), identity.displayName())) {
      throw new AccessDeniedException("当前数据权限不允许操作该门店");
    }
  }
}
