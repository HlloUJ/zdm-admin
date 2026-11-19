package com.zdm.platform.inventory;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.zdm.platform.security.PermissionGuard;
import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;

/** Read-only, store-priced catalog. No upstream cost or other store-level prices escape this projection. */
@Service
public class StoreSelectionCatalog {
  public static final String FINISHED_PERMISSION = "store.finished-stock-management.select";
  public static final String ACCESSORY_PERMISSION = "store.accessory-management.select";
  public record Category(String type, Long id, Long parentId, String name) {}
  public record Product(String type, Long id, String name, Long categoryId, LocalDateTime sourceCreatedAt,
      String imageUrl, BigDecimal priceMin, BigDecimal priceMax, boolean soldOut, boolean addedToStore,
      boolean inSelection, boolean canAdd, List<String> reasons, Long selectionId, LocalDateTime addedAt) {
    public Product { reasons = List.copyOf(reasons); }
  }
  public record Page(List<Product> records, long total, int page, int pageSize) {
    public Page { records = List.copyOf(records); }
  }
  public record Context(String key, String storeName, Map<String, Boolean> maintain) {
    public Context { maintain = Map.copyOf(maintain); }
  }
  public record Detail(Product product, Map<String, Object> information) {
    public Detail { information = java.util.Collections.unmodifiableMap(new LinkedHashMap<>(information)); }
  }
  private final JdbcTemplate jdbc;
  private final NamedParameterJdbcTemplate named;
  private final CityPartnerStoreScope scopes;
  private final PermissionGuard guard;
  private final StoreFinishedProductService finished;
  private final StoreAccessoryProductService accessory;
  private final ObjectMapper json;

  public StoreSelectionCatalog(JdbcTemplate jdbc, CityPartnerStoreScope scopes, PermissionGuard guard,
      StoreFinishedProductService finished, StoreAccessoryProductService accessory, ObjectMapper json) {
    this.jdbc = jdbc;
    this.named = new NamedParameterJdbcTemplate(jdbc);
    this.scopes = scopes;
    this.guard = guard;
    this.finished = finished;
    this.accessory = accessory;
    this.json = json;
  }

  public CityPartnerStoreScope.Store require(String context) {
    guard.requireAnyPermission(FINISHED_PERMISSION, ACCESSORY_PERMISSION);
    guard.requireDataPermission();
    var store = scopes.require();
    if (context != null && !key(store).equals(context)) {
      throw new org.springframework.security.access.AccessDeniedException("当前身份或门店已变更，请重新打开选品中心");
    }
    return store;
  }

  public static String key(CityPartnerStoreScope.Store store) {
    return store.tenantId() + ":" + store.storeId() + ":" + store.accountId();
  }

  public Context context() {
    var store = require(null);
    String name = jdbc.queryForObject("SELECT name FROM stores WHERE id=? AND tenant_id=?", String.class,
        store.storeId(), store.tenantId());
    return new Context(key(store), name, Map.of("finished", canMaintain("finished"), "accessory", canMaintain("accessory")));
  }

  public boolean canMaintain(String type) {
    return guard.hasPermission("finished".equals(validType(type)) ? FINISHED_PERMISSION : ACCESSORY_PERMISSION);
  }

  public static String validType(String type) {
    if (type == null || !List.of("finished", "accessory").contains(type)) { throw new IllegalArgumentException("商品类型无效"); }
    return type;
  }

  public List<Category> categories(String context) {
    require(context);
    return jdbc.query("SELECT scope,id,parent_id,name FROM product_categories WHERE tenant_id IS NULL"
        + " AND scope IN ('finished','accessory') ORDER BY sort_order,id",
        (r, i) -> new Category(r.getString("scope"), r.getLong("id"), r.getObject("parent_id", Long.class), r.getString("name")));
  }

  // SQL identifiers are selected exclusively from the validated enum, never request text.
  private String sourceSelect(String type) {
    validType(type);
    return "SELECT '" + type + "' AS product_type,p.id,p.name,p.category_id,p.created_at,p.total_stock,p.source_status,"
        + "p.status,p.operations_deleted,p.operations_invalidated_at,"
        + "EXISTS(SELECT 1 FROM store_" + type + "_products l WHERE l.store_id=:store AND l."
        + type + "_product_id=p.id) AS added_to_store, s.id AS selection_id,s.added_at FROM " + type + "_products p"
        + " LEFT JOIN store_selection_items s ON s.store_id=:store AND s.account_id=:account"
        + " AND s.tenant_id=:tenant AND s.product_type='" + type + "' AND s.product_id=p.id";
  }

