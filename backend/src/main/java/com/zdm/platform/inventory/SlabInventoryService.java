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
  private static final Set<String> ALLOWED_STATUSES = Set.of(
      "warehouse", "selling", "offShelf", "soldOut", "recycle");

  private final SlabTextureService textureService;
  private final SlabColorService colorService;
  private final SlabGradeService gradeService;
  private final SlabOriginService originService;
  private final SlabPriceService priceService;
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
      MediaAssetService mediaAssetService,
      MediaCleanupService mediaCleanupService,
      MediaReferenceService mediaReferenceService,
      CurrentIdentityProvider identityProvider) {
    this.textureService = textureService;
    this.colorService = colorService;
    this.gradeService = gradeService;
    this.originService = originService;
    this.priceService = priceService;
    this.mediaAssetService = mediaAssetService;
    this.mediaCleanupService = mediaCleanupService;
    this.mediaReferenceService = mediaReferenceService;
    this.identityProvider = identityProvider;
  }

  public List<SlabInventory> listWithPrices() {
    List<SlabInventory> inventory = baseMapper.selectListWithDetails();
    inventory.forEach(this::attachPrices);
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
  public void updateStatuses(List<Long> ids, String status) {
    if (!ALLOWED_STATUSES.contains(status)) {
      throw new IllegalArgumentException("大板状态不正确");
    }
    List<Long> normalizedIds = new LinkedHashSet<>(ids).stream().filter(java.util.Objects::nonNull).toList();
    if (normalizedIds.isEmpty()) {
      throw new IllegalArgumentException("请选择大板");
    }
    if (listByIds(normalizedIds).size() != normalizedIds.size()) {
      throw new IllegalArgumentException("部分大板不存在或已被删除");
    }
    lambdaUpdate()
        .in(SlabInventory::getId, normalizedIds)
        .set(SlabInventory::getStatus, status)
        .update();
  }

  private void applyCreationMetadata(SlabInventory inventory) {
    String publisherType = normalizePublisherType(inventory.getPublisherType());
    inventory.setPublisherType(publisherType);
    inventory.setCreatedAt(LocalDateTime.now());
    if (API_PUBLISHER.equals(publisherType)) {
      inventory.setCreatedByName("接口获取");
      inventory.setCreatedByAccountId(null);
      return;
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
