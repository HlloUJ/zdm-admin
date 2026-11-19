package com.zdm.platform.store;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.zdm.platform.security.CurrentIdentity;
import com.zdm.platform.security.CurrentIdentityProvider;
import java.util.List;
import java.util.Objects;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class StoreService extends ServiceImpl<StoreMapper, Store> {
  private static final String DUPLICATE_NAME_MESSAGE = "店铺名称已存在";

  private final com.zdm.platform.role.StoreBuiltinRoleService builtinRoles;
  private final CurrentIdentityProvider identityProvider;
  private final StoreLevelService storeLevelService;
  private final JdbcTemplate jdbcTemplate;
  private final com.zdm.platform.account.AccountLifecycleService accountLifecycle;
  private final com.zdm.platform.storeexit.StoreExitCoordinator exits;
  private final com.zdm.platform.storeexit.HistoricIdentifierGuard historicIds;
  private final com.zdm.platform.storeexit.StoreExitRecoveryState recovery;

  public StoreService(
      com.zdm.platform.role.StoreBuiltinRoleService builtinRoles,
      CurrentIdentityProvider identityProvider,
      StoreLevelService storeLevelService,
      JdbcTemplate jdbcTemplate, com.zdm.platform.account.AccountLifecycleService accountLifecycle,
      com.zdm.platform.storeexit.StoreExitCoordinator exits,
      com.zdm.platform.storeexit.HistoricIdentifierGuard historicIds,
      com.zdm.platform.storeexit.StoreExitRecoveryState recovery) {
    this.recovery = recovery;
    this.historicIds = historicIds;
    this.builtinRoles = builtinRoles;
    this.identityProvider = identityProvider;
    this.storeLevelService = storeLevelService;
    this.jdbcTemplate = jdbcTemplate;
    this.accountLifecycle = accountLifecycle;
    this.exits = exits;
  }

  public List<Store> listForCurrentAdmin(boolean archived) {
    identityProvider.require();
    recovery.requireCatalogAvailable();
    return lambdaQuery()
        .notIn(!recovery.blockedStoreIds().isEmpty(), Store::getId, recovery.blockedStoreIds())
        .eq(Store::getStatus, archived ? "disabled" : "enabled")
        .orderByDesc(Store::getCreatedAt)
        .list();
  }

  @Transactional
  public boolean createStore(Store store) {
    CurrentIdentity identity = identityProvider.require();
    store.setId(null);
    normalizeAndValidateName(store, null);
    requireOpenedBusiness(store.getTenantId(), store.getType());
    storeLevelService.requireEnabled(store.getStoreLevelId());
    store.setStatus("enabled");
    store.setCreatedBy(identity.displayName());
    store.setCreatedByAccountId(identity.accountId());
    long watermark = historicIds.reserve("stores");
    boolean saved = save(store);
    store.setId(historicIds.skipReserved("stores", store.getId(), watermark));
    builtinRoles.provision(store.getId(), store.getTenantId(), identity.accountId());
    provisionStoreAdmins(store);
    return saved;
  }

  @Transactional
  public Store updateStore(Long id, Store payload) {
    Store existing = getById(id);
    if (existing == null) {
      return null;
    }
    requireOperating(existing);
    normalizeAndValidateName(payload, id);
    payload.setTenantId(existing.getTenantId());
    if (!Objects.equals(existing.getType(), payload.getType())) {
      requireOpenedBusiness(existing.getTenantId(), payload.getType());
    }
    payload.setId(id);
    payload.setCreatedByAccountId(existing.getCreatedByAccountId());
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
    requireOperating(existing);
    storeLevelService.requireEnabled(storeLevelId);
    existing.setStoreLevelId(storeLevelId);
    updateById(existing);
    return getById(id);
  }

  @Transactional
  public Store archiveStore(Long id) {
    Store existing = getById(id);
    if (existing == null) {
      return null;
    }
    requireOperating(existing);
    existing.setStatus("disabled");
    updateById(existing);
    jdbcTemplate.update("UPDATE stores SET archived_by_tenant = 0 WHERE id = ?", id);
    revokeStoreSessions(id);
    return getById(id);
  }

  @Transactional
  public Store restoreStore(Long id) {
    Store existing = getById(id);
    if (existing == null) {
      return null;
    }
    recovery.requireFreshAvailability(id);
    requireArchived(existing);
    requireTenantOperating(existing.getTenantId());
    existing.setStatus("enabled");
    updateById(existing);
    jdbcTemplate.update("UPDATE stores SET archived_by_tenant = 0 WHERE id = ?", id);
    return getById(id);
  }

  public void retryDelete(Long id) { exits.retry(id); }

  public com.zdm.platform.storeexit.StoreExitResult deleteResult(Long id) { return exits.result(id); }

  public com.zdm.platform.storeexit.StoreExitPreview previewDelete(Long id) {
    return exits.preview(id);
  }

  @Transactional(isolation = org.springframework.transaction.annotation.Isolation.READ_COMMITTED)
  public com.zdm.platform.storeexit.StoreExitResult deleteStore(Long id, String planHash) {
    Store existing = getById(id);
    if (existing == null) {
      return exits.existingResult(id, planHash);
    }
    exits.requireTenantLock(existing.getTenantId());
    List<Long> accountIds = exits.execute(id, planHash, false);
    accountIds.forEach(accountLifecycle::releaseForStoreExit);
    exits.recordAccountOutcome(id, accountIds);
    return exits.result(id);
  }

  private void revokeStoreSessions(Long storeId) {
    jdbcTemplate.update("""
        UPDATE auth_sessions SET revoked_at=CURRENT_TIMESTAMP
        WHERE revoked_at IS NULL AND identity_id IN (SELECT id FROM account_identities WHERE store_id=?)
        """, storeId);
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

  private void requireTenantOperating(Long tenantId) {
    Integer count = jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM tenants WHERE id = ? AND status = 'enabled'",
        Integer.class,
        tenantId);
    if (count == null || count == 0) {
      throw new IllegalArgumentException("所属租户已归档，不能恢复门店运营");
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

  private void requireOperating(Store store) {
    if (!"enabled".equals(store.getStatus())) {
      throw new IllegalArgumentException("该门店已归档");
    }
  }

  private void requireArchived(Store store) {
    if (!"disabled".equals(store.getStatus())) {
      throw new IllegalArgumentException("请先归档门店");
    }
  }
  @Override
  public Store getById(java.io.Serializable id) {
    Store entity = super.getById(id);
    if (entity != null) {
      com.zdm.platform.security.DataScope.requireAccess(
          identityProvider.require(), entity.getCreatedByAccountId());
      recovery.requireAvailable(entity.getId());
    }
    return entity;
  }

}