  private Map<String, Object> parameters(CityPartnerStoreScope.Store store) {
    Map<String, Object> args = new LinkedHashMap<>();
    args.put("store", store.storeId()); args.put("account", store.accountId()); args.put("tenant", store.tenantId());
    return args;
  }

  public Page products(String context, String keyword, List<String> types, List<String> states,
      String categoryType, Long categoryId, int page, int pageSize) {
    var store = require(context);
    validatePage(page, pageSize);
    var args = parameters(store);
    String sql = "SELECT * FROM (" + sourceSelect("finished") + " UNION ALL " + sourceSelect("accessory")
        + ") catalog WHERE status='selling' AND source_status IN ('selling','soldOut')"
        + " AND operations_deleted=FALSE AND operations_invalidated_at IS NULL";
    if (keyword != null && !keyword.isBlank()) {
      // LOCATE is literal substring search: '%' and '_' are not wildcard operators.
      sql += " AND LOCATE(:keyword,name)>0"; args.put("keyword", keyword.trim());
    }
    if (types != null && !types.isEmpty()) {
      types.forEach(StoreSelectionCatalog::validType);
      sql += " AND product_type IN (:types)"; args.put("types", types);
    }
    if (states != null && !states.isEmpty()) {
      if (states.stream().anyMatch(s -> !List.of("added", "unadded").contains(s))) {
        throw new IllegalArgumentException("加入状态无效");
      }
      if (states.stream().distinct().count() == 1) {
        sql += " AND added_to_store=" + (states.contains("added") ? "TRUE" : "FALSE");
      }
    }
    if (categoryId != null) {
      validType(categoryType);
      List<Category> tree = categories(context).stream().filter(c -> c.type().equals(categoryType)).toList();
      if (tree.stream().noneMatch(c -> c.id().equals(categoryId))) { throw new IllegalArgumentException("商品分类无效"); }
      Set<Long> ids = new HashSet<>(Set.of(categoryId));
      boolean changed;
      do { changed = false; for (var c : tree) { if (ids.contains(c.parentId())) { changed |= ids.add(c.id()); } } } while (changed);
      sql += " AND product_type=:categoryType AND category_id IN (:categoryIds)";
      args.put("categoryType", categoryType); args.put("categoryIds", ids);
    }
    Long total = named.queryForObject("SELECT COUNT(*) FROM (" + sql + ") counted", args, Long.class);
    args.put("limit", pageSize); args.put("offset", ((long) page - 1) * pageSize);
    var rows = named.queryForList(sql + " ORDER BY created_at DESC,product_type ASC,id DESC LIMIT :limit OFFSET :offset", args);
    return new Page(rows.stream().map(this::project).toList(), total == null ? 0 : total, page, pageSize);
  }

  public Page selection(String context, String type, int page, int pageSize) {
    var store = require(context); validType(type); validatePage(page, pageSize);
    var args = parameters(store); args.put("type", type);
    Long count = named.queryForObject("SELECT COUNT(*) FROM store_selection_items WHERE tenant_id=:tenant"
        + " AND store_id=:store AND account_id=:account AND product_type=:type", args, Long.class);
    args.put("limit", pageSize); args.put("offset", ((long) page - 1) * pageSize);
    var selected = named.queryForList("SELECT id,product_id,added_at FROM store_selection_items WHERE tenant_id=:tenant"
        + " AND store_id=:store AND account_id=:account AND product_type=:type ORDER BY added_at DESC,id DESC"
        + " LIMIT :limit OFFSET :offset", args);
    List<Product> rows = new ArrayList<>();
    for (var entry : selected) {
      var row = sourceRow(store, type, number(entry.get("product_id")));
      if (row == null) {
        rows.add(new Product(type, number(entry.get("product_id")), "商品当前不可用", null, null, null, null, null,
            false, false, true, false, List.of("商品当前不可用，无法加入门店。"), number(entry.get("id")), time(entry.get("added_at"))));
      } else { rows.add(project(row)); }
    }
    return new Page(rows, count == null ? 0 : count, page, pageSize);
  }

