package com.zdm.platform.inventory;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.zdm.platform.media.MediaAsset;
import com.zdm.platform.media.MediaAssetService;
import com.zdm.platform.media.MediaCleanupService;
import com.zdm.platform.media.MediaReferenceService;
import com.zdm.platform.security.CurrentIdentity;
import com.zdm.platform.security.CurrentIdentityProvider;
import java.io.Serializable;
import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class SlabInventoryService extends ServiceImpl<SlabInventoryMapper, SlabInventory> {
  private static final String DUPLICATE_SKU_MESSAGE = "SKU已存在";
  private static final String PLATFORM_PUBLISHER = "平台发布";
  private static final String API_PUBLISHER = "接口获取";
  private static final Set<String> ALLOWED_STATUSES = Set.of(
      "warehouse", "selling", "offShelf", "soldOut", "recycle");

  private final SlabTextureService textureService;
  private final SlabColorService colorService;
  private final SlabGradeService gradeService;
  private final SlabOriginService originService;
  private final SlabPriceService priceService;
  private final SlabOffShelfRecordService offShelfRecordService;
  private final MediaAssetService mediaAssetService;
  private final MediaCleanupService mediaCleanupService;
  private final MediaReferenceService mediaReferenceService;
  private final SlabOperationLogService operationLogService;
  private final CurrentIdentityProvider identityProvider;

  public SlabInventoryService(
      SlabTextureService textureService,
      SlabColorService colorService,
      SlabGradeService gradeService,
      SlabOriginService originService,
      SlabPriceService priceService,
      SlabOffShelfRecordService offShelfRecordService,
      MediaAssetService mediaAssetService,
      MediaCleanupService mediaCleanupService,
      MediaReferenceService mediaReferenceService,
      SlabOperationLogService operationLogService,
      CurrentIdentityProvider identityProvider) {
    this.textureService = textureService;
    this.colorService = colorService;
    this.gradeService = gradeService;
    this.originService = originService;
    this.priceService = priceService;
    this.offShelfRecordService = offShelfRecordService;
    this.mediaAssetService = mediaAssetService;
    this.mediaCleanupService = mediaCleanupService;
    this.mediaReferenceService = mediaReferenceService;
    this.operationLogService = operationLogService;
    this.identityProvider = identityProvider;
  }

  public List<SlabInventory> listWithPrices() {
    List<SlabInventory> inventory = baseMapper.selectListWithDetails();
    Map<Long, List<SlabOffShelfRecord>> recordsBySlabId = offShelfRecordService
        .listBySlabIds(inventory.stream().map(SlabInventory::getId).toList())
        .stream()
        .collect(Collectors.groupingBy(SlabOffShelfRecord::getSlabId));
    inventory.forEach(item -> {
      attachPrices(item);
      item.setOffShelfRecords(recordsBySlabId.getOrDefault(item.getId(), List.of()));
    });
    return inventory;
  }

  @Transactional
  public SlabInventory createWithPrices(SlabInventory inventory) {
    validateReferences(inventory);
    List<SlabPrice> markupPrices = inventory.getMarkupPrices();
    inventory.setId(null);
    applyCreationMetadata(inventory);
    try {
      save(inventory);
    } catch (DuplicateKeyException exception) {
      throw new IllegalArgumentException(DUPLICATE_SKU_MESSAGE, exception);
    }
    priceService.replacePrices(inventory.getId(), markupPrices);
    if ("selling".equals(inventory.getStatus())) {
      validateReadyForShelf(inventory);
    }
    syncMediaReferences(inventory);
    SlabInventory created = attachPrices(inventory);
    operationLogService.record(
        created,
        "CREATE",
        "创建大板",
        null,
        created.getStatus(),
        null,
        null,
        API_PUBLISHER.equals(created.getPublisherType()) ? "EXTERNAL_API" : "MANUAL",
        null,
        Map.of());
    return created;
  }

  @Transactional
  public SlabInventory updateWithPrices(Long id, SlabInventory inventory) {
    SlabInventory existing = getById(id);
    if (existing == null) {
      return null;
    }
    List<SlabPrice> existingPrices = priceService.listPrices(id);
    validateReferencesForUpdate(existing, inventory);
    List<SlabPrice> markupPrices = inventory.getMarkupPrices();
    inventory.setId(id);
    inventory.setCreatedByName(existing.getCreatedByName());
    inventory.setCreatedByAccountId(existing.getCreatedByAccountId());
    inventory.setCreatedAt(existing.getCreatedAt());
    inventory.setPublisherType(existing.getPublisherType());
    inventory.setStatus(existing.getStatus());
    try {
      updateById(inventory);
    } catch (DuplicateKeyException exception) {
      throw new IllegalArgumentException(DUPLICATE_SKU_MESSAGE, exception);
    }
    if (markupPrices != null) {
      priceService.replacePrices(id, markupPrices);
    }
    syncMediaReferences(inventory, existing);
    SlabInventory updated = attachPrices(getById(id));
    Map<String, Object> changes = collectChanges(existing, existingPrices, updated);
    if (!changes.isEmpty()) {
      boolean priceOnly = changes.keySet().stream().allMatch(this::isPriceChange);
      operationLogService.record(
          updated,
          priceOnly ? "PRICE_UPDATE" : "UPDATE",
          priceOnly ? "修改价格" : "编辑大板（修改" + changes.size() + "项）",
          existing.getStatus(),
          updated.getStatus(),
          null,
          null,
          "MANUAL",
          null,
          changes);
    }
    return updated;
  }

  public boolean cleanupTemporaryMedia(Long mediaId) {
    mediaAssetService.requireAvailable(mediaId);
    mediaCleanupService.enqueueAfterCommit(List.of(mediaId), "取消未保存的大板媒体");
    return true;
  }

  @Override
  @Transactional
  public boolean removeById(Serializable id) {
    SlabInventory existing = getById(id);
    boolean removed = super.removeById(id);
    if (removed && existing != null) {
      mediaReferenceService.removeBusiness("SLAB", existing.getId(), "大板被彻底删除");
    }
    return removed;
  }

  @Transactional
  public boolean deleteFromManagement(Long id, String reason, String detail) {
    SlabInventory inventory = requireDeletable(id);
    String normalizedReason = normalizeOptionalText(reason);
    String normalizedDetail = normalizeOptionalText(detail);
    if (API_PUBLISHER.equals(inventory.getPublisherType())) {
      if (normalizedReason == null) {
        throw new IllegalArgumentException("请选择删除原因");
      }
      operationLogService.record(
          inventory, "PHYSICAL_DELETE", "物理删除外部大板",
          inventory.getStatus(), null, normalizedReason, normalizedDetail,
          "MANUAL", null, Map.of());
      return removeById(id);
    }
    operationLogService.record(
        inventory, "DELETE_TO_RECYCLE", "删除至回收站",
        inventory.getStatus(), "recycle", normalizedReason, normalizedDetail,
        "MANUAL", null, Map.of());
    inventory.setStatus("recycle");
    return updateById(inventory);
  }

  @Transactional
  public boolean purgeFromRecycle(Long id) {
    SlabInventory inventory = getById(id);
    if (inventory == null || !"recycle".equals(inventory.getStatus())) {
      throw new IllegalArgumentException("只有回收站中的大板可以彻底删除");
    }
    operationLogService.record(
        inventory, "PURGE", "彻底删除大板",
        inventory.getStatus(), null, null, null,
        "MANUAL", null, Map.of());
    return removeById(id);
  }

  @Transactional
  public boolean purgeFromRecycleBatch(List<Long> ids) {
    List<Long> normalizedIds = new LinkedHashSet<>(ids == null ? List.<Long>of() : ids)
        .stream()
        .filter(Objects::nonNull)
        .toList();
    if (normalizedIds.isEmpty()) {
      throw new IllegalArgumentException("请选择大板");
    }
    List<SlabInventory> inventory = listByIds(normalizedIds);
    if (inventory.size() != normalizedIds.size()
        || inventory.stream().anyMatch(item -> !"recycle".equals(item.getStatus()))) {
      throw new IllegalArgumentException("只有回收站中的大板可以彻底删除");
    }
    String batchNo = UUID.randomUUID().toString();
    inventory.forEach(item -> operationLogService.record(
        item, "PURGE", "批量彻底删除大板", item.getStatus(), null,
        null, null, "MANUAL", batchNo, Map.of()));
    inventory.forEach(item -> removeById(item.getId()));
    return true;
  }

  private SlabInventory requireDeletable(Long id) {
    SlabInventory inventory = getById(id);
    if (inventory == null) {
      throw new IllegalArgumentException("大板不存在或已被删除");
    }
    if (!Set.of("warehouse", "offShelf").contains(inventory.getStatus())) {
      throw new IllegalArgumentException("只有仓库中或已下架的大板可以删除");
    }
    return inventory;
  }

  @Transactional
  public void updateStatuses(List<Long> ids, String status, String reason, String detail) {
    if (!ALLOWED_STATUSES.contains(status)) {
      throw new IllegalArgumentException("大板状态不正确");
    }
    String normalizedReason = normalizeOptionalText(reason);
    String normalizedDetail = normalizeOptionalText(detail);
    if ("offShelf".equals(status) && normalizedReason == null) {
      throw new IllegalArgumentException("请选择下架原因");
    }
    if (normalizedReason != null && normalizedReason.length() > 80) {
      throw new IllegalArgumentException("下架原因不能超过80个字");
    }
    if (normalizedDetail != null && normalizedDetail.length() > 500) {
      throw new IllegalArgumentException("详细说明不能超过500个字");
    }
    List<Long> normalizedIds = new LinkedHashSet<>(ids).stream().filter(java.util.Objects::nonNull).toList();
    if (normalizedIds.isEmpty()) {
      throw new IllegalArgumentException("请选择大板");
    }
    List<SlabInventory> inventory = listByIds(normalizedIds);
    if (inventory.size() != normalizedIds.size()) {
      throw new IllegalArgumentException("部分大板不存在或已被删除");
    }
    inventory.forEach(item -> validateStatusTransition(item, status));
    lambdaUpdate()
        .in(SlabInventory::getId, normalizedIds)
        .set(SlabInventory::getStatus, status)
        .update();
    String batchNo = normalizedIds.size() > 1 ? UUID.randomUUID().toString() : null;
    inventory.forEach(item -> operationLogService.record(
        item,
        statusOperationType(item.getStatus(), status),
        statusOperationSummary(item.getStatus(), status),
        item.getStatus(),
        status,
        normalizedReason,
        normalizedDetail,
        "MANUAL",
        batchNo,
        Map.of()));
    if ("offShelf".equals(status)) {
      CurrentIdentity identity = identityProvider.require();
      LocalDateTime offShelvedAt = LocalDateTime.now();
      List<SlabOffShelfRecord> records = normalizedIds.stream().map(id -> {
        SlabOffShelfRecord record = new SlabOffShelfRecord();
        record.setSlabId(id);
        record.setStandardReason(normalizedReason);
        record.setDetailReason(normalizedDetail);
        record.setOffShelvedAt(offShelvedAt);
        record.setOffShelvedByName(identity.displayName());
        record.setOffShelvedByAccountId(identity.accountId());
        return record;
      }).toList();
      offShelfRecordService.saveBatch(records);
    }
  }

  private String normalizeOptionalText(String value) {
    if (value == null || value.isBlank()) {
      return null;
    }
    return value.trim();
  }

  private String statusOperationType(String beforeStatus, String afterStatus) {
    if ("warehouse".equals(beforeStatus) && "selling".equals(afterStatus)) {
      return "SHELF";
    }
    if ("selling".equals(beforeStatus) && "offShelf".equals(afterStatus)) {
      return "OFF_SHELF";
    }
    if ("offShelf".equals(beforeStatus) && "warehouse".equals(afterStatus)) {
      return "RESTORE_WAREHOUSE";
    }
    if ("recycle".equals(beforeStatus) && "warehouse".equals(afterStatus)) {
      return "RESTORE_RECYCLE";
    }
    return "STATUS_UPDATE";
  }

  private String statusOperationSummary(String beforeStatus, String afterStatus) {
    return switch (statusOperationType(beforeStatus, afterStatus)) {
      case "SHELF" -> "上架大板";
      case "OFF_SHELF" -> "下架大板";
      case "RESTORE_WAREHOUSE" -> "放回仓库";
      case "RESTORE_RECYCLE" -> "从回收站恢复";
      default -> "修改大板状态";
    };
  }

  private Map<String, Object> collectChanges(
      SlabInventory before,
      List<SlabPrice> beforePrices,
      SlabInventory after) {
    Map<String, Object> changes = new LinkedHashMap<>();
    addChange(changes, "大板名称", before.getName(), after.getName());
    addChange(changes, "SKU", before.getSerialNo(), after.getSerialNo());
    addChange(changes, "供应商ID", before.getSupplierId(), after.getSupplierId());
    addChange(changes, "品种ID", before.getVarietyId(), after.getVarietyId());
    addChange(changes, "产地ID", before.getOriginId(), after.getOriginId());
    addChange(changes, "纹理ID", before.getTextureId(), after.getTextureId());
    addChange(changes, "色系ID", before.getColorId(), after.getColorId());
    addChange(changes, "等级ID", before.getGradeId(), after.getGradeId());
    addChange(changes, "仓库", before.getWarehouse(), after.getWarehouse());
    addChange(changes, "长度", before.getLengthMm(), after.getLengthMm());
    addChange(changes, "宽度", before.getWidthMm(), after.getWidthMm());
    addChange(changes, "高度", before.getThicknessMm(), after.getThicknessMm());
    addChange(changes, "误差", before.getToleranceMm(), after.getToleranceMm());
    addChange(changes, "扣角1长", before.getCorner1LengthMm(), after.getCorner1LengthMm());
    addChange(changes, "扣角1宽", before.getCorner1WidthMm(), after.getCorner1WidthMm());
    addChange(changes, "扣角2长", before.getCorner2LengthMm(), after.getCorner2LengthMm());
    addChange(changes, "扣角2宽", before.getCorner2WidthMm(), after.getCorner2WidthMm());
    addChange(changes, "扣角3长", before.getCorner3LengthMm(), after.getCorner3LengthMm());
    addChange(changes, "扣角3宽", before.getCorner3WidthMm(), after.getCorner3WidthMm());
    addChange(changes, "扣角4长", before.getCorner4LengthMm(), after.getCorner4LengthMm());
    addChange(changes, "扣角4宽", before.getCorner4WidthMm(), after.getCorner4WidthMm());
    addChange(changes, "面积", before.getAreaSquareMeter(), after.getAreaSquareMeter());
    addChange(changes, "1:1主图", before.getMainImageMediaId(), after.getMainImageMediaId());
    addChange(changes, "扫描图", before.getScanImageMediaId(), after.getScanImageMediaId());
    addChange(changes, "设计图", before.getDesignImageMediaId(), after.getDesignImageMediaId());
    addChange(changes, "商品视频", before.getVideoMediaId(), after.getVideoMediaId());
    addChange(changes, "视频封面", before.getVideoCoverMediaId(), after.getVideoCoverMediaId());
    addChange(changes, "成本价", before.getCostPrice(), after.getCostPrice());
    addChange(changes, "指导价", before.getGuidePrice(), after.getGuidePrice());
    addChange(changes, "价格层级", priceDetails(beforePrices), priceDetails(after.getMarkupPrices()));
    return changes;
  }

  private List<Map<String, Object>> priceDetails(List<SlabPrice> prices) {
    if (prices == null) {
      return List.of();
    }
    return prices.stream()
        .sorted(java.util.Comparator.comparing(SlabPrice::getMarkupConfigurationId))
        .map(price -> {
          Map<String, Object> value = new LinkedHashMap<>();
          value.put("configurationId", price.getMarkupConfigurationId());
          value.put("priceCoefficient", price.getPriceCoefficient());
          value.put("costPrice", price.getCostPrice());
          value.put("price", price.getPrice());
          return value;
        })
        .toList();
  }

  private void addChange(
      Map<String, Object> changes,
      String field,
      Object before,
      Object after) {
    if (Objects.deepEquals(before, after)) {
      return;
    }
    Map<String, Object> values = new LinkedHashMap<>();
    values.put("before", before);
    values.put("after", after);
    changes.put(field, values);
  }

  private boolean isPriceChange(String field) {
    return Set.of("成本价", "指导价", "价格层级").contains(field);
  }

  private void applyCreationMetadata(SlabInventory inventory) {
    String publisherType = normalizePublisherType(inventory.getPublisherType());
    inventory.setPublisherType(publisherType);
    inventory.setCreatedAt(LocalDateTime.now());
    if (API_PUBLISHER.equals(publisherType)) {
      if (!"selling".equals(inventory.getStatus())) {
        inventory.setStatus("warehouse");
      }
      inventory.setCreatedByName("外部系统");
      inventory.setCreatedByAccountId(null);
      return;
    }
    if (!"selling".equals(inventory.getStatus())) {
      inventory.setStatus("warehouse");
    }
    CurrentIdentity identity = identityProvider.require();
    inventory.setCreatedByName(identity.displayName());
    inventory.setCreatedByAccountId(identity.accountId());
  }

  private String normalizePublisherType(String publisherType) {
    if (publisherType == null || publisherType.isBlank() || PLATFORM_PUBLISHER.equals(publisherType)) {
      return PLATFORM_PUBLISHER;
    }
    if (API_PUBLISHER.equals(publisherType)) {
      return API_PUBLISHER;
    }
    throw new IllegalArgumentException("发布类型不正确");
  }

  private void validateStatusTransition(SlabInventory inventory, String targetStatus) {
    String currentStatus = inventory.getStatus();
    boolean allowed = switch (currentStatus) {
      case "warehouse" -> "selling".equals(targetStatus);
      case "selling" -> "offShelf".equals(targetStatus);
      case "offShelf", "recycle" -> "warehouse".equals(targetStatus);
      default -> false;
    };
    if (!allowed) {
      throw new IllegalArgumentException("当前大板状态不允许执行此操作");
    }
    if ("selling".equals(targetStatus)) {
      validateReadyForShelf(inventory);
    }
  }

  private void validateReadyForShelf(SlabInventory inventory) {
    validateReferences(inventory);
    if (inventory.getSupplierId() == null
        || inventory.getVarietyId() == null
        || inventory.getOriginId() == null
        || inventory.getTextureId() == null
        || inventory.getColorId() == null
        || inventory.getGradeId() == null
        || inventory.getLengthMm() == null
        || inventory.getWidthMm() == null
        || inventory.getThicknessMm() == null) {
      throw new IllegalArgumentException("请完善大板基础信息后再上架");
    }
    if (inventory.getCostPrice() == null
        || inventory.getCostPrice().signum() < 0
        || inventory.getGuidePrice() == null
        || inventory.getGuidePrice().signum() < 0) {
      throw new IllegalArgumentException("请完善大板价格后再上架");
    }
    priceService.requireCompletePrices(inventory.getId());
  }

  public SlabPublishOptions listPublishOptions() {
    List<SlabPublishOption> textures = textureService.list().stream()
        .map(item -> new SlabPublishOption(item.getId(), item.getName(), null, item.getStatus()))
        .toList();
    Map<Long, List<SlabPublishOption>> colorsByCategory = colorService.listColors().stream()
        .collect(Collectors.groupingBy(
            SlabColor::getCategoryId,
            Collectors.mapping(
                item -> new SlabPublishOption(item.getId(), item.getName(), null, item.getStatus()),
                Collectors.toList())));
    List<SlabPublishColorCategoryOption> colorCategories = colorService.listCategories().stream()
        .map(category -> new SlabPublishColorCategoryOption(
            category.getId(),
            category.getName(),
            category.getStatus(),
            colorsByCategory.getOrDefault(category.getId(), List.of())))
        .filter(category -> !category.children().isEmpty())
        .toList();
    List<SlabPublishOption> grades = gradeService.list().stream()
        .map(item -> new SlabPublishOption(item.getId(), item.getCode(), item.getName(), item.getStatus()))
        .toList();
    return new SlabPublishOptions(textures, colorCategories, grades);
  }

  public void validateReferences(SlabInventory inventory) {
    validateMeasurements(inventory);
    validateMedia(inventory, null);
    if (inventory.getTextureId() != null && textureService.getById(inventory.getTextureId()) == null) {
      throw new IllegalArgumentException("纹理不存在");
    }
    if (inventory.getColorId() != null && colorService.getById(inventory.getColorId()) == null) {
      throw new IllegalArgumentException("色系不存在");
    }
    if (inventory.getGradeId() != null && gradeService.getById(inventory.getGradeId()) == null) {
      throw new IllegalArgumentException("等级不存在");
    }
    if (inventory.getOriginId() != null && originService.getById(inventory.getOriginId()) == null) {
      throw new IllegalArgumentException("产地不存在");
    }
  }

  private void validateReferencesForUpdate(SlabInventory existing, SlabInventory inventory) {
    validateMeasurements(inventory);
    validateMedia(inventory, existing);
    if (inventory.getTextureId() != null && textureService.getById(inventory.getTextureId()) == null) {
      throw new IllegalArgumentException("纹理不存在");
    }
    if (inventory.getColorId() != null && colorService.getById(inventory.getColorId()) == null) {
      throw new IllegalArgumentException("色系不存在");
    }
    if (inventory.getGradeId() != null && gradeService.getById(inventory.getGradeId()) == null) {
      throw new IllegalArgumentException("等级不存在");
    }
    if (inventory.getOriginId() != null && originService.getById(inventory.getOriginId()) == null) {
      throw new IllegalArgumentException("产地不存在");
    }
  }

  private void validateMeasurements(SlabInventory inventory) {
    BigDecimal[] measurements = {
      inventory.getLengthMm(),
      inventory.getWidthMm(),
      inventory.getThicknessMm(),
      inventory.getToleranceMm(),
      inventory.getCorner1LengthMm(),
      inventory.getCorner1WidthMm(),
      inventory.getCorner2LengthMm(),
      inventory.getCorner2WidthMm(),
      inventory.getCorner3LengthMm(),
      inventory.getCorner3WidthMm(),
      inventory.getCorner4LengthMm(),
      inventory.getCorner4WidthMm()
    };
    for (BigDecimal measurement : measurements) {
      if (measurement != null
          && (measurement.signum() <= 0 || measurement.stripTrailingZeros().scale() > 2)) {
        throw new IllegalArgumentException("尺寸和扣角必须是大于0且最多2位小数的数字");
      }
    }
  }

  private SlabInventory attachPrices(SlabInventory inventory) {
    attachMediaUrls(inventory);
    inventory.setMarkupPrices(priceService.listPrices(inventory.getId()));
    return inventory;
  }

  private void validateMedia(SlabInventory inventory, SlabInventory existing) {
    requireMediaType(
        inventory.getMainImageMediaId(), existing == null ? null : existing.getMainImageMediaId(),
        "image", "请上传商品主图");
    requireMediaType(
        inventory.getScanImageMediaId(), existing == null ? null : existing.getScanImageMediaId(),
        "image", "请上传扫描图");
    requireMediaType(
        inventory.getDesignImageMediaId(), existing == null ? null : existing.getDesignImageMediaId(),
        "image", "请上传设计图");
    if (inventory.getVideoMediaId() != null) {
      requireMediaType(
          inventory.getVideoMediaId(), existing == null ? null : existing.getVideoMediaId(),
          "video", "商品视频格式不正确");
      requireMediaType(
          inventory.getVideoCoverMediaId(), existing == null ? null : existing.getVideoCoverMediaId(),
          "image", "商品视频封面不存在");
    } else if (inventory.getVideoCoverMediaId() != null) {
      throw new IllegalArgumentException("商品视频不存在");
    }
  }

  private void requireMediaType(
      Long mediaId, Long existingMediaId, String mediaType, String emptyMessage) {
    if (mediaId == null) {
      throw new IllegalArgumentException(emptyMessage);
    }
    MediaAsset asset = java.util.Objects.equals(mediaId, existingMediaId)
        ? mediaAssetService.requireReferencedAvailableForUpdate(mediaId)
        : mediaAssetService.requireAvailable(mediaId);
    if (!mediaType.equals(asset.getMediaType())) {
      throw new IllegalArgumentException("媒体文件类型不正确");
    }
  }

  private void syncMediaReferences(SlabInventory inventory) {
    syncMediaReferences(inventory, null);
  }

  private void syncMediaReferences(SlabInventory inventory, SlabInventory existing) {
    Map<String, Long> references = new LinkedHashMap<>();
    references.put("mainImage", inventory.getMainImageMediaId());
    references.put("scanImage", inventory.getScanImageMediaId());
    references.put("designImage", inventory.getDesignImageMediaId());
    references.put("video", inventory.getVideoMediaId());
    references.put("videoCover", inventory.getVideoCoverMediaId());
    mediaReferenceService.replace("SLAB", inventory.getId(), references);
    boolean videoReferenceChanged = existing == null
        || !java.util.Objects.equals(existing.getVideoMediaId(), inventory.getVideoMediaId())
        || !java.util.Objects.equals(existing.getVideoCoverMediaId(), inventory.getVideoCoverMediaId());
    if (videoReferenceChanged) {
      mediaAssetService.linkDerivedMedia(inventory.getVideoCoverMediaId(), inventory.getVideoMediaId());
    }
  }

  private void attachMediaUrls(SlabInventory inventory) {
    if (inventory == null) {
      return;
    }
    inventory.setMainImageUrl(mediaAssetService.publicUrl(inventory.getMainImageMediaId()));
    inventory.setScanImageUrl(mediaAssetService.publicUrl(inventory.getScanImageMediaId()));
    inventory.setDesignImageUrl(mediaAssetService.publicUrl(inventory.getDesignImageMediaId()));
    inventory.setVideoUrl(mediaAssetService.publicUrl(inventory.getVideoMediaId()));
    inventory.setVideoCoverUrl(mediaAssetService.publicUrl(inventory.getVideoCoverMediaId()));
  }
}
