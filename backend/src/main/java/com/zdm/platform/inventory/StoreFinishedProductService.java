package com.zdm.platform.inventory;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Store-owned selection and prices over the shared finished-product catalog and stock. */
@Service
public class StoreFinishedProductService {
  public record RolePrice(Long roleId, String roleName, BigDecimal coefficient, BigDecimal price,
      String priceSource) {}
  public record SkuPrice(Long skuId, String label, Integer stock, BigDecimal costPrice,
      BigDecimal guidePrice, String guideSource, List<RolePrice> rolePrices,
      String displayMode, Map<String, String> salesAttributes, String material,
      String lengthValue, String color, String sizeValue) {}
  public record ProductView(Long id, Long productId, String name, String merchantCode,
      String status, String effectiveStatus, boolean sourceUnavailable, String sourceMessage,
      Integer totalStock, String imageUrl, List<String> imageUrls, String videoUrl,
      String detail, Long categoryId, String categoryName, Long supplierId, String supplierName,
      List<FinishedProductAttributeEntry> attributes, List<FinishedSpecDimension> specDimensions,
      List<SkuPrice> skus, LocalDateTime createdAt, String offShelfReason,
      String offShelfDetail, LocalDateTime offShelfAt) {}
  public record PoolProduct(Long id, String name, String merchantCode, Integer totalStock,
      String imageUrl, Long categoryId, String supplierName) {}
  public record LogEntry(Long id, Long listingId, Long productId, String productName,
      String operationType, String operationSummary, String beforeStatus, String afterStatus,
      String changeDetails, String operatorName, LocalDateTime operatedAt) {}
  public record EffectiveMinimumPrice(BigDecimal price, Long roleId) {}

  private final JdbcTemplate jdbc;
  private final CityPartnerStoreScope scopes;
  private final FinishedProductService products;
  private final FinishedProductMapper productMapper;
  private final ObjectMapper json;

  public StoreFinishedProductService(JdbcTemplate jdbc, CityPartnerStoreScope scopes,
      FinishedProductService products, FinishedProductMapper productMapper, ObjectMapper json) {
    this.jdbc = jdbc;
    this.scopes = scopes;
    this.products = products;
    this.productMapper = productMapper;
    this.json = json;
  }

  public List<PoolProduct> pool() {
    var store = scopes.require();
    return jdbc.query("""
        SELECT product.id, product.name, product.sku, product.total_stock,
          supplier.name AS supplier_name, product.category_id
        FROM finished_products product
        LEFT JOIN suppliers supplier ON supplier.id = product.supplier_id
        WHERE product.status = 'selling' AND product.source_status IN ('selling', 'soldOut')
          AND product.operations_deleted = FALSE AND product.total_stock > 0
          AND NOT EXISTS (SELECT 1 FROM store_finished_products selected
            WHERE selected.store_id = ? AND selected.finished_product_id = product.id)
        ORDER BY product.created_at DESC, product.id DESC
        """, (row, index) -> {
          Long id = row.getLong("id");
          FinishedProduct detailed = publicProduct(id);
          return new PoolProduct(id, row.getString("name"), row.getString("sku"),
              row.getInt("total_stock"), detailed.getMainImageUrl(),
              row.getObject("category_id", Long.class), row.getString("supplier_name"));
        }, store.storeId());
  }

  public List<ProductView> list() {
    var store = scopes.require();
    List<Long> ids = jdbc.queryForList("""
        SELECT id FROM store_finished_products
        WHERE tenant_id = ? AND store_id = ? ORDER BY created_at DESC, id DESC
        """, Long.class, store.tenantId(), store.storeId());
    return ids.stream().map(id -> view(store, listing(store, id, false))).toList();
  }

  public ProductView detail(Long id) {
    var store = scopes.require();
    return view(store, listing(store, id, false));
  }

  public EffectiveMinimumPrice currentEmployeeMinimumPrice(Long id, Long skuId) {
    var store = scopes.require();
    ProductView product = detail(id);
    SkuPrice sku = product.skus().stream().filter(item -> skuId.equals(item.skuId()))
        .findFirst().orElseThrow(() -> new IllegalArgumentException("商品规格不存在"));
    List<Long> roleIds = jdbc.queryForList("""
        SELECT role_id FROM account_roles WHERE account_id = ? AND tenant_id = ? AND store_id = ?
        """, Long.class, store.accountId(), store.tenantId(), store.storeId());
    return sku.rolePrices().stream().filter(price -> roleIds.contains(price.roleId())
        && price.price() != null)
        .min((left, right) -> left.price().compareTo(right.price()))
        .map(price -> new EffectiveMinimumPrice(price.price(), price.roleId()))
        .orElseThrow(() -> new IllegalArgumentException("当前员工的角色尚未配置可售最低价"));
  }

