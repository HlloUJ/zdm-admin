package com.zdm.platform.storeexit;

import java.util.List;
import java.util.Objects;
import java.util.TreeSet;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/** Applies exit protection to the target organization, including writes made by another terminal. */
@Service
@org.springframework.transaction.annotation.Transactional(propagation = org.springframework.transaction.annotation.Propagation.MANDATORY)
public class StoreExitTargetService {
  private final JdbcTemplate jdbc;
  private final StoreExitRecoveryState recovery;

  public StoreExitTargetService(JdbcTemplate jdbc, StoreExitRecoveryState recovery) {
    this.jdbc = jdbc; this.recovery = recovery;
  }

  /** Keep the root locked until the caller's transaction ends, before locking its children. */
  public boolean lockStore(long storeId) {
    if (jdbc.queryForList("SELECT id FROM stores WHERE id=? FOR UPDATE", Long.class, storeId).isEmpty()
        || recovery.retired(storeId)) { return false; }
    // An undecided exit is not permission to silently discard a still-live store's update.
    recovery.requireAvailable(storeId);
    return true;
  }

  public List<Long> lockStores(List<Long> storeIds) {
    return new TreeSet<>(storeIds).stream().filter(this::lockStore).toList();
  }

  public boolean lockParent(String table, Long id) {
    return lockParent(table, id, null, true);
  }

  /** A derived-media job may find a historical parent that has already been removed. */
  public boolean lockExistingParent(String table, Long id, Long expectedStore) {
    return lockParent(table, id, Objects.requireNonNull(expectedStore), false);
  }

  public Long parentStoreId(String table, Long id) {
    var stores = jdbc.queryForList(ownerSql(table, id), Long.class, id);
    if (stores.isEmpty()) { return null; }
    if (stores.size() != 1) { throw new IllegalArgumentException("门店业务对象归属不唯一"); }
    return Objects.requireNonNull(stores.getFirst(), "门店业务对象归属缺失");
  }

  private boolean lockParent(String table, Long id, Long expectedStore, boolean required) {
    Long storeId = parentStoreId(table, id);
    if (storeId == null) {
      if (required) { throw new IllegalArgumentException("门店业务对象已不存在，不能继续写入"); }
      return false;
    }
    if ((expectedStore != null && !expectedStore.equals(storeId)) || !lockStore(storeId)) { return false; }
    var locked = jdbc.queryForList(ownerSql(table, id) + " FOR UPDATE", Long.class, id);
    if (locked.size() != 1 || !Objects.equals(storeId, locked.getFirst())) {
      if (required) { throw new IllegalArgumentException("门店业务对象已变化，不能继续写入"); }
      return false;
    }
    return true;
  }

  private String ownerSql(String table, Long id) {
    if (id == null || !StoreExitMediaDomains.PARENTS.containsValue(table)) {
      throw new IllegalArgumentException("门店业务对象类型或标识不合法");
    }
    return "store_customer_followups".equals(table)
        ? "SELECT c.store_id FROM store_customer_followups p JOIN store_customers c ON c.id=p.customer_id WHERE p.id=?"
        : "SELECT store_id FROM " + table + " WHERE id=?";
  }
}
