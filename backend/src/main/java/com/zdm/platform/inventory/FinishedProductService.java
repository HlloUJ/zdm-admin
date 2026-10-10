package com.zdm.platform.inventory;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.zdm.platform.account.CreatorAwareService;
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
public class FinishedProductService extends CreatorAwareService<FinishedProductMapper, FinishedProduct> {
  private static final String MEDIA_DOMAIN = "FINISHED_PRODUCT";
  private static final String PLATFORM_PUBLISHER = "平台发布";

  private final com.fasterxml.jackson.databind.ObjectMapper objectMapper = new com.fasterxml.jackson.databind.ObjectMapper().findAndRegisterModules()
      .configure(com.fasterxml.jackson.databind.DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
  @org.springframework.beans.factory.annotation.Autowired
  private FinishedInvalidationMedia invalidationMedia;
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
  private final FinishedProductListDetails listDetails;
  private final FinishedProductWriteValidator writeValidator;
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
    this.writeValidator = new FinishedProductWriteValidator(jdbcTemplate, mediaAssetService,
        identityProvider, detailContent, lifecycle);
    this.listDetails = new FinishedProductListDetails(lifecycle, priceService, guidePriceService,
        variantMapper, attributeEntryMapper, jdbcTemplate, mediaAssetService);
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
    List<FinishedProduct> products = lambdaQuery()
        .ne(lifecycle.isSupplyChain(), FinishedProduct::getSourceStatus, "purged")
        .eq(!lifecycle.isSupplyChain(), FinishedProduct::getOperationsDeleted, false)
        .eq(!com.zdm.platform.security.DataScope.isAll(identityProvider.require()), FinishedProduct::getCreatedByAccountId, identityProvider.require().accountId())
        .orderByDesc(FinishedProduct::getCreatedAt)
        .orderByDesc(FinishedProduct::getId)
        .list();
    return listDetails.attach(products).stream().map(this::operationalSnapshot).toList();
  }

  public FinishedProduct visibleDetail(Long id) {
    FinishedProduct product = lambdaQuery()
        .eq(FinishedProduct::getId, id)
        .eq(FinishedProduct::getOperationsDeleted, false)
        .eq(!com.zdm.platform.security.DataScope.isAll(identityProvider.require()),
            FinishedProduct::getCreatedByAccountId, identityProvider.require().accountId())
        .one();
    return product;
  }

  public FinishedProduct withDetails(FinishedProduct product) {
    return operationalSnapshot(attachDetails(product));
  }

  private FinishedProduct operationalSnapshot(FinishedProduct product) {
    if (product == null || lifecycle.isSupplyChain() || identityProvider.require().storeId() != null
        || product.getOperationsInvalidatedSnapshot() == null) { return product; }
    try {
      var snapshot = (com.fasterxml.jackson.databind.node.ObjectNode) objectMapper.readTree(product.getOperationsInvalidatedSnapshot());
      invalidationMedia.render(snapshot, false);
      FinishedProduct frozen = objectMapper.treeToValue(snapshot, FinishedProduct.class);
      frozen.setCreatedByAccountId(product.getCreatedByAccountId());
      frozen.setOperationsInvalidatedReason(product.getOperationsInvalidatedReason());
      frozen.setOperationsInvalidatedAt(product.getOperationsInvalidatedAt());
      frozen.setSourceStatus(product.getSourceStatus());
      frozen.setOperationsDeleted(product.getOperationsDeleted());
      return creatorNames.attach(frozen);
    } catch (com.fasterxml.jackson.core.JsonProcessingException error) { throw new IllegalStateException("运营失效快照读取失败", error); }
  }

  List<FinishedProduct> withListDetails(List<FinishedProduct> products) {
    return creatorNames.attachAll(listDetails.attach(products));
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
    writeValidator.validateAndNormalize(product);
    CurrentIdentity identity = identityProvider.require();
    product.setId(null);
    product.setOffShelfAt("offShelf".equals(product.getStatus()) ? LocalDateTime.now() : null);
    product.setPublisherType(publisher);
    product.setCreatedByAccountId(identity.accountId());
    product.setCreatedAt(LocalDateTime.now());
    try {
      save(product);
    } catch (DuplicateKeyException exception) {
      throw new IllegalArgumentException("商品编码已存在", exception);
    }
    replaceDetails(product);
    syncMediaReferences(product);
    if(publishNow) { lifecycle.shelfDuringCreation(ProductLifecycleService.Kind.FINISHED,product.getId()); }
    FinishedProduct created = attachDetails(getById(product.getId()));
    operationLogs.record(created, null, operationLogs.snapshot(created));
    return created;
  }