  @Transactional
  public List<ProductView> select(List<Long> productIds) {
    var store = scopes.require();
    if (productIds == null || productIds.isEmpty() || productIds.size() > 100
        || productIds.stream().anyMatch(Objects::isNull)
        || productIds.stream().distinct().count() != productIds.size()) {
      throw new IllegalArgumentException("请选择有效的商品，单次最多 100 件");
    }
    List<ProductView> selected = new ArrayList<>();
    for (Long productId : productIds) {
      Map<String, Object> source = source(productId, true);
      if (!isSelectable(source)) {
        throw new IllegalArgumentException("所选商品已不在运营端已上架商品池");
      }
      Long exists = jdbc.queryForObject("""
          SELECT COUNT(*) FROM store_finished_products WHERE store_id = ? AND finished_product_id = ?
          """, Long.class, store.storeId(), productId);
      if (exists != null && exists > 0) {
        throw new IllegalArgumentException("该商品已在本门店成品现货中");
      }
      jdbc.update("""
          INSERT INTO store_finished_products
            (tenant_id, store_id, finished_product_id, status, selected_by_account_id)
          VALUES (?, ?, ?, 'warehouse', ?)
          """, store.tenantId(), store.storeId(), productId, store.accountId());
      Long listingId = jdbc.queryForObject("""
          SELECT id FROM store_finished_products WHERE store_id = ? AND finished_product_id = ?
          """, Long.class, store.storeId(), productId);
      log(store, listingId, productId, (String) source.get("name"), "SELECT", "挑选商品进入仓库",
          null, "warehouse", Map.of("商品ID", productId));
      selected.add(detail(listingId));
    }
    return selected;
  }

  @Transactional
  public ProductView changeStatus(Long id, String target, String reason, String detail) {
    var store = scopes.require();
    Map<String, Object> listing = listing(store, id, true);
    Map<String, Object> source = source(number(listing.get("finished_product_id")), true);
    String current = (String) listing.get("status");
    if ("purged".equals(target)) {
      return purge(store, listing, source);
    }
    if (!isUsable(source)) {
      throw new IllegalArgumentException("上游商品不可用，只能查看或彻底删除");
    }
    if ("selling".equals(current) && stock(source) == 0) {
      throw new IllegalArgumentException("统一库存已售完，不能改变商品状态");
    }
    boolean allowed = switch (current) {
      case "warehouse" -> List.of("selling", "recycle").contains(target);
      case "selling" -> "offShelf".equals(target);
      case "offShelf" -> List.of("warehouse", "recycle").contains(target);
      case "recycle" -> "warehouse".equals(target);
      default -> false;
    };
    if (!allowed) {
      throw new IllegalArgumentException("当前门店商品状态不允许此操作");
    }
    if ("selling".equals(target)) {
      requireReadyToSell(store, id, source);
    }
    if ("offShelf".equals(target) && (reason == null || reason.isBlank())) {
      throw new IllegalArgumentException("请选择下架原因");
    }
    if (reason != null && reason.length() > 80 || detail != null && detail.length() > 500) {
      throw new IllegalArgumentException("下架说明超出长度限制");
    }
    jdbc.update("""
        UPDATE store_finished_products
        SET status = ?, off_shelf_reason = ?, off_shelf_detail = ?,
          off_shelf_at = CASE WHEN ? = 'offShelf' THEN CURRENT_TIMESTAMP ELSE NULL END
        WHERE id = ? AND tenant_id = ? AND store_id = ?
        """, target, "offShelf".equals(target) ? reason : null,
        "offShelf".equals(target) ? detail : null, target, id, store.tenantId(), store.storeId());
    String type = switch (target) {
      case "selling" -> "SHELF";
      case "offShelf" -> "OFF_SHELF";
      case "warehouse" -> "RESTORE";
      default -> "DELETE_TO_RECYCLE";
    };
    String summary = switch (target) {
      case "selling" -> "上架商品";
      case "offShelf" -> "下架商品";
      case "warehouse" -> "放回仓库";
      default -> "删除至回收站";
    };
    Map<String, Object> changes = new LinkedHashMap<>();
    changes.put("状态", Map.of("before", current, "after", target));
    if ("offShelf".equals(target)) {
      changes.put("下架原因", reason);
      if (detail != null && !detail.isBlank()) changes.put("详细说明", detail);
    }
    log(store, id, number(listing.get("finished_product_id")), (String) source.get("name"),
        type, summary, current, target, changes);
    return detail(id);
  }

