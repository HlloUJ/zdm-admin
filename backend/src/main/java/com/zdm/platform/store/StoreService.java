package com.zdm.platform.store;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.zdm.platform.security.CurrentIdentity;
import com.zdm.platform.security.CurrentIdentityProvider;
import com.zdm.platform.security.CreatorOwnershipGuard;
import java.util.List;
import java.util.Objects;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class StoreService extends ServiceImpl<StoreMapper, Store> {
  private static final String DELETE_FAILED_MESSAGE = "门店经营数据删除失败，请稍后重试";
  private static final String DUPLICATE_NAME_MESSAGE = "店铺名称已存在";

  private final CurrentIdentityProvider identityProvider;
  private final CreatorOwnershipGuard ownershipGuard;
  private final StoreLevelService storeLevelService;
  private final JdbcTemplate jdbcTemplate;

  public StoreService(
      CurrentIdentityProvider identityProvider,
      CreatorOwnershipGuard ownershipGuard,
      StoreLevelService storeLevelService,
      JdbcTemplate jdbcTemplate) {
    this.identityProvider = identityProvider;
    this.ownershipGuard = ownershipGuard;
    this.storeLevelService = storeLevelService;
    this.jdbcTemplate = jdbcTemplate;
  }

  public List<Store> listForCurrentAdmin(boolean archived) {
    identityProvider.require();
    return lambdaQuery()
        .eq(archived, Store::getStatus, "archived")
        .ne(!archived, Store::getStatus, "archived")
        .orderByDesc(Store::getCreatedAt)
        .list();
  }

  @Transactional
  public boolean createStore(Store store) {
    CurrentIdentity identity = identityProvider.require();
    store.setId(null);
    normalizeAndValidateName(store, null);
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
    requireOperating(existing);
    normalizeAndValidateName(payload, id);
    payload.setTenantId(existing.getTenantId());
    if (!Objects.equals(existing.getType(), payload.getType())) {
      requireOpenedBusiness(existing.getTenantId(), payload.getType());
    }
    payload.setId(id);
    payload.setStoreLevelId(existing.getStoreLevelId());
    payload.setStatus(existing.getStatus());
    payload.setCreatedBy(existing.getCreatedBy());
    updateById(payload);
    return getById(id);
  }

  @Transactional
  public Store updateLevel(Long id, Long storeLevelId) {
    Store existing = getById(id);
    if (existing == null) {
      return null;
    }
    requireAccessible(existing);
    requireOperating(existing);
    storeLevelService.requireSelectable(storeLevelId);
    existing.setStoreLevelId(storeLevelId);
    updateById(existing);
    return getById(id);
  }

  @Transactional
  public Store updateStatus(Long id, String status) {
    Store existing = getById(id);
    if (existing == null) {
      return null;
    }
    requireAccessible(existing);
    requireOperating(existing);
    existing.setStatus(status);
    updateById(existing);
    jdbcTemplate.update(
        "UPDATE account_identities SET status = ? WHERE store_id = ? AND identity_type = 'store_admin'",
        status,
        id);
    return getById(id);
  }

  @Transactional
  public Store archiveStore(Long id) {
    Store existing = getById(id);
    if (existing == null) {
      return null;
    }
    requireAccessible(existing);
    requireOperating(existing);
    existing.setStatus("archived");
    updateById(existing);
    revokeStoreSessions(id);
    return getById(id);
  }

  @Transactional
  public Store restoreStore(Long id) {
    Store existing = getById(id);
    if (existing == null) {
      return null;
    }
    requireAccessible(existing);
    requireArchived(existing);
    existing.setStatus("enabled");
    updateById(existing);
    jdbcTemplate.update(
        "UPDATE account_identities SET status = 'enabled' WHERE store_id = ? AND identity_type = 'store_admin'",
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
    requireArchived(existing);
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
      jdbcTemplate.update("DELETE FROM employees WHERE store_id = ?", id);
      deleteStoreCategories(id);
      return removeById(id);
    } catch (DataIntegrityViolationException exception) {
      throw new IllegalArgumentException(DELETE_FAILED_MESSAGE, exception);
    }
  }

  private void revokeStoreSessions(Long storeId) {
    jdbcTemplate.update(
        """
        UPDATE auth_sessions
        SET revoked_at = CURRENT_TIMESTAMP
        WHERE revoked_at IS NULL
          AND identity_id IN (SELECT id FROM account_identities WHERE store_id = ?)
        """,
        storeId);
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

  private void normalizeAndValidateName(Store store, Long excludedStoreId) {
    String storeName = store.getName().trim();
    store.setName(storeName);
    var duplicateQuery = lambdaQuery().eq(Store::getName, storeName);
    if (excludedStoreId != null) {
      duplicateQuery.ne(Store::getId, excludedStoreId);
    }
    if (duplicateQuery.count() > 0) {
      throw new IllegalArgumentException(DUPLICATE_NAME_MESSAGE);
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
    ownershipGuard.requireCreator(null, store.getCreatedBy());
  }

  private void requireOperating(Store store) {
    if ("archived".equals(store.getStatus())) {
      throw new IllegalArgumentException("该门店已归档");
    }
  }

  private void requireArchived(Store store) {
    if (!"archived".equals(store.getStatus())) {
      throw new IllegalArgumentException("请先归档门店");
    }
  }
}
