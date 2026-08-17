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
    StoreReferenceSummary summary = getReferenceSummary(id);
    if (summary.totalCount() > 0) {
      throw new IllegalArgumentException(referenceMessage(summary));
    }
    try {
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
            "accountIdentities",
            "账号身份",
            "SELECT COUNT(*) FROM account_identities WHERE store_id = ?",
            id -> jdbcTemplate.queryForList(
                """
                SELECT CONCAT(a.display_name, ' / ', ai.identity_type, '（',
                  IF(ai.status = 'enabled', '启用', '停用'), '）')
                FROM account_identities ai
                JOIN accounts a ON a.id = ai.account_id
                WHERE ai.store_id = ?
                ORDER BY ai.status = 'enabled' DESC, ai.id LIMIT 5
                """,
                String.class,
                id)),
        reference(
            storeId,
            "accountRoles",
            "账号角色绑定",
            "SELECT COUNT(*) FROM account_roles WHERE store_id = ?",
            id -> jdbcTemplate.queryForList(
                """
                SELECT CONCAT(a.display_name, '—', r.name)
                FROM account_roles ar
                JOIN accounts a ON a.id = ar.account_id
                JOIN roles r ON r.id = ar.role_id
                WHERE ar.store_id = ?
                ORDER BY ar.id LIMIT 5
                """,
                String.class,
                id)),
        reference(
            storeId,
            "employeeInvites",
            "员工邀请",
            "SELECT COUNT(*) FROM employee_invites WHERE store_id = ?",
            id -> jdbcTemplate.queryForList(
                """
                SELECT CONCAT(invite_status, ' ', COUNT(*), '条')
                FROM (
                  SELECT CASE
                    WHEN status = 'active' AND expires_at < CURRENT_TIMESTAMP THEN '已过期'
                    WHEN status = 'active' THEN '有效'
                    WHEN status = 'used' THEN '已使用'
                    ELSE '已过期'
                  END AS invite_status
                  FROM employee_invites
                  WHERE store_id = ?
                ) scoped_invites
                GROUP BY invite_status
                ORDER BY invite_status
                """,
                String.class,
                id)),
        reference(
            storeId,
            "orders",
            "订单",
            "SELECT COUNT(*) FROM platform_orders WHERE store_id = ?",
            id -> jdbcTemplate.queryForList(
                "SELECT CONCAT(order_no, '（', status, '）') FROM platform_orders WHERE store_id = ? ORDER BY id LIMIT 5",
                String.class,
                id)),
        reference(
            storeId,
            "roles",
            "门店角色",
            "SELECT COUNT(*) FROM roles WHERE store_id = ?",
            id -> jdbcTemplate.queryForList(
                "SELECT CONCAT(name, '（', IF(status = 'enabled', '启用', '停用'), '）') FROM roles WHERE store_id = ? ORDER BY id LIMIT 5",
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

  private void requireAccessible(Store store) {
    CurrentIdentity identity = identityProvider.require();
    if (!identity.isSuperAdmin()
        && !"all".equals(identity.dataPermission())
        && !Objects.equals(store.getCreatedBy(), identity.displayName())) {
      throw new AccessDeniedException("当前数据权限不允许操作该门店");
    }
  }
}
