package com.zdm.platform.inventory;

import com.zdm.platform.media.MediaAsset;
import com.zdm.platform.media.MediaAssetService;
import com.zdm.platform.security.CurrentIdentityProvider;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.util.StringUtils;

final class AccessoryProductWriteValidator {
  private static final Set<String> ALLOWED_STATUSES =
      Set.of("warehouse", "selling", "offShelf", "soldOut", "recycle");

  private final JdbcTemplate jdbcTemplate;
  private final MediaAssetService mediaAssetService;
  private final CurrentIdentityProvider identityProvider;
  private final AccessoryProductDetailContent detailContent;
  private final AccessoryLifecycleService lifecycle;

  AccessoryProductWriteValidator(JdbcTemplate jdbcTemplate, MediaAssetService mediaAssetService,
      CurrentIdentityProvider identityProvider, AccessoryProductDetailContent detailContent,
      AccessoryLifecycleService lifecycle) {
    this.jdbcTemplate = jdbcTemplate;
    this.mediaAssetService = mediaAssetService;
    this.identityProvider = identityProvider;
    this.detailContent = detailContent;
    this.lifecycle = lifecycle;
  }

  void validateAndNormalize(AccessoryProduct product) {
    if (product.getAttributeDisplayOrder() == null) {
      var sales = new LinkedHashSet<String>();
      if (product.getVariants() != null) {
        product.getVariants().forEach(variant -> {
          if (variant.getSalesAttributes() != null) { sales.addAll(variant.getSalesAttributes().keySet()); }
        });
      }
      product.setAttributeDisplayOrder(Map.of(
          "product", product.getAttributes() == null ? List.of() : product.getAttributes().stream().map(entry -> String.valueOf(entry.getAttributeId())).toList(),
          "sales", List.copyOf(sales)));
    }

    if (!StringUtils.hasText(product.getName())) {
      throw new IllegalArgumentException("请输入商品名称");
    }
    if (!StringUtils.hasText(product.getDetail())) {
      throw new IllegalArgumentException("请输入宝贝详情");
    }
    product.setName(product.getName().trim());
    product.setSku(StringUtils.hasText(product.getSku()) ? product.getSku().trim() : null);
    product.setDetail(detailContent.normalize(product.getDetail()));
    if (!ALLOWED_STATUSES.contains(product.getStatus())) {
      throw new IllegalArgumentException("配件状态不正确");
    }
    validateCategory(product.getCategoryId());
    validateSupplier(product.getSupplierId());
    validateMedia(product);
    validateAttributes(product.getAttributes());
    normalizeVariants(product);
    AccessorySpecValidator.validate(product);
    if (lifecycle.isSupplyChain()) {
      product.setSourceStatus(product.getTotalStock() == 0 ? "soldOut" : product.getSourceStatus());
      if (product.getTotalStock() == 0 && !"recycle".equals(product.getStatus())) { product.setStatus("soldOut"); }
    } else { validatePrices(product); }
  }

