package com.zdm.platform.inventory;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/** Store-owned prices. Public product and partner prices are never written here. */
@Service
public class StoreFinishedSalePriceService {
  public record Category(Long id, Long parentId, String name, String status, BigDecimal coefficient) {}
  public record Price(BigDecimal amount, String mode) {}
  public record Key(Long listingId, Long skuId) {}
  public record Context(Map<Long, Category> categories, Map<Key, Price> prices) {
    public Context { categories = java.util.Collections.unmodifiableMap(new LinkedHashMap<>(categories)); prices = java.util.Collections.unmodifiableMap(new LinkedHashMap<>(prices)); }
    public BigDecimal coefficient(Long categoryId) {
      Category category = categories.get(categoryId);
      if (category == null || categories.values().stream().anyMatch(child -> Objects.equals(child.parentId(), categoryId))) { return null; }
      var seen = new HashSet<Long>();
      for (Category current = category; current != null; current = categories.get(current.parentId())) {
        if (!"enabled".equals(current.status()) || !seen.add(current.id())) { return null; }
        if (current.parentId() != null && !categories.containsKey(current.parentId())) { return null; }
      }
      return category.coefficient();
    }
    public String categoryName(Long id) {
      var names = new java.util.ArrayList<String>();
      var seen = new HashSet<Long>();
      for (Category current = categories.get(id); current != null && seen.add(current.id()); current = categories.get(current.parentId())) { names.addFirst(current.name()); }
      return String.join(" / ", names);
    }
    public Price effective(Long listingId, Long skuId, Long categoryId, BigDecimal partnerPrice) {
      Price saved = prices.get(new Key(listingId, skuId));
      if (saved == null) { return new Price(null, "manual"); }
      if (!"auto".equals(saved.mode())) { return saved; }
      BigDecimal coefficient = coefficient(categoryId);
      return coefficient == null ? new Price(saved.amount(), "manual") : new Price(calculate(partnerPrice, coefficient), "auto");
    }
  }
  private final JdbcTemplate jdbc;
  public StoreFinishedSalePriceService(JdbcTemplate jdbc) { this.jdbc = jdbc; }
  public void lockCategories(Long storeId) {
    jdbc.queryForList("SELECT id FROM store_categories WHERE store_id=? AND scope='finished' ORDER BY id FOR UPDATE", storeId);
    jdbc.queryForList("SELECT id FROM store_price_rules WHERE store_id=? AND kind='price' AND scope='finished' ORDER BY id FOR UPDATE", storeId);
  }
  public Context context(Long storeId, List<Long> listingIds) {
    Map<Long, Category> categories = new LinkedHashMap<>();
    jdbc.query("""
        SELECT category.id, category.parent_id, category.name, category.status, rule.coefficient
        FROM store_categories category LEFT JOIN store_price_rules rule ON rule.store_id=category.store_id
          AND rule.category_id=category.id AND rule.kind='price' AND rule.scope='finished'
        WHERE category.store_id=? AND category.scope='finished' ORDER BY category.sort_order, category.id
        """, (row, index) -> new Category(row.getLong("id"), row.getObject("parent_id", Long.class), row.getString("name"), row.getString("status"), row.getBigDecimal("coefficient")), storeId)
        .forEach(category -> categories.put(category.id(), category));
    Map<Key, Price> prices = new LinkedHashMap<>();
    if (!listingIds.isEmpty()) {
      String placeholders = String.join(",", java.util.Collections.nCopies(listingIds.size(), "?"));
      var args = new java.util.ArrayList<Object>(); args.add(storeId); args.addAll(listingIds);
      jdbc.queryForList("""
          SELECT price.* FROM store_finished_sale_prices price JOIN store_finished_products listing ON listing.id=price.listing_id
          WHERE listing.store_id=? AND listing.id IN (
          """ + placeholders + ")", args.toArray()).forEach(row -> prices.put(new Key(((Number) row.get("listing_id")).longValue(), ((Number) row.get("sku_id")).longValue()), new Price((BigDecimal) row.get("sale_price"), (String) row.get("price_mode"))));
    }
    return new Context(categories, prices);
  }
  public static BigDecimal calculate(BigDecimal partnerPrice, BigDecimal coefficient) {
    return partnerPrice == null || coefficient == null ? null : partnerPrice.multiply(coefficient).setScale(2, RoundingMode.HALF_UP);
  }
  public void requireCategory(Context context, Long categoryId) {
    if (categoryId == null) { throw new IllegalArgumentException("请选择门店分类"); }
    Category category = context.categories().get(categoryId);
    if (category == null || context.categories().values().stream().anyMatch(child -> Objects.equals(child.parentId(), categoryId))) { throw new IllegalArgumentException("请选择本门店已启用的末级分类"); }
    var seen = new HashSet<Long>();
    for (Category current = category; current != null; current = context.categories().get(current.parentId())) {
      if (!"enabled".equals(current.status()) || !seen.add(current.id()) || current.parentId() != null && !context.categories().containsKey(current.parentId())) { throw new IllegalArgumentException("请选择本门店已启用的末级分类"); }
    }
  }
  public void save(Long listingId, Long skuId, Price price, Long accountId) {
    jdbc.update("""
        INSERT INTO store_finished_sale_prices (listing_id,sku_id,sale_price,price_mode,updated_by_account_id) VALUES (?,?,?,?,?)
        ON DUPLICATE KEY UPDATE sale_price=VALUES(sale_price),price_mode=VALUES(price_mode),updated_by_account_id=VALUES(updated_by_account_id)
        """, listingId, skuId, price.amount(), price.mode(), accountId);
  }
  /** Called in the same transaction BEFORE removing a rule or invalidating its category. */
  public void freezeCategories(Long storeId, List<Long> categoryIds) {
    if (categoryIds.isEmpty()) { return; }
    String placeholders = String.join(",", java.util.Collections.nCopies(categoryIds.size(), "?"));
    var args = new java.util.ArrayList<Object>(); args.add(storeId); args.addAll(categoryIds);
    jdbc.update("""
        UPDATE store_finished_sale_prices price
        JOIN store_finished_products listing ON listing.id=price.listing_id
        JOIN stores store ON store.id=listing.store_id AND store.tenant_id=listing.tenant_id
        LEFT JOIN store_price_rules rule ON rule.store_id=listing.store_id AND rule.tenant_id=listing.tenant_id
          AND rule.category_id=listing.store_category_id AND rule.kind='price' AND rule.scope='finished'
        LEFT JOIN finished_product_prices partner ON partner.finished_product_id=listing.finished_product_id AND partner.sku_id=price.sku_id AND partner.store_level_id=store.store_level_id
        SET price.sale_price=COALESCE(ROUND(partner.price * rule.coefficient,2),price.sale_price),price.price_mode='manual'
        WHERE listing.store_id=? AND listing.invalidated_at IS NULL AND price.price_mode='auto' AND listing.store_category_id IN (
        """ + placeholders + ")", args.toArray());
  }
}