  @Transactional
  public List<ProductView> changeStatusBatch(List<Long> ids, String target, String reason, String detail) {
    List<ProductView> changed = new ArrayList<>();
    for (Long id : ids) changed.add(changeStatus(id, target, reason, detail));
    return changed;
  }

  @Transactional
  public void purge(Long id) {
    var store = scopes.require();
    Map<String, Object> listing = listing(store, id, true);
    Map<String, Object> source = source(number(listing.get("finished_product_id")), true);
    purge(store, listing, source);
  }

  @Transactional
  public void purgeBatch(List<Long> ids) {
    for (Long id : ids) purge(id);
  }

  @Transactional
  public void clearRecycle() {
    var store = scopes.require();
    List<Long> ids = jdbc.queryForList("""
        SELECT id FROM store_finished_products
        WHERE tenant_id = ? AND store_id = ? AND status = 'recycle'
        """, Long.class, store.tenantId(), store.storeId());
    purgeBatch(ids);
  }

  private ProductView purge(CityPartnerStoreScope.Store store, Map<String, Object> listing,
      Map<String, Object> source) {
    String current = (String) listing.get("status");
    if (!"recycle".equals(current) && isUsable(source)) {
      throw new IllegalArgumentException("只有回收站或上游不可用的商品可以彻底删除");
    }
    Long listingId = number(listing.get("id"));
    Long productId = number(listing.get("finished_product_id"));
    log(store, listingId, productId, (String) source.get("name"), "PURGE", "彻底删除商品",
        current, "purged", Map.of("状态", Map.of("before", current, "after", "purged")));
    jdbc.update("DELETE FROM store_finished_products WHERE id = ? AND tenant_id = ? AND store_id = ?",
        listingId, store.tenantId(), store.storeId());
    return null;
  }

  @Transactional
  public ProductView saveGuidePrice(Long id, Long skuId, BigDecimal price) {
    var store = scopes.require();
    Map<String, Object> listing = listing(store, id, true);
    Map<String, Object> source = source(number(listing.get("finished_product_id")), true);
    requirePriceEditable(listing, source);
    requireSku(source, skuId);
    requirePrice(price);
    BigDecimal before = guidePrice(id, skuId, number(listing.get("finished_product_id")));
    jdbc.update("""
        INSERT INTO store_finished_guide_prices (listing_id, sku_id, manual_price, updated_by_account_id)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE manual_price = VALUES(manual_price),
          updated_by_account_id = VALUES(updated_by_account_id)
        """, id, skuId, price, store.accountId());
    Map<String, Object> priceChange = new LinkedHashMap<>();
    priceChange.put("before", before);
    priceChange.put("after", price);
    log(store, id, number(listing.get("finished_product_id")), (String) source.get("name"),
        "PRICE_UPDATE", "修改本店指导价", (String) listing.get("status"),
        (String) listing.get("status"), Map.of("SKU ID", skuId, "指导价", priceChange));
    return detail(id);
  }