  @Transactional
  public FinishedProduct updateWithDetails(Long id, FinishedProduct product) {
    return updateWithDetails(id, product, false);
  }

  @Transactional
  public FinishedProduct updateWithDetails(Long id, FinishedProduct product, boolean editForm) {
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
    if (product.getAttributeDisplayOrder() == null) { product.setAttributeDisplayOrder(existing.getAttributeDisplayOrder()); }
    String requestedStatus=product.getStatus();
    product.setStatus(existing.getStatus());
    product.setSourceStatus(existing.getSourceStatus());
    product.setOperationsDeleted(existing.getOperationsDeleted());
    product.setSourceOffShelfReason(existing.getSourceOffShelfReason());
    product.setSourceOffShelfDetail(existing.getSourceOffShelfDetail());
    product.setSourceOffShelfAt(existing.getSourceOffShelfAt());
    boolean costChanged = !sourceCosts(existing).equals(sourceCosts(product));
    writeValidator.validateAndNormalize(product);
    product.setGuidePrice(existing.getGuidePrice());
    product.setOffShelfReason(existing.getOffShelfReason());
    product.setOffShelfDetail(existing.getOffShelfDetail());
    product.setId(id);
    product.setPublisherType(existing.getPublisherType());
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
    boolean statusChanged = lifecycle.isSupplyChain() && !requestedStatus.equals(existing.getSourceStatus());
    if (editForm && statusChanged) {
      lifecycle.sourceTransitionDuringEdit(ProductLifecycleService.Kind.FINISHED, id, requestedStatus);
      updated = attachDetails(getById(id));
    }
    if (editForm) { operationLogs.recordEdit(updated, before, operationLogs.snapshot(updated)); }
    else { operationLogs.record(updated, before, operationLogs.snapshot(updated)); }
    if (!editForm && statusChanged) {
      lifecycle.sourceTransition(ProductLifecycleService.Kind.FINISHED,id,requestedStatus);
      updated=attachDetails(getById(id));
    }
    return updated;
  }

  @Transactional
  public FinishedProduct updateSourceCosts(Long id, Map<Long, java.math.BigDecimal> requested) {
    lifecycle.requireSupplyChain();
    lifecycle.lock(ProductLifecycleService.Kind.FINISHED, id);
    FinishedProduct existing = attachDetails(getById(id));
    if (existing == null || !List.of("warehouse", "selling").contains(existing.getSourceStatus())) {
      throw new IllegalArgumentException("当前状态不能修改成本价");
    }
    Map<Long, java.math.BigDecimal> current = sourceCosts(existing);
    if (requested.size() != current.size() || !requested.keySet().equals(current.keySet())) {
      throw new IllegalArgumentException("商品规格已变化，请刷新后重试");
    }
    for (java.math.BigDecimal cost : requested.values()) {
      if (cost == null || cost.signum() < 0 || cost.stripTrailingZeros().scale() > 2) {
        throw new IllegalArgumentException("请完善每个规格的成本价");
      }
    }
    boolean changed = requested.entrySet().stream()
        .anyMatch(entry -> current.get(entry.getKey()) == null
            || current.get(entry.getKey()).compareTo(entry.getValue()) != 0);
    if (!changed) { return existing; }
    Map<String, Object> before = operationLogs.snapshot(existing);
    requested.forEach((skuId, cost) -> {
      int updated = jdbcTemplate.update(
          "UPDATE finished_product_variants SET cost_price=? WHERE id=? AND finished_product_id=?",
          cost, skuId, id);
      if (updated != 1) { throw new IllegalArgumentException("商品规格已变化，请刷新后重试"); }
    });
    lifecycle.reprice(ProductLifecycleService.Kind.FINISHED, id, true);
    FinishedProduct updated = attachDetails(getById(id));
    operationLogs.record(updated, before, operationLogs.snapshot(updated));
    return updated;
  }

