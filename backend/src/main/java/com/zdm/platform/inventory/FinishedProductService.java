package com.zdm.platform.inventory;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.zdm.platform.media.MediaAsset;
import com.zdm.platform.media.MediaAssetService;
import com.zdm.platform.media.MediaCleanupService;
import com.zdm.platform.media.MediaReferenceService;
import com.zdm.platform.security.CurrentIdentity;
import com.zdm.platform.security.CurrentIdentityProvider;
import java.io.Serializable;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

@Service
public class FinishedProductService extends ServiceImpl<FinishedProductMapper, FinishedProduct> {
  private static final String MEDIA_DOMAIN = "FINISHED_PRODUCT";
  private static final String PLATFORM_PUBLISHER = "平台发布";
  private static final Set<String> ALLOWED_STATUSES =
      Set.of("warehouse", "selling", "offShelf", "soldOut", "recycle");

  private final FinishedProductPriceService priceService;
  private final FinishedProductGuidePriceService guidePriceService;
  private final FinishedProductVariantMapper variantMapper;
  private final FinishedProductAttributeEntryMapper attributeEntryMapper;
  private final JdbcTemplate jdbcTemplate;
  private final MediaAssetService mediaAssetService;
  private final MediaCleanupService mediaCleanupService;
  private final MediaReferenceService mediaReferenceService;
  private final CurrentIdentityProvider identityProvider;

  public FinishedProductService(
      FinishedProductPriceService priceService,
      FinishedProductGuidePriceService guidePriceService,
      FinishedProductVariantMapper variantMapper,
      FinishedProductAttributeEntryMapper attributeEntryMapper,
      JdbcTemplate jdbcTemplate,
      MediaAssetService mediaAssetService,
      MediaCleanupService mediaCleanupService,
      MediaReferenceService mediaReferenceService,
      CurrentIdentityProvider identityProvider) {
    this.priceService = priceService;
    this.guidePriceService = guidePriceService;
    this.variantMapper = variantMapper;
    this.attributeEntryMapper = attributeEntryMapper;
    this.jdbcTemplate = jdbcTemplate;
    this.mediaAssetService = mediaAssetService;
    this.mediaCleanupService = mediaCleanupService;
    this.mediaReferenceService = mediaReferenceService;
    this.identityProvider = identityProvider;
  }

  public List<FinishedProduct> listWithDetails() {
    return lambdaQuery()
        .orderByDesc(FinishedProduct::getCreatedAt)
        .orderByDesc(FinishedProduct::getId)
        .list()
        .stream()
        .map(this::attachDetails)
        .toList();
  }

  @Transactional
  public FinishedProduct createWithDetails(FinishedProduct product) {
    validateAndNormalize(product);
    CurrentIdentity identity = identityProvider.require();
    product.setId(null);
    product.setPublisherType(PLATFORM_PUBLISHER);
    product.setCreatedByName(identity.displayName());
    product.setCreatedByAccountId(identity.accountId());
    try {
      save(product);
    } catch (DuplicateKeyException exception) {
      throw new IllegalArgumentException("商品编码已存在", exception);
    }
    replaceDetails(product);
    syncMediaReferences(product);
    return attachDetails(getById(product.getId()));
  }

  @Transactional
  public FinishedProduct updateWithDetails(Long id, FinishedProduct product) {
    FinishedProduct existing = getById(id);
    if (existing == null) {
      throw new IllegalArgumentException("成品现货不存在或已被删除");
    }
    validateAndNormalize(product);
    product.setId(id);
    product.setPublisherType(PLATFORM_PUBLISHER);
    product.setCreatedByName(existing.getCreatedByName());
    product.setCreatedByAccountId(existing.getCreatedByAccountId());
    product.setCreatedAt(existing.getCreatedAt());
    try {
      updateById(product);
    } catch (DuplicateKeyException exception) {
      throw new IllegalArgumentException("商品编码已存在", exception);
    }
    replaceDetails(product);
    syncMediaReferences(product);
    return attachDetails(getById(id));
  }