  @Transactional
  public ProductView saveRolePrice(Long id, Long skuId, Long roleId, BigDecimal price,
      boolean followConfiguration) {
    var store = scopes.require();
    Map<String, Object> listing = listing(store, id, true);
    Map<String, Object> source = source(number(listing.get("finished_product_id")), true);
    requirePriceEditable(listing, source);
    requireSku(source, skuId);
    Long configuration = jdbc.queryForObject("""
        SELECT COUNT(*) FROM store_finished_role_price_configurations config
        JOIN roles role ON role.id = config.role_id
        WHERE config.store_id = ? AND config.tenant_id = ? AND config.role_id = ?
          AND config.status = 'enabled' AND role.status = 'enabled'
        """, Long.class, store.storeId(), store.tenantId(), roleId);
    if (configuration == null || configuration == 0) {
      throw new AccessDeniedException("该角色未启用本门店价格配置");
    }
    BigDecimal before = rolePrice(store, id, skuId, roleId,
        number(listing.get("finished_product_id")));
    if (followConfiguration) {
      jdbc.update("""
          DELETE FROM store_finished_role_price_overrides
          WHERE listing_id = ? AND sku_id = ? AND role_id = ?
          """, id, skuId, roleId);
    } else {
      requirePrice(price);
      jdbc.update("""
          INSERT INTO store_finished_role_price_overrides
            (listing_id, sku_id, role_id, manual_price, updated_by_account_id)
          VALUES (?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE manual_price = VALUES(manual_price),
            updated_by_account_id = VALUES(updated_by_account_id)
          """, id, skuId, roleId, price, store.accountId());
    }
    BigDecimal after = rolePrice(store, id, skuId, roleId,
        number(listing.get("finished_product_id")));
    Map<String, Object> priceChange = new LinkedHashMap<>();
    priceChange.put("before", before);
    priceChange.put("after", after);
    log(store, id, number(listing.get("finished_product_id")), (String) source.get("name"),
        "PRICE_UPDATE", "修改角色可售最低价", (String) listing.get("status"),
        (String) listing.get("status"), Map.of("SKU ID", skuId, "角色ID", roleId,
            "最低价", priceChange, "价格来源", followConfiguration ? "跟随配置" : "手工价格"));
    return detail(id);
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
        row.getString("after_status"), row.getString("change_details"),
        row.getString("operator_name"), row.getTimestamp("operated_at").toLocalDateTime()),
        store.tenantId(), store.storeId());
  }

  public LogEntry logDetail(Long id) {
    return logs().stream().filter(log -> log.id().equals(id)).findFirst()
        .orElseThrow(() -> new IllegalArgumentException("本门店操作日志不存在"));
  }

  private ProductView view(CityPartnerStoreScope.Store store, Map<String, Object> listing) {
    Long productId = number(listing.get("finished_product_id"));
    FinishedProduct product = publicProduct(productId);
    Map<String, Object> source = source(productId, false);
    boolean unavailable = !isUsable(source);
    String status = (String) listing.get("status");
    String effective = "selling".equals(status) && stock(source) == 0 ? "soldOut" : status;
    String reason = !List.of("selling", "soldOut").contains(product.getSourceStatus())
        ? "该商品已被供应链下架或删除"
        : !List.of("selling", "soldOut").contains(product.getStatus())
            || Boolean.TRUE.equals(product.getOperationsDeleted())
            ? "该商品已被运营管理平台下架或删除" : null;
    String supplierName = jdbc.query("SELECT name FROM suppliers WHERE id = ?",
        (row, index) -> row.getString("name"), product.getSupplierId()).stream().findFirst().orElse(null);
    String categoryName = jdbc.query("SELECT name FROM product_categories WHERE id = ?",
        (row, index) -> row.getString("name"), product.getCategoryId()).stream().findFirst().orElse(null);
    List<SkuPrice> prices = product.getVariants() == null ? List.of()
        : product.getVariants().stream().map(variant -> skuPrice(store, listing, product, variant)).toList();
    return new ProductView(number(listing.get("id")), productId, product.getName(), product.getSku(),
        status, effective, unavailable, reason, product.getTotalStock(), product.getMainImageUrl(),
        product.getMainImageUrls() == null ? List.of() : product.getMainImageUrls(), product.getVideoUrl(),
        product.getDetail(), product.getCategoryId(), categoryName, product.getSupplierId(), supplierName,
        product.getAttributes() == null ? List.of() : product.getAttributes(), product.getSpecDimensions(),
        prices, timestamp(listing.get("created_at")), (String) listing.get("off_shelf_reason"),
        (String) listing.get("off_shelf_detail"), timestamp(listing.get("off_shelf_at")));
  }

  private SkuPrice skuPrice(CityPartnerStoreScope.Store store, Map<String, Object> listing,
      FinishedProduct product, FinishedProductVariant variant) {
    Long listingId = number(listing.get("id"));
    Long skuId = variant.getId();
    BigDecimal cost = product.getMarkupPrices() == null ? null : product.getMarkupPrices().stream()
        .filter(price -> Objects.equals(price.getSkuId(), skuId)
            && Objects.equals(price.getStoreLevelId(), store.storeLevelId()))
        .map(FinishedProductPrice::getPrice).findFirst().orElse(null);
    BigDecimal operationsGuide = product.getGuidePrices() == null ? null : product.getGuidePrices().stream()
        .filter(price -> Objects.equals(price.getSkuId(), skuId))
        .map(FinishedProductGuidePrice::getPrice).findFirst().orElse(null);
    List<BigDecimal> manualGuide = jdbc.queryForList("""
        SELECT manual_price FROM store_finished_guide_prices WHERE listing_id = ? AND sku_id = ?
        """, BigDecimal.class, listingId, skuId);
    BigDecimal guide = manualGuide.isEmpty() ? operationsGuide : manualGuide.getFirst();
    List<RolePrice> rolePrices = jdbc.query("""
        SELECT config.role_id, role.name AS role_name, config.price_coefficient,
          override_price.manual_price
        FROM store_finished_role_price_configurations config
        JOIN roles role ON role.id = config.role_id AND role.status = 'enabled'
        LEFT JOIN store_finished_role_price_overrides override_price
          ON override_price.listing_id = ? AND override_price.sku_id = ?
          AND override_price.role_id = config.role_id
        WHERE config.tenant_id = ? AND config.store_id = ? AND config.status = 'enabled'
        ORDER BY role.created_at DESC, role.id DESC
        """, (row, index) -> {
          BigDecimal manual = row.getBigDecimal("manual_price");
          BigDecimal coefficient = row.getBigDecimal("price_coefficient");
          BigDecimal effective = manual == null && cost != null
              ? cost.multiply(coefficient).setScale(2, RoundingMode.HALF_UP) : manual;
          return new RolePrice(row.getLong("role_id"), row.getString("role_name"),
              coefficient, effective, manual == null ? "auto" : "manual");
        }, listingId, skuId, store.tenantId(), store.storeId());
    return new SkuPrice(skuId, variant.getVariantLabel(), variant.getStock(), cost, guide,
        manualGuide.isEmpty() ? "auto" : "manual", rolePrices, variant.getDisplayMode(),
        variant.getSalesAttributes(), variant.getMaterial(), variant.getLengthValue(),
        variant.getColor(), variant.getSizeValue());
  }

  private FinishedProduct publicProduct(Long productId) {
    FinishedProduct product = productMapper.selectById(productId);
    if (product == null) throw new IllegalArgumentException("来源商品不存在");
    // Product selection and reads are scoped by CityPartnerStoreScope and the store listing;
    // FinishedProductService.getById checks the platform creator and rejects store self-scope.
    return products.withDetails(product);
  }

  private void requireReadyToSell(CityPartnerStoreScope.Store store, Long listingId,
      Map<String, Object> source) {
    if (stock(source) <= 0) throw new IllegalArgumentException("统一库存已售完，不能上架");
    ProductView view = view(store, listing(store, listingId, false));
    List<SkuPrice> sellableSkus = view.skus().stream()
        .filter(sku -> sku.stock() != null && sku.stock() > 0).toList();
    if (sellableSkus.isEmpty() || sellableSkus.stream().anyMatch(sku ->
        sku.costPrice() == null || sku.guidePrice() == null)) {
      throw new IllegalArgumentException("请先完善每条可售规格的成本价和指导价");
    }
    if (sellableSkus.stream().anyMatch(sku -> sku.rolePrices().isEmpty()
        || sku.rolePrices().stream().anyMatch(price -> price.price() == null))) {
      throw new IllegalArgumentException("请先配置角色可售最低价");
    }
  }

  private void requirePriceEditable(Map<String, Object> listing, Map<String, Object> source) {
    if (!isUsable(source) || !List.of("warehouse", "selling").contains(listing.get("status"))
        || "selling".equals(listing.get("status")) && stock(source) == 0) {
      throw new IllegalArgumentException("当前商品只能查看价格，不能修改");
    }
  }

  private void requireSku(Map<String, Object> source, Long skuId) {
    Long count = jdbc.queryForObject("""
        SELECT COUNT(*) FROM finished_product_variants
        WHERE id = ? AND finished_product_id = ?
        """, Long.class, skuId, source.get("id"));
    if (count == null || count == 0) throw new IllegalArgumentException("商品规格不存在");
  }

  private BigDecimal guidePrice(Long listingId, Long skuId, Long productId) {
    List<BigDecimal> manual = jdbc.queryForList("""
        SELECT manual_price FROM store_finished_guide_prices WHERE listing_id = ? AND sku_id = ?
        """, BigDecimal.class, listingId, skuId);
    if (!manual.isEmpty()) return manual.getFirst();
    List<BigDecimal> source = jdbc.queryForList("""
        SELECT price FROM finished_product_guide_prices WHERE finished_product_id = ? AND sku_id = ?
        """, BigDecimal.class, productId, skuId);
    return source.isEmpty() ? null : source.getFirst();
  }

  private BigDecimal rolePrice(CityPartnerStoreScope.Store store, Long listingId,
      Long skuId, Long roleId, Long productId) {
    List<BigDecimal> manual = jdbc.queryForList("""
        SELECT manual_price FROM store_finished_role_price_overrides
        WHERE listing_id = ? AND sku_id = ? AND role_id = ?
        """, BigDecimal.class, listingId, skuId, roleId);
    if (!manual.isEmpty()) return manual.getFirst();
    List<Map<String, Object>> prices = jdbc.queryForList("""
        SELECT partner.price AS cost_price, config.price_coefficient
        FROM store_finished_role_price_configurations config
        JOIN stores store ON store.id = config.store_id
        JOIN finished_product_prices partner ON partner.store_level_id = store.store_level_id
          AND partner.finished_product_id = ? AND partner.sku_id = ?
        WHERE config.store_id = ? AND config.tenant_id = ? AND config.role_id = ?
          AND config.status = 'enabled'
        """, productId, skuId, store.storeId(), store.tenantId(), roleId);
    if (prices.isEmpty()) return null;
    Map<String, Object> row = prices.getFirst();
    return ((BigDecimal) row.get("cost_price")).multiply((BigDecimal) row.get("price_coefficient"))
        .setScale(2, RoundingMode.HALF_UP);
  }

  private Map<String, Object> listing(CityPartnerStoreScope.Store store, Long id, boolean lock) {
    List<Map<String, Object>> rows = jdbc.queryForList("""
        SELECT * FROM store_finished_products
        WHERE id = ? AND tenant_id = ? AND store_id = ?
        """ + (lock ? " FOR UPDATE" : ""), id, store.tenantId(), store.storeId());
    if (rows.isEmpty()) throw new IllegalArgumentException("本门店商品不存在或不可访问");
    return rows.getFirst();
  }

  private Map<String, Object> source(Long id, boolean lock) {
    List<Map<String, Object>> rows = jdbc.queryForList("SELECT * FROM finished_products WHERE id = ?"
        + (lock ? " FOR UPDATE" : ""), id);
    if (rows.isEmpty()) throw new IllegalArgumentException("来源商品不存在");
    return rows.getFirst();
  }

  private static boolean isSelectable(Map<String, Object> source) {
    return "selling".equals(source.get("status"))
        && List.of("selling", "soldOut").contains(source.get("source_status"))
        && !flag(source.get("operations_deleted")) && stock(source) > 0;
  }

  private static boolean isUsable(Map<String, Object> source) {
    return List.of("selling", "soldOut").contains(source.get("status"))
        && List.of("selling", "soldOut").contains(source.get("source_status"))
        && !flag(source.get("operations_deleted"));
  }

  private static boolean flag(Object value) {
    return Boolean.TRUE.equals(value) || value instanceof Number number && number.intValue() != 0;
  }

  private static int stock(Map<String, Object> source) {
    Object value = source.get("total_stock");
    return value instanceof Number number ? number.intValue() : 0;
  }

  private static Long number(Object value) {
    return value instanceof Number number ? number.longValue() : null;
  }

  private static LocalDateTime timestamp(Object value) {
    return value instanceof Timestamp time ? time.toLocalDateTime() : null;
  }

  private static void requirePrice(BigDecimal price) {
    if (price == null || price.scale() > 2 || price.signum() < 0) {
      throw new IllegalArgumentException("请输入正确的价格");
    }
  }

  private void log(CityPartnerStoreScope.Store store, Long listingId, Long productId,
      String name, String type, String summary, String before, String after,
      Map<String, Object> changes) {
    String serialized;
    try {
      serialized = json.writeValueAsString(changes);
    } catch (JsonProcessingException exception) {
      throw new IllegalStateException("成品现货操作日志序列化失败", exception);
    }
    jdbc.update("""
        INSERT INTO store_finished_operation_logs
          (tenant_id, store_id, listing_id, finished_product_id, product_name,
           operation_type, operation_summary, before_status, after_status, change_details,
           operator_account_id, operator_name)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, store.tenantId(), store.storeId(), listingId, productId, name, type, summary,
        before, after, serialized, store.accountId(), store.operatorName());
  }
}
