package com.zdm.platform.craft;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.zdm.platform.media.MediaAsset;
import com.zdm.platform.media.MediaAssetService;
import com.zdm.platform.media.MediaCleanupService;
import com.zdm.platform.media.MediaReferenceService;
import com.zdm.platform.security.CurrentIdentity;
import com.zdm.platform.security.CurrentIdentityProvider;
import com.zdm.platform.security.CreatorOwnershipGuard;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import java.util.List;
import java.util.Map;

@Service
public class CraftService extends ServiceImpl<CraftMapper, Craft> {
  private static final String DEFAULT_CREATED_BY_NAME = "韩健";

  private final CurrentIdentityProvider identityProvider;
  private final CreatorOwnershipGuard ownershipGuard;
  private final MediaAssetService mediaAssetService;
  private final MediaCleanupService mediaCleanupService;
  private final MediaReferenceService mediaReferenceService;

  public CraftService(
      CurrentIdentityProvider identityProvider,
      CreatorOwnershipGuard ownershipGuard,
      MediaAssetService mediaAssetService,
      MediaCleanupService mediaCleanupService,
      MediaReferenceService mediaReferenceService) {
    this.identityProvider = identityProvider;
    this.ownershipGuard = ownershipGuard;
    this.mediaAssetService = mediaAssetService;
    this.mediaCleanupService = mediaCleanupService;
    this.mediaReferenceService = mediaReferenceService;
  }

  public List<Craft> listCrafts() {
    return list().stream().map(this::attachMediaUrl).toList();
  }

  @Transactional
  public Craft createCraft(Craft craft) {
    validateImage(craft.getImageMediaId());
    craft.setId(null);
    craft.setCreatedByName(resolveCreatedByName());
    craft.setCreatedByAccountId(ownershipGuard.currentAccountId());
    save(craft);
    mediaReferenceService.replace(
        "FINISHED_STOCK_CRAFT", craft.getId(), Map.of("image", craft.getImageMediaId()));
    return attachMediaUrl(craft);
  }

  @Transactional
  public Craft updateCraft(Long id, Craft payload) {
    Craft existing = getById(id);
    if (existing == null) {
      return null;
    }
    ownershipGuard.requireCreator(existing.getCreatedByAccountId(), existing.getCreatedByName());
    validateImage(payload.getImageMediaId());

    payload.setId(id);
    payload.setCreatedByName(existing.getCreatedByName());
    payload.setCreatedByAccountId(existing.getCreatedByAccountId());
    updateById(payload);
    mediaReferenceService.replace(
        "FINISHED_STOCK_CRAFT", id, Map.of("image", payload.getImageMediaId()));
    return attachMediaUrl(getById(id));
  }

  @Transactional
  public Craft updateStatus(Long id, String status) {
    Craft existing = getById(id);
    if (existing == null) {
      return null;
    }
    ownershipGuard.requireCreator(existing.getCreatedByAccountId(), existing.getCreatedByName());
    existing.setStatus(status);
    updateById(existing);
    return attachMediaUrl(getById(id));
  }

  @Transactional
  public boolean deleteCraft(Long id) {
    Craft existing = getById(id);
    if (existing == null) {
      return false;
    }
    ownershipGuard.requireCreator(existing.getCreatedByAccountId(), existing.getCreatedByName());
    boolean removed = removeById(id);
    if (removed) {
      mediaReferenceService.removeBusiness("FINISHED_STOCK_CRAFT", id, "成品工艺被删除");
    }
    return removed;
  }

  public boolean cleanupTemporaryMedia(Long mediaId) {
    mediaAssetService.requireAvailable(mediaId);
    mediaCleanupService.enqueueAfterCommit(List.of(mediaId), "取消未保存的工艺图片");
    return true;
  }

  private void validateImage(Long mediaId) {
    if (mediaId == null) {
      throw new IllegalArgumentException("请上传工艺图片");
    }
    MediaAsset asset = mediaAssetService.requireAvailable(mediaId);
    if (!"image".equals(asset.getMediaType())) {
      throw new IllegalArgumentException("工艺图片格式不正确");
    }
  }

  private Craft attachMediaUrl(Craft craft) {
    if (craft != null) {
      craft.setImageUrl(mediaAssetService.publicUrl(craft.getImageMediaId()));
    }
    return craft;
  }

  private String resolveCreatedByName() {
    CurrentIdentity identity = identityProvider.current().orElse(null);
    return identity != null && StringUtils.hasText(identity.displayName())
        ? identity.displayName()
        : DEFAULT_CREATED_BY_NAME;
  }
}
