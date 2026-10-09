package com.zdm.platform.inventory;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.function.Function;
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
      BigDecimal guidePrice, List<RolePrice> rolePrices,
      String displayMode, Map<String, String> salesAttributes, String material,
      String lengthValue, String color, String sizeValue) {
    public SkuPrice {
      rolePrices = List.copyOf(rolePrices);
      salesAttributes = salesAttributes == null ? null
          : Collections.unmodifiableMap(new LinkedHashMap<>(salesAttributes));
    }
  }
  public record ProductView(Long id, Long productId, String name, String merchantCode,
      String status, String effectiveStatus, boolean sourceUnavailable, String sourceMessage,
      Integer totalStock, String imageUrl, List<String> imageUrls, String videoUrl,
      String detail, Long categoryId, String categoryName,
      List<FinishedProductAttributeEntry> attributes, List<FinishedSpecDimension> specDimensions,
      List<SkuPrice> skus, String createdByName, LocalDateTime createdAt, String offShelfReason,
      String offShelfDetail, LocalDateTime offShelfAt, Map<String, String> attributeNames,
      String storeLevelName) {
    public ProductView {
      imageUrls = List.copyOf(imageUrls);
      attributes = List.copyOf(attributes);
      specDimensions = specDimensions == null ? null : List.copyOf(specDimensions);
      skus = List.copyOf(skus);
      attributeNames = Map.copyOf(attributeNames);
    }

    public List<String> imageUrls() { return List.copyOf(imageUrls); }
    public List<FinishedProductAttributeEntry> attributes() { return List.copyOf(attributes); }
    public List<FinishedSpecDimension> specDimensions() {
      return specDimensions == null ? null : List.copyOf(specDimensions);
    }
    public List<SkuPrice> skus() { return List.copyOf(skus); }
    public Map<String, String> attributeNames() { return Map.copyOf(attributeNames); }
  }
  public record PoolProduct(Long id, String name, String merchantCode, Integer totalStock,
      String imageUrl, Long categoryId, BigDecimal guidePriceMin,
      BigDecimal guidePriceMax, BigDecimal partnerPriceMin, BigDecimal partnerPriceMax,
      String storeLevelName) {}
  public record PoolSku(Long skuId, String label, Integer stock, BigDecimal guidePrice,
      BigDecimal partnerPrice, String displayMode, Map<String, String> salesAttributes,
      String material, String lengthValue, String color, String sizeValue) {
    public PoolSku {
      salesAttributes = salesAttributes == null ? null
          : Collections.unmodifiableMap(new LinkedHashMap<>(salesAttributes));
    }
  }
  public record PoolDetail(Long id, String name, String merchantCode, Integer totalStock,
      String imageUrl, List<String> imageUrls, String videoUrl, String detail,
      String categoryName, List<FinishedProductAttributeEntry> attributes,
      List<FinishedSpecDimension> specDimensions, List<PoolSku> skus, Map<String, String> attributeNames,
      String storeLevelName) {
    public PoolDetail {
      imageUrls = List.copyOf(imageUrls);
      attributes = List.copyOf(attributes);
      specDimensions = List.copyOf(specDimensions);
      skus = List.copyOf(skus);
      attributeNames = Map.copyOf(attributeNames);
    }
  }
  public record LogEntry(Long id, Long listingId, Long productId, String productName,
      String operationType, String operationSummary, String beforeStatus, String afterStatus,
      String changeDetails, String operatorName, LocalDateTime operatedAt) {}
  public record LogPage(List<LogEntry> records, long total, int page, int pageSize) {
    public LogPage {
      records = List.copyOf(records);
    }
  }
  public record EffectiveMinimumPrice(BigDecimal price, Long roleId) {}

  private final FinishedInvalidationMedia invalidationMedia;
  private final JdbcTemplate jdbc;
  private final CityPartnerStoreScope scopes;
  private final FinishedProductService products;
  private final FinishedProductMapper productMapper;
  private final ObjectMapper json;
  private final StoreFinishedLogReader logReader;
  private final StoreFinishedSelectionSnapshot selectionSnapshots;

  public StoreFinishedProductService(JdbcTemplate jdbc, CityPartnerStoreScope scopes,
      FinishedProductService products, FinishedProductMapper productMapper, ObjectMapper json, StoreFinishedSelectionSnapshot selectionSnapshots, FinishedInvalidationMedia invalidationMedia) {
    this.invalidationMedia = invalidationMedia;
    this.jdbc = jdbc;
    this.scopes = scopes;
    this.products = products;
    this.productMapper = productMapper;
    this.json = json;
    this.selectionSnapshots = selectionSnapshots;
    this.logReader = new StoreFinishedLogReader(jdbc, scopes, selectionSnapshots);
  }

  public record PoolCategory(Long id, Long parentId, String name) {}

  public List<PoolCategory> listCategories() {
    scopes.require();
    return jdbc.query("""
        SELECT id, parent_id, name FROM product_categories
        WHERE scope = 'finished' AND tenant_id IS NULL AND status = 'enabled'
        ORDER BY sort_order, id
        """, (row, index) -> new PoolCategory(row.getLong("id"),
            row.getObject("parent_id", Long.class), row.getString("name")));
  }

  public List<PoolCategory> poolCategories() {
    scopes.require();
    return jdbc.query("""
        SELECT id, parent_id, name FROM product_categories
        WHERE scope = 'finished' AND tenant_id IS NULL
        ORDER BY sort_order, id
        """, (row, index) -> new PoolCategory(row.getLong("id"),
            row.getObject("parent_id", Long.class), row.getString("name")));
  }

  public List<PoolProduct> pool() {
    var store = scopes.require();
    List<Map<String, Object>> rows = jdbc.queryForList("""
        SELECT product.id, product.name, product.sku, product.total_stock,
          product.category_id
        FROM finished_products product
        WHERE product.status = 'selling' AND product.source_status IN ('selling', 'soldOut')
          AND product.operations_deleted = FALSE AND product.operations_invalidated_at IS NULL AND product.total_stock > 0
          AND NOT EXISTS (SELECT 1 FROM store_finished_products selected
            WHERE selected.store_id = ? AND selected.finished_product_id = product.id
)
        ORDER BY product.created_at DESC, product.id DESC
        """, store.storeId());
    if (rows.isEmpty()) {
      return List.of();
    }
    List<Long> ids = rows.stream().map(row -> number(row.get("id"))).toList();
    Map<Long, FinishedProduct> details = products.withListDetails(
        productMapper.selectBatchIds(ids)).stream()
        .collect(java.util.stream.Collectors.toMap(FinishedProduct::getId, product -> product));
    String storeLevelName = store.storeLevelId() == null ? null
        : namesById("store_levels", List.of(store.storeLevelId())).get(store.storeLevelId());
    return rows.stream().map(row -> {
      Long id = number(row.get("id"));
      FinishedProduct detailed = details.get(id);
      if (detailed == null) {
        throw new IllegalArgumentException("来源商品不存在");
      }
      return new PoolProduct(id, (String) row.get("name"), (String) row.get("sku"),
          ((Number) row.get("total_stock")).intValue(), detailed.getMainImageUrl(),
          number(row.get("category_id")),
          priceBound(detailed, sku -> guidePrice(detailed, sku.getId()), false),
          priceBound(detailed, sku -> guidePrice(detailed, sku.getId()), true),
          priceBound(detailed, sku -> partnerPrice(store, detailed, sku.getId()), false),
          priceBound(detailed, sku -> partnerPrice(store, detailed, sku.getId()), true), storeLevelName);
    }).toList();
  }

  private BigDecimal priceBound(FinishedProduct product,
      Function<FinishedProductVariant, BigDecimal> price, boolean maximum) {
    var values = (product.getVariants() == null ? List.<FinishedProductVariant>of()
        : product.getVariants()).stream().map(price).filter(Objects::nonNull);
    return (maximum ? values.max(BigDecimal::compareTo) : values.min(BigDecimal::compareTo))
        .orElse(null);
  }

  public PoolDetail poolDetail(Long id) {
    var store = scopes.require();
    Long available = jdbc.queryForObject("""
        SELECT COUNT(*) FROM finished_products product
        WHERE product.id = ? AND product.status = 'selling'
          AND product.source_status IN ('selling', 'soldOut')
          AND product.operations_deleted = FALSE AND product.operations_invalidated_at IS NULL AND product.total_stock > 0
          AND NOT EXISTS (SELECT 1 FROM store_finished_products selected
            WHERE selected.store_id = ? AND selected.finished_product_id = product.id
)
        """, Long.class, id, store.storeId());
    if (available == null || available == 0) {
      throw new IllegalArgumentException("商品不存在或不可挑选");
    }
    FinishedProduct product = publicProduct(id);
    String categoryName = poolCategoryPath(product.getCategoryId());
    List<PoolSku> skus = (product.getVariants() == null ? List.<FinishedProductVariant>of()
        : product.getVariants()).stream().map(sku -> new PoolSku(sku.getId(),
            sku.getVariantLabel(), sku.getStock(), guidePrice(product, sku.getId()),
            partnerPrice(store, product, sku.getId()), sku.getDisplayMode(),
            sku.getSalesAttributes(), sku.getMaterial(), sku.getLengthValue(),
            sku.getColor(), sku.getSizeValue())).toList();
    return new PoolDetail(id, product.getName(), product.getSku(), product.getTotalStock(),
        product.getMainImageUrl(), product.getMainImageUrls() == null ? List.of()
            : product.getMainImageUrls(), product.getVideoUrl(), product.getDetail(),
        categoryName, product.getAttributes() == null ? List.of()
            : product.getAttributes(), product.getSpecDimensions() == null ? List.of()
            : product.getSpecDimensions(), skus, poolAttributeNames(skus),
        store.storeLevelId() == null ? null
            : namesById("store_levels", List.of(store.storeLevelId())).get(store.storeLevelId()));
  }

  private String poolCategoryPath(Long categoryId) {
    List<String> names = new ArrayList<>();
    java.util.Set<Long> visited = new java.util.HashSet<>();
    Long current = categoryId;
    while (current != null && current != 0 && visited.add(current)) {
      List<Map<String, Object>> rows = jdbc.queryForList("""
          SELECT name, parent_id FROM product_categories
          WHERE id = ? AND scope = 'finished' AND tenant_id IS NULL
          """, current);
      if (rows.isEmpty()) {
        names.addFirst("历史上级类目已不可用");
        break;
      }
      names.addFirst((String) rows.getFirst().get("name"));
      current = number(rows.getFirst().get("parent_id"));
    }
    return names.isEmpty() ? null : String.join(" / ", names);
  }

  private Map<Long, String> categoryPaths() {
    Map<Long, Map<String, Object>> categories = new LinkedHashMap<>();
    jdbc.queryForList("SELECT id,name,parent_id FROM product_categories WHERE scope='finished' AND tenant_id IS NULL")
        .forEach(row -> categories.put(number(row.get("id")), row));
    Map<Long, String> paths = new LinkedHashMap<>();
    for (Long id : categories.keySet()) {
      List<String> names = new ArrayList<>();
      java.util.Set<Long> visited = new java.util.HashSet<>();
      Long current = id;
      while (current != null && current != 0 && visited.add(current)) {
        Map<String, Object> category = categories.get(current);
        if (category == null) {
          names.addFirst("历史上级类目已不可用");
          break;
        }
        names.addFirst((String) category.get("name"));
        current = number(category.get("parent_id"));
      }
      paths.put(id, String.join(" / ", names));
    }
    return paths;
  }

  private Map<String, String> poolAttributeNames(List<PoolSku> skus) {
    return attributeNamesForKeys(skus.stream().filter(sku -> sku.salesAttributes() != null)
        .flatMap(sku -> sku.salesAttributes().keySet().stream()).toList());
  }

  private Map<String, String> attributeNamesForKeys(List<String> keys) {
    List<Long> ids = keys.stream()
        .filter(key -> key.matches("attribute_[0-9]{1,18}"))
        .map(key -> Long.valueOf(key.substring("attribute_".length()))).distinct().toList();
    if (ids.isEmpty()) { return Map.of(); }
    Map<String, String> names = new LinkedHashMap<>();
    queryByIds("SELECT id, name FROM product_attributes WHERE scope IN ('shared', 'finished') AND id IN (", ids)
        .forEach(row -> names.put("attribute_" + number(row.get("id")), (String) row.get("name")));
    return names;
  }

  public List<ProductView> list() {
    var store = scopes.require();
    List<Map<String, Object>> listings = jdbc.queryForList("""
        SELECT listing.*, (SELECT history.operator_name FROM store_finished_operation_logs history
          WHERE history.listing_id = listing.id AND history.tenant_id = listing.tenant_id
            AND history.store_id = listing.store_id AND history.operation_type = 'SELECT'
          ORDER BY history.id LIMIT 1) AS created_by_name
        FROM store_finished_products listing
        JOIN finished_products product ON product.id = listing.finished_product_id
        WHERE listing.tenant_id = ? AND listing.store_id = ?
        ORDER BY listing.created_at DESC, listing.id DESC
        """, store.tenantId(), store.storeId());
    if (listings.isEmpty()) { return List.of(); }
    return listViews(store, listings);
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
          SELECT COUNT(*) FROM store_finished_products
          WHERE store_id = ? AND finished_product_id = ?
          """, Long.class, store.storeId(), productId);
      if (exists != null && exists > 0) {
        throw new IllegalArgumentException("本店已存在该商品，请先彻底删除旧记录后再重新选择");
      }
      Map<String, Object> snapshot = selectionSnapshots.capture(poolDetail(productId), store.storeLevelId());
      jdbc.update("""
          INSERT INTO store_finished_products
            (tenant_id, store_id, finished_product_id, status, selected_by_account_id, selection_generation)
          VALUES (?, ?, ?, 'warehouse', ?, ?)
          """, store.tenantId(), store.storeId(), productId, store.accountId(), source.get("selection_generation"));
      Long listingId = jdbc.queryForObject("""
          SELECT id FROM store_finished_products
          WHERE store_id = ? AND finished_product_id = ?
          """, Long.class, store.storeId(), productId);
      Long logId = log(store, listingId, productId, (String) source.get("name"), "SELECT", "从运营端已上架商品池挑选商品，放入本店仓库",
          null, "warehouse", snapshot);
      selectionSnapshots.retain(logId, snapshot);
      selected.add(detail(listingId));
    }
    return selected;
  }

  @Transactional
  public ProductView changeStatus(Long id, String target, String reason, String detail) {
    var store = scopes.require();
    Map<String, Object> listing = listing(store, id, false);
    Map<String, Object> source = source(number(listing.get("finished_product_id")), true);
    listing = listing(store, id, true);
    String current = (String) listing.get("status");
    if ("purged".equals(target)) {
      return purge(store, listing, source);
    }
    if (invalidated(listing) || !isUsable(source)) {
      throw new IllegalArgumentException(sourceMessage(listing, source));
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
      if (detail != null && !detail.isBlank()) { changes.put("详细说明", detail); }
    }
    log(store, id, number(listing.get("finished_product_id")), (String) source.get("name"),
        type, summary, current, target, changes);
    return detail(id);
  }

  @Transactional
  public List<ProductView> changeStatusBatch(List<Long> ids, String target, String reason, String detail) {
    List<ProductView> changed = new ArrayList<>();
    for (Long id : ids) { changed.add(changeStatus(id, target, reason, detail)); }
    return changed;
  }

  @Transactional
  public void purge(Long id) {
    var store = scopes.require();
    Map<String, Object> listing = listing(store, id, false);
    Map<String, Object> source = source(number(listing.get("finished_product_id")), true);
    listing = listing(store, id, true);
    purge(store, listing, source);
  }

  @Transactional
  public void purgeBatch(List<Long> ids) {
    for (Long id : ids) { purge(id); }
  }

  @Transactional
  public void clearRecycle() {
    var store = scopes.require();
    List<Long> ids = jdbc.queryForList("""
        SELECT listing.id FROM store_finished_products listing
        JOIN finished_products product ON product.id = listing.finished_product_id
        WHERE listing.tenant_id = ? AND listing.store_id = ? AND listing.status = 'recycle'
        """, Long.class, store.tenantId(), store.storeId());
    purgeBatch(ids);
  }

  private ProductView purge(CityPartnerStoreScope.Store store, Map<String, Object> listing,
      Map<String, Object> source) {
    String current = (String) listing.get("status");
    if (!"recycle".equals(current) && !invalidated(listing) && isUsable(source)) {
      throw new IllegalArgumentException("只有回收站或上游不可用的商品可以彻底删除");
    }
    Long listingId = number(listing.get("id"));
    Long productId = number(listing.get("finished_product_id"));
    log(store, listingId, productId, (String) source.get("name"), "PURGE", "彻底删除商品",
        current, "purged", Map.of("状态", Map.of("before", current, "after", "purged")));
    jdbc.update("DELETE FROM store_finished_products WHERE id = ? AND tenant_id = ? AND store_id = ?",
        listingId, store.tenantId(), store.storeId());
    products.releaseFullyPurgedIfUnreferenced(productId);
    return null;
  }

  @Transactional
  public ProductView saveRolePrice(Long id, Long skuId, Long roleId, BigDecimal price,
      boolean followConfiguration) {
    var store = scopes.require();
    Map<String, Object> listing = listing(store, id, false);
    Map<String, Object> source = source(number(listing.get("finished_product_id")), true);
    listing = listing(store, id, true);
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
        "UPDATE", "编辑商品", (String) listing.get("status"),
        (String) listing.get("status"), Map.of("SKU ID", skuId, "角色ID", roleId,
            "最低价", priceChange, "价格来源", followConfiguration ? "跟随配置" : "手工价格"));
    return detail(id);
  }

  public List<LogEntry> logs() {
    return logReader.logs();
  }

  public LogPage logPage(String keyword, String operationType, String operatorName,
      String startDate, String endDate, int requestedPage, int requestedSize) {
    return logReader.logPage(keyword, operationType, operatorName,
        startDate, endDate, requestedPage, requestedSize);
  }

  public LogEntry logDetail(Long id) {
    return logReader.logDetail(id);
  }

  // Internal upstream propagation only: ownership is loaded from each persisted listing.
  void invalidateFromUpstream(Long productId, String reason) {
    for (Map<String, Object> row : jdbc.queryForList("""
        SELECT listing.*, store.store_level_id FROM store_finished_products listing
        JOIN stores store ON store.id=listing.store_id AND store.tenant_id=listing.tenant_id
        JOIN finished_products product ON product.id=listing.finished_product_id
        WHERE listing.finished_product_id=? AND listing.selection_generation=product.selection_generation
        """, productId)) {
      if (invalidated(row)) {
        jdbc.update("UPDATE store_finished_products SET invalidated_reason=? WHERE id=?", reason, row.get("id"));
        continue;
      }
      var owner = new CityPartnerStoreScope.Store(number(row.get("tenant_id")), number(row.get("store_id")),
          number(row.get("store_level_id")), null, null);
      try {
        var snapshot = json.valueToTree(view(owner, row));
        ((com.fasterxml.jackson.databind.node.ObjectNode) snapshot).put("sourceUnavailable", true)
            .put("sourceMessage", reason);
        invalidationMedia.capture((com.fasterxml.jackson.databind.node.ObjectNode) snapshot, productId,
            "STORE_FINISHED_INVALIDATION", number(row.get("id")));
        jdbc.update("UPDATE store_finished_products SET invalidated_reason=?,invalidated_at=NOW(),invalidated_snapshot=? WHERE id=? AND invalidated_at IS NULL",
            reason, json.writeValueAsString(snapshot), row.get("id"));
      } catch (JsonProcessingException error) { throw new IllegalStateException("门店失效快照保存失败", error); }
    }
  }

  private ProductView frozenView(Map<String, Object> listing) {
    if (!invalidated(listing) || listing.get("invalidated_snapshot") == null) { return null; }
    try {
      var snapshot = (com.fasterxml.jackson.databind.node.ObjectNode) json.readTree(listing.get("invalidated_snapshot").toString());
      invalidationMedia.render(snapshot, true);
      snapshot.put("sourceMessage", FinishedSourceMessage.normalize((String) listing.get("invalidated_reason")));
      return json.treeToValue(snapshot, ProductView.class);
    }
    catch (JsonProcessingException error) { throw new IllegalStateException("门店失效快照读取失败", error); }
  }

  private record RolePriceKey(Long listingId, Long skuId, Long roleId) {}

  private List<ProductView> listViews(CityPartnerStoreScope.Store store,
      List<Map<String, Object>> listings) {
    List<Long> productIds = listings.stream()
        .map(listing -> number(listing.get("finished_product_id"))).distinct().toList();
    List<Long> listingIds = listings.stream().map(listing -> number(listing.get("id"))).toList();
    Map<Long, FinishedProduct> productById = new LinkedHashMap<>();
    products.withListDetails(productMapper.selectBatchIds(productIds))
        .forEach(product -> productById.put(product.getId(), product));
    Map<Long, Map<String, Object>> sourceById = new LinkedHashMap<>();
    queryByIds("SELECT * FROM finished_products WHERE id IN (", productIds)
        .forEach(source -> sourceById.put(number(source.get("id")), source));
    Map<Long, String> categoryNames = categoryPaths();
    Map<String, String> attributeNames = attributeNamesForKeys(productById.values().stream()
        .filter(product -> product.getVariants() != null).flatMap(product -> product.getVariants().stream())
        .filter(variant -> variant.getSalesAttributes() != null)
        .flatMap(variant -> variant.getSalesAttributes().keySet().stream()).toList());
    String storeLevelName = store.storeLevelId() == null ? null
        : namesById("store_levels", List.of(store.storeLevelId())).get(store.storeLevelId());
    List<Map<String, Object>> configurations = jdbc.queryForList("""
        SELECT config.role_id, role.name AS role_name, config.price_coefficient
        FROM store_finished_role_price_configurations config
        JOIN roles role ON role.id = config.role_id AND role.status = 'enabled'
        WHERE config.tenant_id = ? AND config.store_id = ? AND config.status = 'enabled'
        ORDER BY role.created_at DESC, role.id DESC
        """, store.tenantId(), store.storeId());
    Map<RolePriceKey, BigDecimal> manualPrices = new LinkedHashMap<>();
    queryByIds("SELECT listing_id, sku_id, role_id, manual_price "
        + "FROM store_finished_role_price_overrides WHERE listing_id IN (", listingIds)
        .forEach(row -> manualPrices.put(new RolePriceKey(number(row.get("listing_id")),
            number(row.get("sku_id")), number(row.get("role_id"))),
            (BigDecimal) row.get("manual_price")));
    return listings.stream().map(listing -> {
      ProductView frozen = frozenView(listing);
      if (frozen != null) { return frozen; }
      Long productId = number(listing.get("finished_product_id"));
      FinishedProduct product = productById.get(productId);
      if (product == null) { throw new IllegalArgumentException("来源商品不存在"); }
      Map<String, Object> source = sourceById.get(productId);
      if (source == null) { throw new IllegalArgumentException("来源商品不存在"); }
      Long listingId = number(listing.get("id"));
      return renderView(listing, product, source,
          product.getCategoryId() == null ? null : categoryNames.get(product.getCategoryId()),
          attributeNames, storeLevelName, variant -> skuPriceFromBatch(store, product, variant, listingId,
              configurations, manualPrices));
    }).toList();
  }

  private List<Map<String, Object>> queryByIds(String sqlPrefix, List<Long> ids) {
    String placeholders = String.join(",", Collections.nCopies(ids.size(), "?"));
    return jdbc.queryForList(sqlPrefix + placeholders + ")", ids.toArray());
  }

  private Map<Long, String> namesById(String table, List<Long> ids) {
    if (ids.isEmpty()) { return Map.of(); }
    Map<Long, String> names = new LinkedHashMap<>();
    queryByIds("SELECT id, name FROM " + table + " WHERE id IN (", ids)
        .forEach(row -> names.put(number(row.get("id")), (String) row.get("name")));
    return names;
  }

  private ProductView view(CityPartnerStoreScope.Store store, Map<String, Object> listing) {
    ProductView frozen = frozenView(listing);
    if (frozen != null) { return frozen; }
    Long productId = number(listing.get("finished_product_id"));
    FinishedProduct product = publicProduct(productId);
    Map<String, Object> source = source(productId, false);
    String categoryName = categoryPaths().get(product.getCategoryId());
    Map<String, String> attributeNames = attributeNamesForKeys(product.getVariants() == null ? List.of()
        : product.getVariants().stream().filter(variant -> variant.getSalesAttributes() != null)
            .flatMap(variant -> variant.getSalesAttributes().keySet().stream()).toList());
    String storeLevelName = store.storeLevelId() == null ? null
        : namesById("store_levels", List.of(store.storeLevelId())).get(store.storeLevelId());
    return renderView(listing, product, source, categoryName, attributeNames, storeLevelName,
        variant -> skuPrice(store, listing, product, variant));
  }

  private ProductView renderView(Map<String, Object> listing, FinishedProduct product,
      Map<String, Object> source, String categoryName, Map<String, String> attributeNames,
      String storeLevelName, Function<FinishedProductVariant, SkuPrice> priceForVariant) {
    Long productId = number(listing.get("finished_product_id"));
    boolean unavailable = invalidated(listing) || !isUsable(source);
    String status = (String) listing.get("status");
    String effective = !invalidated(listing) && "selling".equals(status) && stock(source) == 0 ? "soldOut" : status;
    String reason = sourceMessage(listing, source);
    List<SkuPrice> prices = product.getVariants() == null ? List.of()
        : product.getVariants().stream().map(priceForVariant).toList();
    ProductView rendered = new ProductView(number(listing.get("id")), productId, product.getName(), product.getSku(),
        status, effective, unavailable, reason, product.getTotalStock(), product.getMainImageUrl(),
        product.getMainImageUrls() == null ? List.of() : product.getMainImageUrls(), product.getVideoUrl(),
        product.getDetail(), product.getCategoryId(), categoryName,
        product.getAttributes() == null ? List.of() : product.getAttributes(), product.getSpecDimensions(),
        prices, (String) listing.get("created_by_name"), timestamp(listing.get("created_at")), (String) listing.get("off_shelf_reason"),
        (String) listing.get("off_shelf_detail"), timestamp(listing.get("off_shelf_at")),
        attributeNames.entrySet().stream().filter(entry -> prices.stream()
            .anyMatch(sku -> sku.salesAttributes() != null && sku.salesAttributes().containsKey(entry.getKey())))
            .collect(java.util.stream.Collectors.toMap(Map.Entry::getKey, Map.Entry::getValue)), storeLevelName);
    return legacyHistoricalView(listing, rendered);
  }

  // Pre-migration invalid records have no invalidation-time snapshot. Use their genuine
  // selection snapshot, explicitly labelled; never pretend current source prices are historical.
  private ProductView legacyHistoricalView(Map<String, Object> listing, ProductView current) {
    if (!invalidated(listing) || listing.get("invalidated_snapshot") != null) { return current; }
    List<String> logs = jdbc.queryForList("""
        SELECT change_details FROM store_finished_operation_logs
        WHERE listing_id=? AND tenant_id=? AND store_id=? AND operation_type='SELECT'
        ORDER BY id LIMIT 1
        """, String.class, listing.get("id"), listing.get("tenant_id"), listing.get("store_id"));
    try {
      var result = (com.fasterxml.jackson.databind.node.ObjectNode) json.valueToTree(current);
      if (logs.isEmpty() || logs.getFirst() == null) {
        result.put("sourceMessage", current.sourceMessage() + "；缺少历史详情快照");
        result.putArray("skus");
        return json.treeToValue(result, ProductView.class);
      }
      var snapshot = json.readTree(selectionSnapshots.resolve(logs.getFirst()));
      if (!snapshot.has("销售规格")) {
        result.put("sourceMessage", current.sourceMessage() + "；缺少历史详情快照");
        result.putArray("skus");
        return json.treeToValue(result, ProductView.class);
      }
      Map<String, String> fields = Map.of("商品名称", "name", "商品分类", "categoryName",
          "商品属性", "attributes", "规格维度", "specDimensions", "总库存", "totalStock",
          "门店级别", "storeLevelName", "销售属性名称", "attributeNames");
      fields.forEach((from, to) -> { if (snapshot.hasNonNull(from)) { result.set(to, snapshot.get(from)); } });
      var skus = result.putArray("skus");
      for (var archived : snapshot.path("销售规格")) {
        var sku = skus.addObject();
        sku.setAll((com.fasterxml.jackson.databind.node.ObjectNode) archived.deepCopy());
        sku.set("label", sku.remove("variantLabel"));
        sku.putArray("rolePrices");
        for (var guide : snapshot.path("指导价")) {
          if (guide.path("skuId").equals(archived.path("skuId"))) { sku.set("guidePrice", guide.path("price")); }
        }
        for (var tier : snapshot.path("层级价格")) {
          if (tier.path("skuId").equals(archived.path("skuId"))) { sku.set("costPrice", tier.path("price")); }
        }
      }
      var images = result.putArray("imageUrls");
      result.putNull("imageUrl"); result.putNull("videoUrl");
      for (var media : snapshot.path("媒体")) {
        var url = media.path("resource").get("url");
        if (url == null) { continue; }
        if (media.path("field").asText().startsWith("mainImage")) { images.add(url); }
        if (media.path("field").asText().equals("video")) { result.set("videoUrl", url); }
      }
      if (!images.isEmpty()) { result.set("imageUrl", images.get(0)); }
      result.put("detail", snapshot.path("宝贝详情").asText(""));
      result.put("sourceMessage", current.sourceMessage() + "；历史详情为首次选入快照");
      return json.treeToValue(result, ProductView.class);
    } catch (JsonProcessingException error) { throw new IllegalStateException("门店历史详情快照读取失败", error); }
  }

  private SkuPrice skuPrice(CityPartnerStoreScope.Store store, Map<String, Object> listing,
      FinishedProduct product, FinishedProductVariant variant) {
    Long listingId = number(listing.get("id"));
    Long skuId = variant.getId();
    BigDecimal cost = partnerPrice(store, product, skuId);
    BigDecimal operationsGuide = guidePrice(product, skuId);
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
    return skuPriceView(variant, cost, operationsGuide, rolePrices);
  }

  private SkuPrice skuPriceFromBatch(CityPartnerStoreScope.Store store,
      FinishedProduct product, FinishedProductVariant variant, Long listingId,
      List<Map<String, Object>> configurations, Map<RolePriceKey, BigDecimal> manualPrices) {
    Long skuId = variant.getId();
    BigDecimal cost = partnerPrice(store, product, skuId);
    BigDecimal operationsGuide = guidePrice(product, skuId);
    List<RolePrice> rolePrices = configurations.stream().map(config -> {
      Long roleId = number(config.get("role_id"));
      BigDecimal coefficient = (BigDecimal) config.get("price_coefficient");
      BigDecimal manual = manualPrices.get(new RolePriceKey(listingId, skuId, roleId));
      BigDecimal effective = manual == null && cost != null
          ? cost.multiply(coefficient).setScale(2, RoundingMode.HALF_UP) : manual;
      return new RolePrice(roleId, (String) config.get("role_name"), coefficient,
          effective, manual == null ? "auto" : "manual");
    }).toList();
    return skuPriceView(variant, cost, operationsGuide, rolePrices);
  }

  private BigDecimal partnerPrice(CityPartnerStoreScope.Store store,
      FinishedProduct product, Long skuId) {
    return product.getMarkupPrices() == null ? null : product.getMarkupPrices().stream()
        .filter(price -> Objects.equals(price.getSkuId(), skuId)
            && Objects.equals(price.getStoreLevelId(), store.storeLevelId()))
        .map(FinishedProductPrice::getPrice).findFirst().orElse(null);
  }

  private BigDecimal guidePrice(FinishedProduct product, Long skuId) {
    return product.getGuidePrices() == null ? null : product.getGuidePrices().stream()
        .filter(price -> Objects.equals(price.getSkuId(), skuId))
        .map(FinishedProductGuidePrice::getPrice).findFirst().orElse(null);
  }

  private SkuPrice skuPriceView(FinishedProductVariant variant, BigDecimal cost,
      BigDecimal operationsGuide, List<RolePrice> rolePrices) {
    return new SkuPrice(variant.getId(), variant.getVariantLabel(), variant.getStock(), cost,
        operationsGuide, rolePrices, variant.getDisplayMode(), variant.getSalesAttributes(),
        variant.getMaterial(), variant.getLengthValue(), variant.getColor(), variant.getSizeValue());
  }

  private FinishedProduct publicProduct(Long productId) {
    FinishedProduct product = productMapper.selectById(productId);
    if (product == null) { throw new IllegalArgumentException("来源商品不存在"); }
    // Product selection and reads are scoped by CityPartnerStoreScope and the store listing;
    // FinishedProductService.getById checks the platform creator and rejects store self-scope.
    return products.withDetails(product);
  }

  private void requireReadyToSell(CityPartnerStoreScope.Store store, Long listingId,
      Map<String, Object> source) {
    if (stock(source) <= 0) { throw new IllegalArgumentException("统一库存已售完，不能上架"); }
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

  private String sourceMessage(Map<String, Object> listing, Map<String, Object> source) {
    if (invalidated(listing)) {
      return FinishedSourceMessage.normalize((String) listing.get("invalidated_reason"));
    }
    List<String> reasons = new ArrayList<>();
    String supply = ProductLifecycleService.sourceBlockMessage((String) source.get("source_status"), (String) source.get("source_block_reason"));
    if (supply != null) { reasons.add(supply); }
    if (source.get("operations_invalidated_reason") != null) {
      reasons.add(FinishedSourceMessage.normalize((String) source.get("operations_invalidated_reason")));
    } else if (Boolean.TRUE.equals(source.get("operations_deleted"))) {
      reasons.add("该商品已被运营管理平台彻底删除");
    } else if ("recycle".equals(source.get("status"))) {
      reasons.add("该商品已被运营管理平台删除至回收站");
    } else if ("offShelf".equals(source.get("status"))) {
      reasons.add("该商品已被运营管理平台下架");
    } else if ("warehouse".equals(source.get("status"))) {
      reasons.add("该商品当前未在运营管理平台上架");
    }
    return reasons.isEmpty() ? null : String.join("；", reasons.stream().distinct().toList());
  }

  private void requirePriceEditable(Map<String, Object> listing, Map<String, Object> source) {
    if (invalidated(listing) || !isUsable(source)) { throw new IllegalArgumentException(sourceMessage(listing, source)); }
    if (!List.of("warehouse", "selling").contains(listing.get("status"))
        || "selling".equals(listing.get("status")) && stock(source) == 0) {
      throw new IllegalArgumentException("当前商品只能查看价格，不能修改");
    }
  }

  private void requireSku(Map<String, Object> source, Long skuId) {
    Long count = jdbc.queryForObject("""
        SELECT COUNT(*) FROM finished_product_variants
        WHERE id = ? AND finished_product_id = ?
        """, Long.class, skuId, source.get("id"));
    if (count == null || count == 0) { throw new IllegalArgumentException("商品规格不存在"); }
  }

  private BigDecimal rolePrice(CityPartnerStoreScope.Store store, Long listingId,
      Long skuId, Long roleId, Long productId) {
    List<BigDecimal> manual = jdbc.queryForList("""
        SELECT manual_price FROM store_finished_role_price_overrides
        WHERE listing_id = ? AND sku_id = ? AND role_id = ?
        """, BigDecimal.class, listingId, skuId, roleId);
    if (!manual.isEmpty()) { return manual.getFirst(); }
    List<Map<String, Object>> prices = jdbc.queryForList("""
        SELECT partner.price AS cost_price, config.price_coefficient
        FROM store_finished_role_price_configurations config
        JOIN stores store ON store.id = config.store_id
        JOIN finished_product_prices partner ON partner.store_level_id = store.store_level_id
          AND partner.finished_product_id = ? AND partner.sku_id = ?
        WHERE config.store_id = ? AND config.tenant_id = ? AND config.role_id = ?
          AND config.status = 'enabled'
        """, productId, skuId, store.storeId(), store.tenantId(), roleId);
    if (prices.isEmpty()) { return null; }
    Map<String, Object> row = prices.getFirst();
    return ((BigDecimal) row.get("cost_price")).multiply((BigDecimal) row.get("price_coefficient"))
        .setScale(2, RoundingMode.HALF_UP);
  }

  private Map<String, Object> listing(CityPartnerStoreScope.Store store, Long id, boolean lock) {
    List<Map<String, Object>> rows = jdbc.queryForList("""
        SELECT listing.*, (SELECT history.operator_name FROM store_finished_operation_logs history
          WHERE history.listing_id = listing.id AND history.tenant_id = listing.tenant_id
            AND history.store_id = listing.store_id AND history.operation_type = 'SELECT'
          ORDER BY history.id LIMIT 1) AS created_by_name
        FROM store_finished_products listing
        JOIN finished_products product ON product.id = listing.finished_product_id
        WHERE listing.id = ? AND listing.tenant_id = ? AND listing.store_id = ?
        """ + (lock ? " FOR UPDATE" : ""), id, store.tenantId(), store.storeId());
    if (rows.isEmpty()) { throw new IllegalArgumentException("本门店商品不存在或不可访问"); }
    return rows.getFirst();
  }

  private Map<String, Object> source(Long id, boolean lock) {
    List<Map<String, Object>> rows = jdbc.queryForList("SELECT * FROM finished_products WHERE id = ?"
        + (lock ? " FOR UPDATE" : ""), id);
    if (rows.isEmpty()) { throw new IllegalArgumentException("来源商品不存在"); }
    return rows.getFirst();
  }

  private static boolean invalidated(Map<String, Object> listing) {
    return listing.get("invalidated_at") != null;
  }

  private static boolean isSelectable(Map<String, Object> source) {
    return "selling".equals(source.get("status"))
        && List.of("selling", "soldOut").contains(source.get("source_status"))
        && source.get("operations_invalidated_at") == null && !flag(source.get("operations_deleted")) && stock(source) > 0;
  }

  private static boolean isUsable(Map<String, Object> source) {
    return List.of("selling", "soldOut").contains(source.get("status"))
        && List.of("selling", "soldOut").contains(source.get("source_status"))
        && source.get("operations_invalidated_at") == null && !flag(source.get("operations_deleted"));
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
    if (value instanceof LocalDateTime time) { return time; }
    return value instanceof Timestamp time ? time.toLocalDateTime() : null;
  }

  private static void requirePrice(BigDecimal price) {
    if (price == null || price.scale() > 2 || price.signum() < 0) {
      throw new IllegalArgumentException("请输入正确的价格");
    }
  }

  private Long log(CityPartnerStoreScope.Store store, Long listingId, Long productId,
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
    return jdbc.queryForObject("SELECT LAST_INSERT_ID()", Long.class);
  }
}