  @Transactional
  public void checkOperationsShelf(Long id) {
    if (lifecycle.isSupplyChain()) { throw new org.springframework.security.access.AccessDeniedException("此操作属于运营管理平台"); }
    lifecycle.lock(ProductLifecycleService.Kind.FINISHED, id);
    FinishedProduct product = attachDetails(getById(id));
    lifecycle.requireFinishedOperational(product);
    validateOperationsShelf(product);
  }

  private void validateOperationsShelf(FinishedProduct product) {
    if (!"warehouse".equals(product.getStatus())) { throw new IllegalArgumentException("当前成品现货状态不允许上架"); }
    if (product.getMainImageMediaId() == null || product.getVideoMediaId() == null) {
      throw new IllegalArgumentException("请完善商品图片或视频后再上架");
    }
    // These IDs come from the locked persisted product, not from an upload request.
    List<Long> imageIds = product.getMainImageMediaIds() == null || product.getMainImageMediaIds().isEmpty()
        ? List.of(product.getMainImageMediaId()) : product.getMainImageMediaIds();
    for (Long imageId : imageIds) {
      if (!"image".equals(mediaAssetService.requireReferencedAvailableForUpdate(imageId).getMediaType())) {
        throw new IllegalArgumentException("请完善商品图片后再上架");
      }
    }
    if (!"video".equals(mediaAssetService.requireReferencedAvailableForUpdate(product.getVideoMediaId()).getMediaType())) {
      throw new IllegalArgumentException("请完善商品视频后再上架");
    }
    if (product.getCategoryId() == null || product.getSupplierId() == null
        || !StringUtils.hasText(product.getName()) || !StringUtils.hasText(product.getDetail())) {
      throw new IllegalArgumentException("请完善商品基础信息后再上架");
    }
    if (product.getTotalStock() == null || product.getTotalStock() <= 0
        || product.getVariants() == null || product.getVariants().isEmpty()) {
      throw new IllegalArgumentException("请完善商品规格与库存后再上架");
    }
    for (FinishedProductVariant variant : product.getVariants()) {
      if (variant.getCostPrice() == null || variant.getCostPrice().signum() < 0) {
        throw new IllegalArgumentException("请完善商品成本价后再上架");
      }
      var guides = product.getGuidePrices().stream().filter(price -> variant.getId().equals(price.getSkuId())).toList();
      if (guides.size() != 1 || guides.getFirst().getPriceCoefficient() == null || guides.getFirst().getPriceCoefficient().signum() < 0
          || guides.getFirst().getPrice() == null || guides.getFirst().getPrice().signum() < 0) {
        throw new IllegalArgumentException("请完善每条规格的指导价后再上架");
      }
    }
    priceService.requireCompletePrices(product.getId(), product.getVariants());
  }

  @Transactional
  public FinishedProduct updateOperationWithDetails(Long id, FinishedProduct request, boolean priceOnly) {
    lifecycle.lock(ProductLifecycleService.Kind.FINISHED, id);
    FinishedProduct existing = attachDetails(getById(id));
    if (existing == null) { throw new IllegalArgumentException("运营商品不存在"); }
    lifecycle.requireFinishedOperational(existing);
    Map<String,Object> before = operationLogs.snapshot(existing);
    if (priceOnly) {
      Map<Long,java.math.BigDecimal> costs = sourceCosts(existing);
      if (request.getGuidePrices() == null || request.getMarkupPrices() == null) { throw new IllegalArgumentException("请完善价格"); }
      request.getGuidePrices().forEach(price -> requireSourceCost(costs.get(price.getSkuId()), price.getCostPrice()));
      request.getMarkupPrices().forEach(price -> requireSourceCost(costs.get(price.getSkuId()), price.getCostPrice()));
      existing.setGuidePrices(request.getGuidePrices());
      existing.setMarkupPrices(request.getMarkupPrices());
      writeValidator.validatePrices(existing);
      priceService.replacePrices(id, existing.getMarkupPrices());
      guidePriceService.replacePrices(id, existing.getGuidePrices());
      lambdaUpdate().eq(FinishedProduct::getId,id).set(FinishedProduct::getGuidePrice,existing.getGuidePrice()).update();
    } else {
      if ("selling".equals(request.getStatus())) { validateOperationsShelf(existing); }
      existing.setStatus(request.getStatus());
      existing.setOffShelfReason("offShelf".equals(request.getStatus()) ? request.getOffShelfReason() : null);
      existing.setOffShelfDetail("offShelf".equals(request.getStatus()) ? request.getOffShelfDetail() : null);
      if ("offShelf".equals(request.getStatus())) { existing.setOffShelfAt(LocalDateTime.now()); }
      // attachDetails renders source content for responses; never persist it during an operation-only update.
      lambdaUpdate().eq(FinishedProduct::getId, id)
          .set(FinishedProduct::getStatus, existing.getStatus())
          .set(existing.getOffShelfReason() != null, FinishedProduct::getOffShelfReason, existing.getOffShelfReason())
          .set(FinishedProduct::getOffShelfDetail, existing.getOffShelfDetail())
          .set(existing.getOffShelfAt() != null, FinishedProduct::getOffShelfAt, existing.getOffShelfAt())
          .update();
    }
    FinishedProduct updated = attachDetails(getById(id));
    operationLogs.record(updated, before, operationLogs.snapshot(updated));
    return updated;
  }

