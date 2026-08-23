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
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class SlabInventoryService extends ServiceImpl<SlabInventoryMapper, SlabInventory> {
  private static final String DUPLICATE_SERIAL_MESSAGE = "大板编码已存在";
  private static final String PLATFORM_PUBLISHER = "平台发布";
  private static final String API_PUBLISHER = "接口获取";
  private static final String PENDING_REVIEW_STATUS = "pendingReview";
  private static final String REJECTED_STATUS = "rejected";
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
      throw new IllegalArgumentException(DUPLICATE_SERIAL_MESSAGE, exception);
    }
    priceService.replacePrices(inventory.getId(), markupPrices);
    if ("selling".equals(inventory.getStatus())) {
      validateReadyForShelf(inventory);
    }
    syncMediaReferences(inventory);
    return attachPrices(inventory);
  }

  @Transactional
  public SlabInventory updateWithPrices(Long id, SlabInventory inventory) {
    validateReferences(inventory);
    SlabInventory existing = getById(id);
    if (existing == null) {
      return null;
    }
    List<SlabPrice> markupPrices = inventory.getMarkupPrices();
    inventory.setId(id);
    inventory.setCreatedByName(existing.getCreatedByName());
    inventory.setCreatedByAccountId(existing.getCreatedByAccountId());
    inventory.setCreatedAt(existing.getCreatedAt());
    inventory.setPublisherType(existing.getPublisherType());
    inventory.setStatus(existing.getStatus());
    inventory.setRejectionReason(existing.getRejectionReason());
    inventory.setRejectionDetail(existing.getRejectionDetail());
    inventory.setRejectedByName(existing.getRejectedByName());
    inventory.setRejectedByAccountId(existing.getRejectedByAccountId());
    inventory.setRejectedAt(existing.getRejectedAt());
    try {
      updateById(inventory);
    } catch (DuplicateKeyException exception) {
      throw new IllegalArgumentException(DUPLICATE_SERIAL_MESSAGE, exception);
    }
    if (markupPrices != null) {
      priceService.replacePrices(id, markupPrices);
    }
    syncMediaReferences(inventory);
    return attachPrices(getById(id));
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

  @Transactional
  public SlabInventory reject(Long id, String reason, String detail) {
    SlabInventory inventory = getById(id);
    if (inventory == null) {
      throw new IllegalArgumentException("大板不存在或已被删除");
    }
    if (!API_PUBLISHER.equals(inventory.getPublisherType())) {
      throw new IllegalArgumentException("只有接口获取且待审核的大板可以驳回");
    }
    if (!PENDING_REVIEW_STATUS.equals(inventory.getStatus())) {
      throw new IllegalArgumentException("当前大板状态不允许驳回");
    }
    CurrentIdentity identity = identityProvider.require();
    inventory.setStatus(REJECTED_STATUS);
    inventory.setRejectionReason(reason.trim());
    inventory.setRejectionDetail(detail.trim());
    inventory.setRejectedByName(identity.displayName());
    inventory.setRejectedByAccountId(identity.accountId());
    inventory.setRejectedAt(LocalDateTime.now());
    updateById(inventory);
    return attachPrices(inventory);
  }

  private String normalizeOptionalText(String value) {
    if (value == null || value.isBlank()) {
      return null;
    }
    return value.trim();
  }

  private void applyCreationMetadata(SlabInventory inventory) {
    String publisherType = normalizePublisherType(inventory.getPublisherType());
    inventory.setPublisherType(publisherType);
    inventory.setCreatedAt(LocalDateTime.now());
    if (API_PUBLISHER.equals(publisherType)) {
      inventory.setStatus(PENDING_REVIEW_STATUS);
      inventory.setCreatedByName("接口获取");
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
      case PENDING_REVIEW_STATUS -> "selling".equals(targetStatus);
      case "warehouse" -> Set.of("selling", "recycle").contains(targetStatus);
      case "selling" -> Set.of("offShelf", "recycle").contains(targetStatus);
      case "offShelf" -> Set.of("warehouse", "recycle").contains(targetStatus);
      case "recycle" -> "warehouse".equals(targetStatus);
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
    validateMedia(inventory);
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

  private void validateMedia(SlabInventory inventory) {
    requireMediaType(inventory.getMainImageMediaId(), "image", "请上传商品主图");
    requireMediaType(inventory.getScanImageMediaId(), "image", "请上传扫描图");
    requireMediaType(inventory.getDesignImageMediaId(), "image", "请上传设计图");
    if (inventory.getVideoMediaId() != null) {
      requireMediaType(inventory.getVideoMediaId(), "video", "商品视频格式不正确");
      requireMediaType(inventory.getVideoCoverMediaId(), "image", "商品视频封面不存在");
    } else if (inventory.getVideoCoverMediaId() != null) {
      throw new IllegalArgumentException("商品视频不存在");
    }
  }

  private void requireMediaType(Long mediaId, String mediaType, String emptyMessage) {
    if (mediaId == null) {
      throw new IllegalArgumentException(emptyMessage);
    }
    MediaAsset asset = mediaAssetService.requireAvailable(mediaId);
    if (!mediaType.equals(asset.getMediaType())) {
      throw new IllegalArgumentException("媒体文件类型不正确");
    }
  }

  private void syncMediaReferences(SlabInventory inventory) {
    Map<String, Long> references = new LinkedHashMap<>();
    references.put("mainImage", inventory.getMainImageMediaId());
    references.put("scanImage", inventory.getScanImageMediaId());
    references.put("designImage", inventory.getDesignImageMediaId());
    references.put("video", inventory.getVideoMediaId());
    references.put("videoCover", inventory.getVideoCoverMediaId());
    mediaReferenceService.replace("SLAB", inventory.getId(), references);
    mediaAssetService.linkDerivedMedia(inventory.getVideoCoverMediaId(), inventory.getVideoMediaId());
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
