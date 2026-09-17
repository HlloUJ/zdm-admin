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
import java.time.LocalDateTime;
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

  private final ProductLifecycleService lifecycle;
  private final FinishedProductPriceService priceService;
  private final FinishedProductGuidePriceService guidePriceService;
  private final FinishedProductVariantMapper variantMapper;
  private final FinishedProductAttributeEntryMapper attributeEntryMapper;
  private final JdbcTemplate jdbcTemplate;
  private final MediaAssetService mediaAssetService;
  private final MediaCleanupService mediaCleanupService;
  private final MediaReferenceService mediaReferenceService;
  private final CurrentIdentityProvider identityProvider;
  private final FinishedProductDetailContent detailContent;
  private final FinishedOperationLogService operationLogs;

  public FinishedProductService(
      FinishedProductPriceService priceService,
      FinishedProductGuidePriceService guidePriceService,
      FinishedProductVariantMapper variantMapper,
      FinishedProductAttributeEntryMapper attributeEntryMapper,
      JdbcTemplate jdbcTemplate,
      MediaAssetService mediaAssetService,
      MediaCleanupService mediaCleanupService,
      MediaReferenceService mediaReferenceService,
      CurrentIdentityProvider identityProvider,
      FinishedOperationLogService operationLogs, ProductLifecycleService lifecycle) {
    this.lifecycle = lifecycle;
    this.operationLogs = operationLogs;
    this.priceService = priceService;
    this.guidePriceService = guidePriceService;
    this.variantMapper = variantMapper;
    this.attributeEntryMapper = attributeEntryMapper;
    this.jdbcTemplate = jdbcTemplate;
    this.mediaAssetService = mediaAssetService;
    this.mediaCleanupService = mediaCleanupService;
    this.mediaReferenceService = mediaReferenceService;
    this.identityProvider = identityProvider;
    this.detailContent = new FinishedProductDetailContent(mediaAssetService);
  }

  public record AttributeTemplateOption(Long categoryId, Long versionId, Integer versionNo,
      com.fasterxml.jackson.databind.JsonNode content) {}

  public List<AttributeTemplateOption> attributeTemplateOptions() {
    return jdbcTemplate.query("""
        SELECT version.category_id, version.id, version.version_no, version.content
        FROM category_template_versions version
        JOIN product_categories category ON category.id = version.category_id
        WHERE category.scope = 'finished' AND category.tenant_id IS NULL
          AND category.status = 'enabled' AND version.state = 'published'
          AND (? OR version.created_by_account_id = ?)
          AND NOT EXISTS (SELECT 1 FROM category_template_versions newer
            WHERE newer.category_id = version.category_id AND newer.state = 'published'
              AND newer.version_no > version.version_no)
        ORDER BY version.category_id
        """, (row, index) -> {
          try {
            return new AttributeTemplateOption(row.getLong("category_id"), row.getLong("id"),
                row.getInt("version_no"), new com.fasterxml.jackson.databind.ObjectMapper().readTree(row.getString("content")));
          } catch (com.fasterxml.jackson.core.JsonProcessingException error) {
            throw new IllegalStateException("属性模板配置读取失败", error);
          }
        }, com.zdm.platform.security.DataScope.isAll(identityProvider.require()), identityProvider.require().accountId());
  }

  public List<FinishedProduct> listWithDetails() {
    return lambdaQuery()
        .ne(lifecycle.isSupplyChain(), FinishedProduct::getSourceStatus, "purged")
        .eq(!lifecycle.isSupplyChain(), FinishedProduct::getOperationsDeleted, false)
        .eq(!com.zdm.platform.security.DataScope.isAll(identityProvider.require()), FinishedProduct::getCreatedByAccountId, identityProvider.require().accountId())
        .orderByDesc(FinishedProduct::getCreatedAt)
        .orderByDesc(FinishedProduct::getId)
        .list()
        .stream()
        .map(this::attachDetails)
        .toList();
  }

  @Transactional
  public FinishedProduct createWithDetails(FinishedProduct product) {
    lifecycle.requireSupplyChain();
    boolean publishNow="selling".equals(product.getStatus()) && !"接口获取".equals(product.getPublisherType());
    String publisher="接口获取".equals(product.getPublisherType())?"接口获取":PLATFORM_PUBLISHER;
    product.setStatus("warehouse");
    product.setSourceStatus("warehouse");
    product.setOperationsDeleted(true);
    if (product.getSpecDimensions() == null && product.getVariants() != null
        && product.getVariants().stream().anyMatch(v -> "layered".equals(v.getDisplayMode()))) {
      throw new IllegalArgumentException("请提供分层规格属性及顺序");
    }
    validateAndNormalize(product);
    CurrentIdentity identity = identityProvider.require();
    product.setId(null);
    product.setOffShelfAt("offShelf".equals(product.getStatus()) ? LocalDateTime.now() : null);
    product.setPublisherType(publisher);
    product.setCreatedByName(identity.displayName());
    product.setCreatedByAccountId(identity.accountId());
    product.setCreatedAt(LocalDateTime.now());
    try {
      save(product);
    } catch (DuplicateKeyException exception) {
      throw new IllegalArgumentException("商品编码已存在", exception);
    }
    replaceDetails(product);
    if(publishNow) { lifecycle.sourceTransition(ProductLifecycleService.Kind.FINISHED,product.getId(),"selling"); }
    syncMediaReferences(product);
    FinishedProduct created = attachDetails(getById(product.getId()));
    operationLogs.record(created, null, operationLogs.snapshot(created));
    return created;
  }

  @Transactional
  public FinishedProduct updateWithDetails(Long id, FinishedProduct product) {
    lifecycle.requireSupplyChain();
    lifecycle.lock(ProductLifecycleService.Kind.FINISHED, id);
    FinishedProduct existing = attachDetails(getById(id));
    if (existing != null && !List.of("warehouse","selling").contains(existing.getSourceStatus())) {
      throw new IllegalArgumentException("只有供应链仓库中或已上架的商品可以编辑");
    }
    if (existing == null) {
      throw new IllegalArgumentException("成品现货不存在或已被删除");
    }
    if (!java.util.Objects.equals(existing.getCategoryId(), product.getCategoryId())) {
      throw new IllegalArgumentException("编辑商品不能切换分类");
    }
    Map<String, Object> before = operationLogs.snapshot(attachDetails(existing));
    if (product.getSpecDimensions() == null) {
      product.setSpecDimensions(existing.getSpecDimensions());
    }
    String requestedStatus=product.getStatus();
    product.setStatus(existing.getStatus());
    product.setSourceStatus(existing.getSourceStatus());
    product.setOperationsDeleted(existing.getOperationsDeleted());
    product.setSourceOffShelfReason(existing.getSourceOffShelfReason());
    product.setSourceOffShelfDetail(existing.getSourceOffShelfDetail());
    product.setSourceOffShelfAt(existing.getSourceOffShelfAt());
    boolean costChanged = !sourceCosts(existing).equals(sourceCosts(product));
    validateAndNormalize(product);
    product.setGuidePrice(existing.getGuidePrice());
    product.setOffShelfReason(existing.getOffShelfReason());
    product.setOffShelfDetail(existing.getOffShelfDetail());
    product.setId(id);
    product.setPublisherType(existing.getPublisherType());
    product.setCreatedByName(existing.getCreatedByName());
    product.setCreatedByAccountId(existing.getCreatedByAccountId());
    product.setCreatedAt(existing.getCreatedAt());
    product.setOffShelfAt("offShelf".equals(product.getStatus()) && !"offShelf".equals(existing.getStatus())
        ? LocalDateTime.now() : existing.getOffShelfAt());
    try {
      updateById(product);
    } catch (DuplicateKeyException exception) {
      throw new IllegalArgumentException("商品编码已存在", exception);
    }
    replaceDetails(product);
    if (costChanged) { lifecycle.reprice(ProductLifecycleService.Kind.FINISHED, id, true); }
    syncMediaReferences(product);
    FinishedProduct updated = attachDetails(getById(id));
    operationLogs.record(updated, before, operationLogs.snapshot(updated));
    if(lifecycle.isSupplyChain() && !requestedStatus.equals(existing.getSourceStatus())) {
      lifecycle.sourceTransition(ProductLifecycleService.Kind.FINISHED,id,requestedStatus);
      updated=attachDetails(getById(id));
    }
    return updated;
  }

  @Transactional
  public FinishedProduct updateOperationWithDetails(Long id, FinishedProduct request, boolean priceOnly) {
    lifecycle.lock(ProductLifecycleService.Kind.FINISHED, id);
    FinishedProduct existing = attachDetails(getById(id));
    if (existing == null) { throw new IllegalArgumentException("运营商品不存在"); }
    lifecycle.requireOperational(existing.getSourceStatus(), existing.getOperationsDeleted());
    Map<String,Object> before = operationLogs.snapshot(existing);
    if (priceOnly) {
      Map<String,java.math.BigDecimal> costs = sourceCosts(existing);
      if (request.getGuidePrices() == null || request.getMarkupPrices() == null) { throw new IllegalArgumentException("请完善价格"); }
      request.getGuidePrices().forEach(price -> requireSourceCost(costs.get(price.getVariantKey()), price.getCostPrice()));
      request.getMarkupPrices().forEach(price -> requireSourceCost(costs.get(price.getVariantKey()), price.getCostPrice()));
      existing.setGuidePrices(request.getGuidePrices());
      existing.setMarkupPrices(request.getMarkupPrices());
      validatePrices(existing);
      priceService.replacePrices(id, existing.getMarkupPrices());
      guidePriceService.replacePrices(id, existing.getGuidePrices());
      lambdaUpdate().eq(FinishedProduct::getId,id).set(FinishedProduct::getGuidePrice,existing.getGuidePrice()).update();
    } else {
      existing.setStatus(request.getStatus());
      existing.setOffShelfReason("offShelf".equals(request.getStatus()) ? request.getOffShelfReason() : null);
      existing.setOffShelfDetail("offShelf".equals(request.getStatus()) ? request.getOffShelfDetail() : null);
      if ("offShelf".equals(request.getStatus())) { existing.setOffShelfAt(LocalDateTime.now()); }
      updateById(existing);
    }
    FinishedProduct updated = attachDetails(getById(id));
    operationLogs.record(updated, before, operationLogs.snapshot(updated));
    return updated;
  }

  private Map<String,java.math.BigDecimal> sourceCosts(FinishedProduct product) {
    Map<String,java.math.BigDecimal> costs = new LinkedHashMap<>();
    if (product.getVariants() != null) { product.getVariants().forEach(v -> costs.put(v.getVariantKey(), v.getCostPrice()==null?null:v.getCostPrice().setScale(2,java.math.RoundingMode.HALF_UP))); }
    return costs;
  }
  private void requireSourceCost(java.math.BigDecimal cost, java.math.BigDecimal requested) {
    if (cost == null || requested == null || cost.compareTo(requested) != 0) {
      throw new org.springframework.security.access.AccessDeniedException("运营端不能修改来源商品成本价");
    }
  }
  @Transactional
  public FinishedProduct sourceTransition(Long id, String target, String reason, String detail) {
    lifecycle.sourceTransition(ProductLifecycleService.Kind.FINISHED,id,target,reason,detail);
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
    Long productId = Long.valueOf(id.toString());
    boolean release = lifecycle.isSupplyChain()
        ? lifecycle.sourceTransition(ProductLifecycleService.Kind.FINISHED,productId,"purged")
        : lifecycle.purgeOperations(ProductLifecycleService.Kind.FINISHED,productId);
    if (release) {
      super.removeById(id);
      mediaReferenceService.removeBusiness(MEDIA_DOMAIN,productId,"两端商品均已彻底删除");
    }
    return true;
  }

  private void validateAndNormalize(FinishedProduct product) {
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
      throw new IllegalArgumentException("成品现货状态不正确");
    }
    validateCategory(product.getCategoryId());
    validateSupplier(product.getSupplierId());
    validateMedia(product);
    validateAttributes(product.getAttributes());
    normalizeVariants(product);
    FinishedSpecValidator.validate(product);
    if (lifecycle.isSupplyChain()) {
      product.setSourceStatus(product.getTotalStock() == 0 ? "soldOut" : product.getSourceStatus());
      if (product.getTotalStock() == 0 && !"recycle".equals(product.getStatus())) { product.setStatus("soldOut"); }
    } else { validatePrices(product); }
  }

  private void validateCategory(Long categoryId) {
    Long count = categoryId == null ? 0L : jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM product_categories WHERE id = ? AND scope = 'finished' AND status = 'enabled' AND (? OR created_by_account_id = ?)",
        Long.class,
        categoryId, com.zdm.platform.security.DataScope.isAll(identityProvider.require()), identityProvider.require().accountId());
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
          AND (? OR supplier.created_by_account_id = ?)
          AND supplier.status = 'enabled'
          AND (supply_type.code = 'finished' OR supply_type.name IN ('成品', '成品现货'))
          AND supply_type.status = 'enabled'
        """, Long.class, supplierId, com.zdm.platform.security.DataScope.isAll(identityProvider.require()), identityProvider.require().accountId());
    if (count == null || count == 0) {
      throw new IllegalArgumentException("所选供应商未启用成品现货供货类型");
    }
  }

  private void validateMedia(FinishedProduct product) {
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
      if (lifecycle.isSupplyChain() && (variant.getCostPrice() != null && variant.getCostPrice().signum() < 0)) {
        throw new IllegalArgumentException("请完善每个规格的成本价");
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

    if (!lifecycle.isSupplyChain()) {
      priceService.replacePrices(productId, product.getMarkupPrices());
      guidePriceService.replacePrices(productId, product.getGuidePrices());
    }
  }

  private void syncMediaReferences(FinishedProduct product) {
    Map<String, Long> media = new LinkedHashMap<>();
    media.put("mainImage", product.getMainImageMediaId());
    for (int index = 1; index < product.getMainImageMediaIds().size(); index++) {
      media.put("mainImage" + (index + 1), product.getMainImageMediaIds().get(index));
    }
    media.put("video", product.getVideoMediaId());
    media.putAll(detailContent.references(product.getDetail()));
    mediaReferenceService.replace(MEDIA_DOMAIN, product.getId(), media);
  }

  void attachOffShelfOperator(FinishedProduct product) {
    product.setOffShelfByName(null);
    boolean supplyChain = lifecycle.isSupplyChain();
    if (!"offShelf".equals(supplyChain ? product.getSourceStatus() : product.getStatus())) {
      return;
    }
    List<String> names = jdbcTemplate.queryForList("""
        SELECT operator_name FROM finished_operation_logs
        WHERE product_id = ? AND business_client_code = ? AND operation_type = 'OFF_SHELF'
        ORDER BY operated_at DESC, id DESC LIMIT 1
        """, String.class, product.getId(), supplyChain ? "supply-chain" : "admin");
    if (!names.isEmpty()) {
      product.setOffShelfByName(names.getFirst());
    }
  }

  private FinishedProduct attachDetails(FinishedProduct product) {
    if (product == null) {
      return null;
    }
    attachOffShelfOperator(product);
    List<Long> imageIds = jdbcTemplate.queryForList("""
        SELECT media_id FROM media_references
        WHERE business_domain = ? AND business_id = ?
          AND field_key IN ('mainImage', 'mainImage2', 'mainImage3', 'mainImage4', 'mainImage5')
        ORDER BY field_key
        """, Long.class, MEDIA_DOMAIN, product.getId());
    if (imageIds.isEmpty() && product.getMainImageMediaId() != null) {
      imageIds = List.of(product.getMainImageMediaId());
    }
    product.setMainImageMediaIds(imageIds);
    product.setMainImageUrls(imageIds.stream().map(mediaAssetService::publicUrl).toList());
    product.setMainImageUrl(mediaAssetService.publicUrl(product.getMainImageMediaId()));
    product.setVideoUrl(mediaAssetService.publicUrl(product.getVideoMediaId()));
    product.setDetail(detailContent.render(product.getDetail()));
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
  @Override
  public FinishedProduct getById(java.io.Serializable id) {
    FinishedProduct entity = super.getById(id);
    if (entity != null) {
      com.zdm.platform.security.DataScope.requireAccess(
          identityProvider.require(), entity.getCreatedByAccountId());
    }
    return entity;
  }

}
