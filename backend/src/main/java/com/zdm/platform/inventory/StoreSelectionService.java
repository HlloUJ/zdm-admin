package com.zdm.platform.inventory;

import java.util.List;
import java.util.Objects;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/** Persistent personal/store selection and independently committed joins, with durable request replay. */
@Service
public class StoreSelectionService {
  public record Failure(String type, Long productId, String name, String code, String reason) {}
  public record Result(Long id, String status, long total, long successCount, long failureCount, List<Failure> failures) {
    public Result { failures = List.copyOf(failures); }
  }
  private final JdbcTemplate jdbc;
  private final StoreSelectionCatalog catalog;
  private final StoreFinishedProductService finished;
  private final StoreAccessoryProductService accessory;
  private final TransactionTemplate transaction;
  private final com.zdm.platform.storeexit.StoreExitTargetService exitTargets;

  public StoreSelectionService(JdbcTemplate jdbc, StoreSelectionCatalog catalog,
      StoreFinishedProductService finished, StoreAccessoryProductService accessory, PlatformTransactionManager manager,
      com.zdm.platform.storeexit.StoreExitTargetService exitTargets) {
    this.exitTargets = exitTargets;
    this.jdbc = jdbc; this.catalog = catalog; this.finished = finished; this.accessory = accessory;
    this.transaction = new TransactionTemplate(manager);
    this.transaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
  }

  public void add(String context, String type, Long id) {
    var store = catalog.require(context); StoreSelectionCatalog.validType(type);
    transaction.executeWithoutResult(status -> {
      if (!catalog.canMaintain(type)) { throw new AccessDeniedException("无对应商品维护权限"); }
      // Lock the source consistently with join/removal/status workflows.
      jdbc.queryForList("SELECT id FROM " + type + "_products WHERE id=? FOR UPDATE", id);
      lockStore(context, store);
      var product = catalog.detail(context, type, id).product();
      if (product.inSelection()) { return; }
      if (!product.canAdd()) { throw new IllegalArgumentException(product.reasons().getFirst()); }
      jdbc.update("INSERT INTO store_selection_items(tenant_id,store_id,account_id,product_type,product_id) VALUES(?,?,?,?,?)",
          store.tenantId(), store.storeId(), store.accountId(), type, id);
    });
  }

  public void remove(String context, Long id) {
    var store = catalog.require(context);
    transaction.executeWithoutResult(status -> {
      lockStore(context, store);
      int removed = jdbc.update("DELETE FROM store_selection_items WHERE id=? AND tenant_id=? AND store_id=? AND account_id=?",
        id, store.tenantId(), store.storeId(), store.accountId());
      if (removed == 0) { throw new IllegalArgumentException("清单记录不存在或无权操作"); }
    });
  }

  /** Source (when needed), then store root, then children; recheck scope after waiting for an exit. */
  private void lockStore(String context, CityPartnerStoreScope.Store expected) {
    if (!exitTargets.lockStore(expected.storeId())) {
      throw new AccessDeniedException("当前门店已退出，不能继续选品");
    }
    var current = catalog.require(context);
    if (!StoreSelectionCatalog.key(expected).equals(StoreSelectionCatalog.key(current))) {
      throw new AccessDeniedException("当前身份或门店已变更，请重新打开选品中心");
    }
  }

  private Long batchId(CityPartnerStoreScope.Store store, String request) {
    return jdbc.query("SELECT id FROM store_selection_batches WHERE tenant_id=? AND store_id=? AND account_id=? AND request_id=?",
        (r, i) -> r.getLong("id"), store.tenantId(), store.storeId(), store.accountId(), request).stream().findFirst().orElse(null);
  }