  private void validateCategory(Long categoryId) {
    Long count = categoryId == null ? 0L : jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM product_categories WHERE id = ? AND scope = 'accessory' AND status = 'enabled' AND (? OR created_by_account_id = ?)",
        Long.class,
        categoryId, com.zdm.platform.security.DataScope.isAll(identityProvider.require()), identityProvider.require().accountId());
    if (count == null || count == 0) {
      throw new IllegalArgumentException("请选择有效的配件分类");
    }
  }

  private void validateSupplier(Long supplierId) {
    Long count = supplierId == null ? 0L : jdbcTemplate.queryForObject("""
        SELECT COUNT(*)
        FROM suppliers supplier
        JOIN supplier_supply_type_links link ON link.supplier_id = supplier.id
        JOIN supplier_supply_types supply_type ON supply_type.id = link.supply_type_id
        WHERE supplier.id = ?
          AND supplier.owner_scope = 'platform'
          AND supplier.owner_id = 0
          AND (? OR supplier.created_by_account_id = ?)
          AND supplier.status = 'enabled'
          AND (supply_type.code = 'accessory' OR supply_type.name IN ('配件', '配件'))
          AND supply_type.status = 'enabled'
        """, Long.class, supplierId, com.zdm.platform.security.DataScope.isAll(identityProvider.require()), identityProvider.require().accountId());
    if (count == null || count == 0) {
      throw new IllegalArgumentException("所选供应商未启用配件供货类型");
    }
  }

  void validateMedia(AccessoryProduct product) {
    List<Long> imageIds = product.getMainImageMediaIds();
    if (imageIds == null) {
      imageIds = product.getMainImageMediaId() == null ? List.of() : List.of(product.getMainImageMediaId());
    }
    if (imageIds.isEmpty() || imageIds.size() > 5) {
      throw new IllegalArgumentException("商品主图需上传1至5张图片");
    }
    if (imageIds.stream().anyMatch(java.util.Objects::isNull) || new LinkedHashSet<>(imageIds).size() != imageIds.size()) {
      throw new IllegalArgumentException("商品主图不能为空或重复");
    }
    for (Long imageId : imageIds) {
      MediaAsset mainImage = mediaAssetService.requireAvailable(imageId);
      if (mainImage == null || !"image".equals(mainImage.getMediaType())) {
        throw new IllegalArgumentException("请上传商品主图");
      }
    }
    product.setMainImageMediaIds(imageIds);
    product.setMainImageMediaId(imageIds.getFirst());
    MediaAsset video = mediaAssetService.requireAvailable(product.getVideoMediaId());
    if (video == null || !"video".equals(video.getMediaType())) {
      throw new IllegalArgumentException("请上传商品视频");
    }
  }

  private void validateAttributes(List<AccessoryProductAttributeEntry> entries) {
    List<AccessoryProductAttributeEntry> normalized = entries == null ? List.of() : entries;
    Set<Long> ids = new LinkedHashSet<>();
    for (AccessoryProductAttributeEntry entry : normalized) {
      List<String> names = jdbcTemplate.queryForList("""
          SELECT name FROM product_attributes
          WHERE id = ?
            AND scope IN ('shared', 'accessory')
            AND status = 'enabled'
            AND deleted_at IS NULL
          FOR SHARE
          """, String.class, entry.getAttributeId());
      if (names.isEmpty()) {
        throw new IllegalArgumentException("商品属性不存在或已停用");
      }
      if (!ids.add(entry.getAttributeId())) {
        throw new IllegalArgumentException("商品属性不能重复");
      }
      entry.setAttributeName(names.getFirst());
      entry.setValue(entry.getValue().trim());
    }
  }

  private void normalizeVariants(AccessoryProduct product) {
    List<AccessoryProductVariant> variants = product.getVariants() == null ? List.of() : product.getVariants();
    if (variants.isEmpty()) {
      throw new IllegalArgumentException("请至少配置一条商品规格");
    }
    Set<Long> ids = new LinkedHashSet<>();
    int totalStock = 0;
    for (AccessoryProductVariant variant : variants) {
      String label = variant.getVariantLabel() == null ? "" : variant.getVariantLabel().trim();
      if (label.isEmpty()) {
        throw new IllegalArgumentException("请完善规格名称");
      }
      if (variant.getId() != null && !ids.add(variant.getId())) {
        throw new IllegalArgumentException("SKU ID 不能重复");
      }
      if (lifecycle.isSupplyChain() && (variant.getCostPrice() != null && variant.getCostPrice().signum() < 0)) {
        throw new IllegalArgumentException("请完善每个规格的成本价");
      }
      variant.setVariantLabel(label);
      variant.setDisplayMode("layered".equals(variant.getDisplayMode()) ? "layered" : "single");
      int stock = variant.getStock() == null ? 0 : variant.getStock();
      variant.setStock(stock);
      totalStock += stock;
    }
    product.setTotalStock(totalStock);
  }

  void validatePrices(AccessoryProduct product) {
    Set<Long> skuIds = product.getVariants().stream()
        .map(AccessoryProductVariant::getId)
        .collect(java.util.stream.Collectors.toSet());
    if (product.getGuidePrices() == null || product.getGuidePrices().isEmpty()) {
      throw new IllegalArgumentException("请配置每条规格的指导价");
    }
    boolean hasUnknownGuideVariant = product.getGuidePrices().stream()
        .anyMatch(price -> !skuIds.contains(price.getSkuId()));
    boolean hasUnknownMarkupVariant = product.getMarkupPrices() != null && product.getMarkupPrices().stream()
        .anyMatch(price -> !skuIds.contains(price.getSkuId()));
    if (hasUnknownGuideVariant || hasUnknownMarkupVariant) {
      throw new IllegalArgumentException("价格规格与商品规格不一致");
    }
    if (product.getGuidePrices().size() != skuIds.size()
        || !product.getGuidePrices().stream().map(AccessoryProductGuidePrice::getSkuId)
            .collect(java.util.stream.Collectors.toSet()).equals(skuIds)) {
      throw new IllegalArgumentException("请配置每条规格且不重复的指导价");
    }
    if (product.getMarkupPrices() != null && !product.getMarkupPrices().isEmpty()
        && !product.getMarkupPrices().stream().map(AccessoryProductPrice::getSkuId)
            .collect(java.util.stream.Collectors.toSet()).equals(skuIds)) {
      throw new IllegalArgumentException("请配置每条规格的层级价格");
    }
    product.setGuidePrice(product.getGuidePrices().getFirst().getPrice());
  }

}
