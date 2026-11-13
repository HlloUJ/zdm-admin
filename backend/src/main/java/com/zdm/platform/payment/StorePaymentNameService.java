package com.zdm.platform.payment;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.zdm.platform.inventory.CityPartnerStoreScope;
import com.zdm.platform.security.PermissionGuard;
import java.time.LocalDateTime;
import java.util.List;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.simple.SimpleJdbcInsert;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class StorePaymentNameService {
  public static final String PREFIX = "store.order-management.settings.nature";
  public record Name(String id, String name, boolean enabled, Long createdBy, String createdByName,
      LocalDateTime createdAt, LocalDateTime updatedAt, long version) {}
  public record Option(String id, String name, long version) {}
  public record Page(List<Name> items, long total) {
    public Page { items = List.copyOf(items); }
  }
  private static final String SELECT = """
      SELECT n.*, a.display_name AS creator_name FROM store_payment_names n
      LEFT JOIN accounts a ON a.id=n.created_by_account_id
      """;
  private final JdbcTemplate jdbc;
  private final CityPartnerStoreScope scopes;
  private final PermissionGuard permissions;
  private final ObjectMapper json;

  public StorePaymentNameService(JdbcTemplate jdbc, CityPartnerStoreScope scopes,
      PermissionGuard permissions, ObjectMapper json) {
    this.jdbc = jdbc;
    this.scopes = scopes;
    this.permissions = permissions;
    this.json = json;
  }

  private CityPartnerStoreScope.Store scope() {
    var store = scopes.require();
    permissions.requireDataPermission();
    return store;
  }

  private Name map(java.sql.ResultSet row, int index) throws java.sql.SQLException {
    return new Name(row.getString("id"), row.getString("name"), row.getBoolean("enabled"),
        row.getObject("created_by_account_id", Long.class), row.getString("creator_name"),
        row.getTimestamp("created_at").toLocalDateTime(), row.getTimestamp("updated_at").toLocalDateTime(),
        row.getLong("version"));
  }

  public Page list(int page, int pageSize) {
    permissions.requireView(PREFIX);
    var store = scope();
    if (page < 1 || pageSize < 1 || pageSize > 100) { throw new IllegalArgumentException("分页参数不正确"); }
    Long total = jdbc.queryForObject("SELECT COUNT(*) FROM store_payment_names WHERE tenant_id=? AND store_id=? AND deleted_at IS NULL",
        Long.class, store.tenantId(), store.storeId());
    var items = jdbc.query(SELECT + " WHERE n.tenant_id=? AND n.store_id=? AND n.deleted_at IS NULL ORDER BY n.created_at DESC,n.id DESC LIMIT ? OFFSET ?",
        this::map, store.tenantId(), store.storeId(), pageSize, ((long) page - 1) * pageSize);
    return new Page(items, total == null ? 0 : total);
  }

  public List<Option> options() {
    if (!permissions.hasView(PREFIX)) {
      permissions.requireAnyPermission(
          "store.order-management.sales.pending.receipt", "store.order-management.sales.confirmed.receipt",
          "store.order-management.sales.shipped.receipt", "store.order-management.sales.completed.receipt",
          "store.order-management.sales.pending.correct-payment", "store.order-management.sales.confirmed.correct-payment",
          "store.order-management.sales.shipped.correct-payment", "store.order-management.sales.completed.correct-payment",
          "store.order-management.sales.cancelled.correct-payment");
    }
    var store = scope();
    return jdbc.query("SELECT id,name,version FROM store_payment_names WHERE tenant_id=? AND store_id=? AND deleted_at IS NULL AND enabled=TRUE ORDER BY created_at DESC,id DESC",
        (row, index) -> new Option(row.getString("id"), row.getString("name"), row.getLong("version")),
        store.tenantId(), store.storeId());
  }

  private String validName(String value) {
    String name = value == null ? "" : value.strip();
    if (name.isEmpty()) { throw new IllegalArgumentException("请输入名称"); }
    if (name.codePointCount(0, name.length()) > 10) { throw new IllegalArgumentException("名称不能超过10个字符"); }
    return name;
  }

  private Name require(CityPartnerStoreScope.Store store, long id) {
    var rows = jdbc.query(SELECT + " WHERE n.tenant_id=? AND n.store_id=? AND n.id=? AND n.deleted_at IS NULL",
        this::map, store.tenantId(), store.storeId(), id);
    if (rows.isEmpty()) { throw new IllegalArgumentException("款项名称不存在或已删除"); }
    return rows.getFirst();
  }

  private Name lock(CityPartnerStoreScope.Store store, long id, long version) {
    var rows = jdbc.query(SELECT + " WHERE n.tenant_id=? AND n.store_id=? AND n.id=? AND n.deleted_at IS NULL FOR UPDATE",
        this::map, store.tenantId(), store.storeId(), id);
    if (rows.isEmpty()) { throw new IllegalArgumentException("款项名称不存在或已删除"); }
    var name = rows.getFirst();
    if (version < 1 || name.version() != version) { throw new IllegalArgumentException("配置已被其他人修改，请刷新后重试"); }
    return name;
  }

  private String snapshot(Name value) {
    if (value == null) { return null; }
    try { return json.writeValueAsString(value); }
    catch (JsonProcessingException exception) { throw new IllegalStateException("无法保存款项配置操作记录", exception); }
  }

  private void audit(CityPartnerStoreScope.Store store, String action, Name before, Name after) {
    jdbc.update("INSERT INTO store_payment_name_events(tenant_id,store_id,payment_name_id,action,operator_account_id,operator_name,before_value,after_value) VALUES (?,?,?,?,?,?,?,?)",
        store.tenantId(), store.storeId(), Long.valueOf(after == null ? before.id() : after.id()), action,
        store.accountId(), store.operatorName(), snapshot(before), snapshot(after));
  }

  @Transactional
  public Name create(String value) {
    permissions.requirePermission(PREFIX + ".create");
    var store = scope();
    String name = validName(value);
    Number key;
    try {
      key = new SimpleJdbcInsert(jdbc).withTableName("store_payment_names")
          .usingColumns("tenant_id", "store_id", "name", "created_by_account_id", "updated_by_account_id")
          .usingGeneratedKeyColumns("id").executeAndReturnKey(java.util.Map.of(
              "tenant_id", store.tenantId(), "store_id", store.storeId(), "name", name,
              "created_by_account_id", store.accountId(), "updated_by_account_id", store.accountId()));
    } catch (DuplicateKeyException exception) { throw new IllegalArgumentException("该名称已存在", exception); }
    var created = require(store, key.longValue());
    audit(store, "create", null, created);
    return created;
  }

  @Transactional
  public Name update(long id, String value, long version) {
    permissions.requirePermission(PREFIX + ".edit");
    var store = scope();
    String name = validName(value);
    var before = lock(store, id, version);
    try {
      jdbc.update("UPDATE store_payment_names SET name=?,version=version+1,updated_by_account_id=?,updated_at=CURRENT_TIMESTAMP(3) WHERE tenant_id=? AND store_id=? AND id=? AND version=? AND deleted_at IS NULL",
          name, store.accountId(), store.tenantId(), store.storeId(), id, version);
    } catch (DuplicateKeyException exception) { throw new IllegalArgumentException("该名称已存在", exception); }
    var after = require(store, id);
    audit(store, "edit", before, after);
    return after;
  }

  @Transactional
  public Name status(long id, boolean enabled, long version) {
    permissions.requirePermission(PREFIX + ".toggle-status");
    var store = scope();
    var before = lock(store, id, version);
    if (before.enabled() == enabled) { return before; }
    jdbc.update("UPDATE store_payment_names SET enabled=?,version=version+1,updated_by_account_id=?,updated_at=CURRENT_TIMESTAMP(3) WHERE tenant_id=? AND store_id=? AND id=? AND version=? AND deleted_at IS NULL",
        enabled, store.accountId(), store.tenantId(), store.storeId(), id, version);
    var after = require(store, id);
    audit(store, enabled ? "enable" : "disable", before, after);
    return after;
  }

  @Transactional
  public void delete(long id, long version) {
    permissions.requirePermission(PREFIX + ".delete");
    var store = scope();
    var deleted = jdbc.queryForList("SELECT id FROM store_payment_names WHERE tenant_id=? AND store_id=? AND id=? AND deleted_at IS NOT NULL",
        Long.class, store.tenantId(), store.storeId(), id);
    if (!deleted.isEmpty()) { return; }
    var before = lock(store, id, version);
    jdbc.update("UPDATE store_payment_names SET deleted_at=CURRENT_TIMESTAMP(3),deleted_by_account_id=?,updated_by_account_id=?,updated_at=CURRENT_TIMESTAMP(3),version=version+1 WHERE tenant_id=? AND store_id=? AND id=? AND version=? AND deleted_at IS NULL",
        store.accountId(), store.accountId(), store.tenantId(), store.storeId(), id, version);
    audit(store, "delete", before, null);
  }
}