  public Result join(String context, String request) {
    var store = catalog.require(context);
    if (request == null || !request.matches("[a-zA-Z0-9_-]{16,64}")) { throw new IllegalArgumentException("提交标识无效"); }
    Long batch = batchId(store, request);
    if (batch == null) {
      try {
        batch = transaction.execute(status -> {
          lockStore(context, store);
          jdbc.update("INSERT INTO store_selection_batches(tenant_id,store_id,account_id,request_id) VALUES(?,?,?,?)",
              store.tenantId(), store.storeId(), store.accountId(), request);
          Long id = Objects.requireNonNull(batchId(store, request));
          var items = jdbc.queryForList("SELECT id,product_type,product_id FROM store_selection_items"
              + " WHERE tenant_id=? AND store_id=? AND account_id=? ORDER BY id FOR UPDATE",
              store.tenantId(), store.storeId(), store.accountId());
          if (items.isEmpty()) { throw new IllegalArgumentException("选品清单为空"); }
          for (var item : items) {
            String type = (String) item.get("product_type");
            Long productId = StoreSelectionCatalog.number(item.get("product_id"));
            var source = catalog.sourceRow(store, type, productId);
            jdbc.update("INSERT INTO store_selection_batch_items(batch_id,selection_id,product_type,product_id,product_name) VALUES(?,?,?,?,?)",
                id, item.get("id"), type, productId, source == null ? "商品当前不可用" : source.get("name"));
          }
          return id;
        });
      } catch (DuplicateKeyException duplicate) {
        batch = batchId(store, request);
        if (batch == null) { throw duplicate; }
      }
    }
    if (batch == null) { throw new IllegalStateException("批次未能创建，请重新提交"); }
    return process(context, batch);
  }

  /** A retry of POST resumes pending items; GET only reads the authoritative committed result. */
  private Result process(String context, Long batch) {
    var store = catalog.require(context);
    requireBatch(store, batch);
    var ids = jdbc.query("SELECT id FROM store_selection_batch_items WHERE batch_id=? ORDER BY id",
        (r, i) -> r.getLong("id"), batch);
    for (Long id : ids) {
      catalog.require(context);
      try {
        // Autocommit read avoids creating an old repeatable-read snapshot before waiting for source/root locks.
        var candidate = jdbc.queryForMap("SELECT i.product_type,i.product_id FROM store_selection_batch_items i"
            + " JOIN store_selection_batches b ON b.id=i.batch_id"
            + " WHERE i.id=? AND i.batch_id=? AND b.tenant_id=? AND b.store_id=? AND b.account_id=?",
            id, batch, store.tenantId(), store.storeId(), store.accountId());
        transaction.executeWithoutResult(status -> joinItem(context, store, batch, id, candidate));
      } catch (AccessDeniedException denied) {
        // Changed identity is a batch-level stop; do not continue under another scope.
        catalog.require(context);
        recordFailure(context, store, batch, id, "NO_TYPE_PERMISSION", denied.getMessage());
      } catch (IllegalArgumentException invalid) {
        recordFailure(context, store, batch, id, code(invalid.getMessage()), invalid.getMessage());
      } catch (DuplicateKeyException duplicate) {
        recordFailure(context, store, batch, id, "ALREADY_IN_STORE", "该商品已加入门店，请勿重复添加。");
      } catch (RuntimeException unexpected) {
        recordFailure(context, store, batch, id, "PROCESSING_FAILED", "加入失败，请稍后重试。");
      }
    }
    transaction.executeWithoutResult(status -> {
      lockStore(context, store);
      Long pending = jdbc.queryForObject("SELECT COUNT(*) FROM store_selection_batch_items WHERE batch_id=? AND status='pending'", Long.class, batch);
      if (pending != null && pending == 0) {
        jdbc.update("UPDATE store_selection_batches SET status='completed',finished_at=CURRENT_TIMESTAMP(6) WHERE id=? AND status='processing'", batch);
      }
    });
    return result(context, batch);
  }