  public boolean cleanupTemporaryMedia(Long mediaId) {
    mediaAssetService.requireAvailable(mediaId);
    mediaCleanupService.enqueueAfterCommit(List.of(mediaId), "取消未保存的成品现货媒体");
    return true;
  }

  @Override
  @Transactional
  public boolean removeById(Serializable id) {
    FinishedProduct existing = getById(id);
    boolean removed = super.removeById(id);
    if (removed && existing != null) {
      mediaReferenceService.removeBusiness(MEDIA_DOMAIN, existing.getId(), "成品现货被彻底删除");
    }
    return removed;
  }

  private void validateAndNormalize(FinishedProduct product) {
    if (!StringUtils.hasText(product.getName())) {
      throw new IllegalArgumentException("请输入商品名称");
    }
    if (!StringUtils.hasText(product.getSku())) {
      throw new IllegalArgumentException("请输入商家编码");
    }
    if (!StringUtils.hasText(product.getDetail())) {
      throw new IllegalArgumentException("请输入宝贝详情");
    }
    product.setName(product.getName().trim());
    product.setSku(product.getSku().trim());
    product.setDetail(product.getDetail().trim());
    if (!ALLOWED_STATUSES.contains(product.getStatus())) {
      throw new IllegalArgumentException("成品现货状态不正确");
    }
    validateCategory(product.getCategoryId());
    validateSupplier(product.getSupplierId());
    validateMedia(product.getMainImageMediaId(), product.getVideoMediaId());
    validateAttributes(product.getAttributes());
    normalizeVariants(product);
    validatePrices(product);
  }