  private Map<Long,java.math.BigDecimal> sourceCosts(FinishedProduct product) {
    Map<Long,java.math.BigDecimal> costs = new LinkedHashMap<>();
    if (product.getVariants() != null) { product.getVariants().forEach(v -> costs.put(v.getId(), v.getCostPrice()==null?null:v.getCostPrice().setScale(2,java.math.RoundingMode.HALF_UP))); }
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
    if (release) { releaseFullyPurgedIfUnreferenced(productId); }
    return true;
  }

  /** Keep the source snapshot while any store still needs a read-only listing. */
  public void releaseFullyPurgedIfUnreferenced(Long productId) {
    Long remaining = jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM store_finished_products WHERE finished_product_id = ?",
        Long.class, productId);
    if (remaining != null && remaining == 0 && Boolean.TRUE.equals(jdbcTemplate.queryForObject("""
        SELECT source_status = 'purged' AND operations_deleted = TRUE
        FROM finished_products WHERE id = ?
        """, Boolean.class, productId))) {
      super.removeById(productId);
      mediaReferenceService.removeBusiness(MEDIA_DOMAIN, productId, "两端商品均已彻底删除且门店已移除");
    }
  }

  private void replaceDetails(FinishedProduct product) {
    Long productId = product.getId();
    Map<Long, FinishedProductVariant> existing = variantMapper.selectList(
        Wrappers.lambdaQuery(FinishedProductVariant.class)
            .eq(FinishedProductVariant::getFinishedProductId, productId)).stream()
        .collect(java.util.stream.Collectors.toMap(FinishedProductVariant::getId, java.util.function.Function.identity()));
    Set<Long> retained = new LinkedHashSet<>();
    // Validate every supplied ID before applying any SKU changes.
    for (FinishedProductVariant variant : product.getVariants()) {
      if (variant.getId() != null && !existing.containsKey(variant.getId())) {
        throw new IllegalArgumentException("SKU 不属于当前商品");
      }
    }
    product.getVariants().forEach(variant -> {
      variant.setFinishedProductId(productId);
      if (variant.getId() == null) {
        variantMapper.insert(variant);
      } else {
        variant.setCreatedAt(existing.get(variant.getId()).getCreatedAt());
        variant.setStatus(existing.get(variant.getId()).getStatus());
        variantMapper.updateById(variant);
      }
      retained.add(variant.getId());
    });
    existing.keySet().stream().filter(id -> !retained.contains(id)).forEach(variantMapper::deleteById);
    // Labels are snapshots in price rows; keep them aligned when a SKU is renamed.
    product.getVariants().forEach(variant -> {
      jdbcTemplate.update("UPDATE finished_product_guide_prices SET variant_label=? WHERE finished_product_id=? AND sku_id=?",
          variant.getVariantLabel(), productId, variant.getId());
      jdbcTemplate.update("UPDATE finished_product_prices SET variant_label=? WHERE finished_product_id=? AND sku_id=?",
          variant.getVariantLabel(), productId, variant.getId());
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