  private void joinItem(String context, CityPartnerStoreScope.Store store, Long batch, Long itemId, java.util.Map<String, Object> candidate) {
    String type = StoreSelectionCatalog.validType((String) candidate.get("product_type"));
    Long productId = StoreSelectionCatalog.number(candidate.get("product_id"));
    // Match upstream editing: source -> store -> child. Never wait for source while holding a store/child lock.
    var locked = jdbc.queryForList("SELECT id FROM " + type + "_products WHERE id=? FOR UPDATE", productId);
    lockStore(context, store);
    var item = jdbc.queryForMap("SELECT i.* FROM store_selection_batch_items i"
        + " JOIN store_selection_batches b ON b.id=i.batch_id"
        + " WHERE i.id=? AND i.batch_id=? AND b.tenant_id=? AND b.store_id=? AND b.account_id=? FOR UPDATE",
        itemId, batch, store.tenantId(), store.storeId(), store.accountId());
    if (!Objects.equals(type, item.get("product_type"))
        || !Objects.equals(productId, StoreSelectionCatalog.number(item.get("product_id")))) {
      throw new IllegalArgumentException("选品批次内容已变化，请重新提交");
    }
    if (!"pending".equals(item.get("status"))) { return; }
    if (locked.isEmpty()) { throw new IllegalArgumentException("商品当前不可用，无法加入门店。"); }
    if (!catalog.canMaintain(type)) {
      throw new IllegalArgumentException("无" + ("finished".equals(type) ? "成品现货" : "配件") + "维护权限，无法加入门店。");
    }
    var source = catalog.sourceRow(store, type, productId);
    if (!StoreSelectionCatalog.browsable(source)) { throw new IllegalArgumentException("商品已下架，无法加入门店。"); }
    // Repeat the store-wide existence query while the shared source lock is held. Recycle/generations count too.
    Long exists = jdbc.queryForObject("SELECT COUNT(*) FROM store_" + type + "_products WHERE store_id=? AND "
        + type + "_product_id=?", Long.class, store.storeId(), productId);
    if (exists != null && exists > 0) { throw new IllegalArgumentException("该商品已加入门店，请勿重复添加。"); }
    var product = catalog.detail(context, type, productId).product();
    if (!product.canAdd()) { throw new IllegalArgumentException(product.reasons().getFirst()); }
    Long listing;
    if ("finished".equals(type)) { listing = finished.select(List.of(productId)).getFirst().id(); }
    else { listing = accessory.select(List.of(productId)).getFirst().id(); }
    jdbc.update("UPDATE store_selection_batch_items SET status='success',listing_id=? WHERE id=?", listing, itemId);
    jdbc.update("DELETE FROM store_selection_items WHERE id=? AND tenant_id=? AND store_id=? AND account_id=?",
        item.get("selection_id"), store.tenantId(), store.storeId(), store.accountId());
  }

  private static String code(String reason) {
    if (reason.contains("已加入门店")) { return "ALREADY_IN_STORE"; }
    if (reason.contains("售完")) { return "SOLD_OUT"; }
    if (reason.contains("下架")) { return "SOURCE_UNAVAILABLE"; }
    if (reason.contains("权限")) { return "NO_TYPE_PERMISSION"; }
    if (reason.contains("价格")) { return "PRICE_INCOMPLETE"; }
    return "ITEM_UNAVAILABLE";
  }

  private void recordFailure(String context, CityPartnerStoreScope.Store store, Long batch, Long item, String code, String reason) {
    transaction.executeWithoutResult(status -> {
      lockStore(context, store);
      requireBatch(store, batch);
      jdbc.queryForList("SELECT id FROM store_selection_batch_items WHERE id=? AND batch_id=? FOR UPDATE", item, batch);
      jdbc.update("UPDATE store_selection_batch_items SET status='failure',error_code=?,reason=? WHERE id=? AND batch_id=? AND status='pending'",
          code, reason, item, batch);
    });
  }

  private void requireBatch(CityPartnerStoreScope.Store store, Long id) {
    Long count = jdbc.queryForObject("SELECT COUNT(*) FROM store_selection_batches WHERE id=? AND tenant_id=? AND store_id=? AND account_id=?",
        Long.class, id, store.tenantId(), store.storeId(), store.accountId());
    if (count == null || count == 0) { throw new IllegalArgumentException("批次不存在或无权操作"); }
  }

  public Result result(String context, Long id) {
    var store = catalog.require(context); requireBatch(store, id);
    var rows = jdbc.queryForList("SELECT * FROM store_selection_batch_items WHERE batch_id=? ORDER BY id", id);
    long success = rows.stream().filter(r -> "success".equals(r.get("status"))).count();
    var failures = rows.stream().filter(r -> "failure".equals(r.get("status"))).map(r -> new Failure(
        (String) r.get("product_type"), StoreSelectionCatalog.number(r.get("product_id")), (String) r.get("product_name"),
        (String) r.get("error_code"), (String) r.get("reason"))).toList();
    return new Result(id, success + failures.size() == rows.size() ? "completed" : "processing", rows.size(), success, failures.size(), failures);
  }
}
