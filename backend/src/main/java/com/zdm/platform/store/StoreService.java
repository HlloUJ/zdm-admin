package com.zdm.platform.store;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.zdm.platform.security.CurrentIdentity;
import com.zdm.platform.security.CurrentIdentityProvider;
import java.util.List;
import java.util.Objects;
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
    storeLevelService.requireSelectable(store.getStoreLevelId());
    store.setCreatedBy(identity.displayName());
    return save(store);
  }

  @Transactional
  public Store updateStore(Long id, Store payload) {
    Store existing = getById(id);
    if (existing == null) {
      return null;
    }
    requireAccessible(existing);
    if (!Objects.equals(existing.getStoreLevelId(), payload.getStoreLevelId())) {
      storeLevelService.requireSelectable(payload.getStoreLevelId());
    }
    payload.setId(id);
    payload.setCreatedBy(existing.getCreatedBy());
    updateById(payload);
    return getById(id);
  }

  @Transactional
  public boolean deleteStore(Long id) {
    Store existing = getById(id);
    if (existing == null) {
      return false;
    }
    requireAccessible(existing);
    StoreReferenceSummary summary = getReferenceSummary();
    if (summary.totalCount() > 0) {
      throw new IllegalArgumentException(referenceMessage(summary));
    }
    try {
      jdbcTemplate.update("UPDATE roles SET store_id = NULL WHERE store_id = ?", id);
      return removeById(id);
    } catch (DataIntegrityViolationException exception) {
      throw new IllegalArgumentException(REFERENCED_MESSAGE, exception);
    }
  }

  public StoreReferenceSummary getDeletionReferences(Long id) {
    Store existing = getById(id);
    if (existing == null) {
      throw new IllegalArgumentException("门店不存在或已被删除");
    }
    requireAccessible(existing);
    return getReferenceSummary();
  }

  private StoreReferenceSummary getReferenceSummary() {
    return new StoreReferenceSummary(0, List.of());
  }

  private String referenceMessage(StoreReferenceSummary summary) {
    String referenceCounts = summary.references().stream()
        .map(reference -> reference.name() + reference.count() + "条")
        .reduce((left, right) -> left + "、" + right)
        .orElse("");
    return REFERENCED_MESSAGE + "（" + referenceCounts + "）";
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
