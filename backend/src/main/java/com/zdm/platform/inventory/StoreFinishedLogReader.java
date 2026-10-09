package com.zdm.platform.inventory;

import com.zdm.platform.inventory.StoreFinishedProductService.LogEntry;
import com.zdm.platform.inventory.StoreFinishedProductService.LogPage;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;

final class StoreFinishedLogReader {
  private final JdbcTemplate jdbc;
  private final CityPartnerStoreScope scopes;
  private final StoreFinishedSelectionSnapshot snapshots;

  StoreFinishedLogReader(JdbcTemplate jdbc, CityPartnerStoreScope scopes, StoreFinishedSelectionSnapshot snapshots) {
    this.jdbc = jdbc;
    this.scopes = scopes;
    this.snapshots = snapshots;
  }

  public List<LogEntry> logs() {
    var store = scopes.require();
    return jdbc.query("""
        SELECT id, listing_id, finished_product_id, product_name, operation_type,
          operation_summary, before_status, after_status, change_details,
          operator_name, operated_at
        FROM store_finished_operation_logs
        WHERE tenant_id = ? AND store_id = ? ORDER BY operated_at DESC, id DESC
        """, (row, index) -> new LogEntry(row.getLong("id"),
        row.getObject("listing_id", Long.class), row.getLong("finished_product_id"),
        row.getString("product_name"), row.getString("operation_type"),
        row.getString("operation_summary"), row.getString("before_status"),
        row.getString("after_status"), snapshots.withoutSupplier(row.getString("change_details")),
        row.getString("operator_name"), row.getTimestamp("operated_at").toLocalDateTime()),
        store.tenantId(), store.storeId());
  }

  public LogPage logPage(String keyword, String operationType, String operatorName,
      String startDate, String endDate, int requestedPage, int requestedSize) {
    var store = scopes.require();
    int page = Math.max(1, requestedPage);
    int size = Math.clamp(requestedSize, 1, 100);
    StringBuilder conditions = new StringBuilder("tenant_id = ? AND store_id = ?");
    List<Object> args = new ArrayList<>(List.of(store.tenantId(), store.storeId()));
    if (keyword != null && !keyword.isBlank()) {
      conditions.append(" AND (product_name LIKE ? OR CAST(finished_product_id AS CHAR) LIKE ?)");
      args.add("%" + keyword.trim() + "%");
      args.add("%" + keyword.trim() + "%");
    }
    if (operationType != null && !operationType.isBlank()) {
      if ("UPDATE".equals(operationType)) {
        conditions.append(" AND operation_type IN ('UPDATE','PRICE_UPDATE')");
      } else if ("RESTORE".equals(operationType)) {
        conditions.append(" AND operation_type IN ('RESTORE','RESTORE_WAREHOUSE','RESTORE_RECYCLE')");
      } else {
        conditions.append(" AND operation_type = ?");
        args.add(operationType);
      }
    }
    if (operatorName != null && !operatorName.isBlank()) {
      conditions.append(" AND operator_name LIKE ?");
      args.add("%" + operatorName.trim() + "%");
    }
    if (startDate != null && !startDate.isBlank()) {
      conditions.append(" AND operated_at >= ?");
      args.add(startDate + " 00:00:00");
    }
    if (endDate != null && !endDate.isBlank()) {
      conditions.append(" AND operated_at < DATE_ADD(?, INTERVAL 1 DAY)");
      args.add(endDate);
    }
    Long count = jdbc.queryForObject(
        "SELECT COUNT(*) FROM store_finished_operation_logs WHERE " + conditions,
        Long.class, args.toArray());
    long total = count == null ? 0L : count;
    List<Object> pageArgs = new ArrayList<>(args);
    pageArgs.add(size);
    pageArgs.add((page - 1) * size);
    List<LogEntry> records = jdbc.query("""
        SELECT id, listing_id, finished_product_id, product_name, operation_type,
          operation_summary, before_status, after_status, change_details,
          operator_name, operated_at
        FROM store_finished_operation_logs WHERE
        """ + conditions + " ORDER BY operated_at DESC, id DESC LIMIT ? OFFSET ?",
        (row, index) -> logEntry(row), pageArgs.toArray());
    return new LogPage(records, total, page, size);
  }

  public LogEntry logDetail(Long id) {
    var store = scopes.require();
    LogEntry log = jdbc.query("""
        SELECT id, listing_id, finished_product_id, product_name, operation_type,
          operation_summary, before_status, after_status, change_details,
          operator_name, operated_at
        FROM store_finished_operation_logs WHERE id = ? AND tenant_id = ? AND store_id = ?
        """, (row, index) -> logEntry(row), id, store.tenantId(), store.storeId())
        .stream().findFirst()
        .orElseThrow(() -> new IllegalArgumentException("本门店操作日志不存在"));
    if (!"SELECT".equals(log.operationType())) { return log; }
    return new LogEntry(log.id(), log.listingId(), log.productId(), log.productName(),
        log.operationType(), log.operationSummary(), log.beforeStatus(), log.afterStatus(),
        snapshots.resolve(log.changeDetails()), log.operatorName(), log.operatedAt());
  }

  private LogEntry logEntry(ResultSet row) throws SQLException {
    String operationType = row.getString("operation_type");
    boolean legacyPriceEdit = "PRICE_UPDATE".equals(operationType);
    return new LogEntry(row.getLong("id"), row.getObject("listing_id", Long.class),
        row.getLong("finished_product_id"), row.getString("product_name"),
        legacyPriceEdit ? "UPDATE" : operationType,
        legacyPriceEdit ? "编辑商品" : row.getString("operation_summary"),
        row.getString("before_status"), row.getString("after_status"),
        snapshots.withoutSupplier(row.getString("change_details")), row.getString("operator_name"),
        row.getTimestamp("operated_at").toLocalDateTime());
  }

}