  public Map<String, Long> counts(String context) {
    var store = require(context);
    Map<String, Long> counts = new LinkedHashMap<>(Map.of("finished", 0L, "accessory", 0L));
    jdbc.queryForList("SELECT product_type,COUNT(*) AS amount FROM store_selection_items"
        + " WHERE tenant_id=? AND store_id=? AND account_id=? GROUP BY product_type", store.tenantId(), store.storeId(), store.accountId())
        .forEach(row -> counts.put((String) row.get("product_type"), ((Number) row.get("amount")).longValue()));
    return counts;
  }

  Map<String, Object> sourceRow(CityPartnerStoreScope.Store store, String type, Long id) {
    var args = parameters(store); args.put("id", id);
    var rows = named.queryForList(sourceSelect(type) + " WHERE p.id=:id", args);
    return rows.isEmpty() ? null : rows.getFirst();
  }

  static boolean browsable(Map<String, Object> row) {
    return row != null && "selling".equals(row.get("status"))
        && List.of("selling", "soldOut").contains(row.get("source_status"))
        && !flag(row.get("operations_deleted")) && row.get("operations_invalidated_at") == null;
  }

  private Map<String, Object> information(String type, Long id) {
    Object detail = "finished".equals(type) ? finished.selectionCenterDetail(id) : accessory.selectionCenterDetail(id);
    Map<String, Object> map = json.convertValue(detail, new TypeReference<LinkedHashMap<String, Object>>() {});
    List<Map<String, Object>> skus = json.convertValue(map.get("skus"), new TypeReference<List<Map<String, Object>>>() {});
    skus.forEach(sku -> sku.remove("guidePrice"));
    map.put("skus", skus);
    return map;
  }

  public Detail detail(String context, String type, Long id) {
    var store = require(context); validType(type);
    var row = sourceRow(store, type, id);
    if (!browsable(row)) { throw new IllegalArgumentException("商品当前不可用"); }
    Map<String, Object> info = information(type, id);
    return new Detail(project(row, info), info);
  }

  private Product project(Map<String, Object> row) {
    String type = (String) row.get("product_type");
    return project(row, browsable(row) ? information(type, number(row.get("id"))) : Map.of());
  }

  private Product project(Map<String, Object> row, Map<String, Object> info) {
    String type = (String) row.get("product_type");
    List<String> reasons = new ArrayList<>();
    boolean added = flag(row.get("added_to_store"));
    boolean sold = "soldOut".equals(row.get("source_status")) || number(row.get("total_stock")) <= 0;
    if (added) { reasons.add("该商品已加入门店，请勿重复添加。"); }
    if (!browsable(row)) { reasons.add("商品已下架，无法加入门店。"); }
    if (sold) { reasons.add("该商品已售完，无法加入门店。"); }
    if (!canMaintain(type)) { reasons.add("无" + ("finished".equals(type) ? "成品现货" : "配件") + "维护权限"); }
    List<BigDecimal> prices = new ArrayList<>();
    boolean incomplete = false;
    Object value = info.get("skus");
    if (value instanceof List<?> skus) {
      incomplete = skus.isEmpty();
      for (Object item : skus) {
        Object amount = ((Map<?, ?>) item).get("partnerPrice");
        if (amount == null) { incomplete = true; } else { prices.add(new BigDecimal(amount.toString())); }
      }
      if (incomplete) { reasons.add("请先完善当前门店级别的商品价格配置"); }
    }
    return new Product(type, number(row.get("id")), (String) row.get("name"), number(row.get("category_id")),
        time(row.get("created_at")), (String) info.get("imageUrl"),
        prices.stream().min(BigDecimal::compareTo).orElse(null), prices.stream().max(BigDecimal::compareTo).orElse(null),
        sold, added, row.get("selection_id") != null, reasons.isEmpty(), reasons, number(row.get("selection_id")), time(row.get("added_at")));
  }

  public static Long number(Object value) { return value == null ? null : ((Number) value).longValue(); }
  private static LocalDateTime time(Object value) { return value instanceof java.sql.Timestamp t ? t.toLocalDateTime() : (LocalDateTime) value; }
  private static boolean flag(Object value) { return Boolean.TRUE.equals(value) || value instanceof Number n && n.intValue() != 0; }
  private static void validatePage(int page, int size) {
    if (page < 1 || !List.of(5, 10, 20, 40).contains(size)) { throw new IllegalArgumentException("分页参数无效"); }
  }
}