  private void validateCategory(Long categoryId) {
    Long count = categoryId == null ? 0L : jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM product_categories WHERE id = ? AND scope = 'finished' AND status = 'enabled'",
        Long.class,
        categoryId);
    if (count == null || count == 0) {
      throw new IllegalArgumentException("请选择有效的成品现货分类");
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
          AND supplier.status = 'enabled'
          AND (supply_type.code = 'finished' OR supply_type.name IN ('成品', '成品现货'))
          AND supply_type.status = 'enabled'
        """, Long.class, supplierId);
    if (count == null || count == 0) {
      throw new IllegalArgumentException("所选供应商未启用成品现货供货类型");
    }
  }

  private void validateMedia(Long mainImageMediaId, Long videoMediaId) {
    MediaAsset mainImage = mediaAssetService.requireAvailable(mainImageMediaId);
    if (mainImage == null || !"image".equals(mainImage.getMediaType())) {
      throw new IllegalArgumentException("请上传商品主图");
    }
    MediaAsset video = mediaAssetService.requireAvailable(videoMediaId);
    if (video == null || !"video".equals(video.getMediaType())) {
      throw new IllegalArgumentException("请上传商品视频");
    }
  }

  private void validateAttributes(List<FinishedProductAttributeEntry> entries) {
    List<FinishedProductAttributeEntry> normalized = entries == null ? List.of() : entries;
    Set<Long> ids = new LinkedHashSet<>();
    for (FinishedProductAttributeEntry entry : normalized) {
      List<String> names = jdbcTemplate.queryForList("""
          SELECT name FROM product_attributes
          WHERE id = ?
            AND scope IN ('shared', 'finished')
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

  private void normalizeVariants(FinishedProduct product) {
    List<FinishedProductVariant> variants = product.getVariants() == null ? List.of() : product.getVariants();
    if (variants.isEmpty()) {
      throw new IllegalArgumentException("请至少配置一条商品规格");
    }
    Set<String> keys = new LinkedHashSet<>();
    int totalStock = 0;
    for (FinishedProductVariant variant : variants) {
      String key = variant.getVariantKey() == null ? "" : variant.getVariantKey().trim();
      String label = variant.getVariantLabel() == null ? "" : variant.getVariantLabel().trim();
      if (key.isEmpty() || label.isEmpty()) {
        throw new IllegalArgumentException("请完善规格名称和商家编码");
      }
      if (!keys.add(key)) {
        throw new IllegalArgumentException("规格商家编码不能重复");
      }
      variant.setVariantKey(key);
      variant.setVariantLabel(label);
      variant.setDisplayMode("layered".equals(variant.getDisplayMode()) ? "layered" : "single");
      int stock = variant.getStock() == null ? 0 : variant.getStock();
      variant.setStock(stock);
      totalStock += stock;
    }
    product.setTotalStock(totalStock);
  }

  private void validatePrices(FinishedProduct product) {
    Set<String> variantKeys = product.getVariants().stream()
        .map(FinishedProductVariant::getVariantKey)
        .collect(java.util.stream.Collectors.toSet());
    if (product.getGuidePrices() == null || product.getGuidePrices().isEmpty()) {
      throw new IllegalArgumentException("请配置每条规格的指导价");
    }
    boolean hasUnknownGuideVariant = product.getGuidePrices().stream()
        .anyMatch(price -> !variantKeys.contains(price.getVariantKey()));
    boolean hasUnknownMarkupVariant = product.getMarkupPrices() != null && product.getMarkupPrices().stream()
        .anyMatch(price -> !variantKeys.contains(price.getVariantKey()));
    if (hasUnknownGuideVariant || hasUnknownMarkupVariant) {
      throw new IllegalArgumentException("价格规格与商品规格不一致");
    }
    product.setGuidePrice(product.getGuidePrices().getFirst().getPrice());
  }

  private void replaceDetails(FinishedProduct product) {
    Long productId = product.getId();
    variantMapper.delete(Wrappers.lambdaQuery(FinishedProductVariant.class)
        .eq(FinishedProductVariant::getFinishedProductId, productId));
    product.getVariants().forEach(variant -> {
      variant.setId(null);
      variant.setFinishedProductId(productId);
      variantMapper.insert(variant);
    });

    attributeEntryMapper.delete(Wrappers.lambdaQuery(FinishedProductAttributeEntry.class)
        .eq(FinishedProductAttributeEntry::getFinishedProductId, productId));
    if (product.getAttributes() != null) {
      product.getAttributes().forEach(entry -> {
        entry.setId(null);
        entry.setFinishedProductId(productId);
        attributeEntryMapper.insert(entry);
      });
    }

    priceService.replacePrices(productId, product.getMarkupPrices());
    guidePriceService.replacePrices(productId, product.getGuidePrices());
  }

  private void syncMediaReferences(FinishedProduct product) {
    Map<String, Long> media = new LinkedHashMap<>();
    media.put("mainImage", product.getMainImageMediaId());
    media.put("video", product.getVideoMediaId());
    mediaReferenceService.replace(MEDIA_DOMAIN, product.getId(), media);
  }

  private FinishedProduct attachDetails(FinishedProduct product) {
    if (product == null) {
      return null;
    }
    product.setMainImageUrl(mediaAssetService.publicUrl(product.getMainImageMediaId()));
    product.setVideoUrl(mediaAssetService.publicUrl(product.getVideoMediaId()));
    product.setMarkupPrices(priceService.listPrices(product.getId()));
    product.setGuidePrices(guidePriceService.listPrices(product.getId()));
    product.setVariants(variantMapper.selectList(Wrappers.lambdaQuery(FinishedProductVariant.class)
        .eq(FinishedProductVariant::getFinishedProductId, product.getId())
        .orderByAsc(FinishedProductVariant::getId)));
    product.setAttributes(attributeEntryMapper.selectList(
        Wrappers.lambdaQuery(FinishedProductAttributeEntry.class)
            .eq(FinishedProductAttributeEntry::getFinishedProductId, product.getId())
            .orderByAsc(FinishedProductAttributeEntry::getId)));
    return product;
  }
}
