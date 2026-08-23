package com.zdm.platform.media;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.zdm.platform.security.CurrentIdentity;
import com.zdm.platform.security.CurrentIdentityProvider;
import java.time.LocalDateTime;
import java.util.Objects;
import org.springframework.core.io.Resource;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

@Service
public class MediaAssetService extends ServiceImpl<MediaAssetMapper, MediaAsset> {
  private final CurrentIdentityProvider identityProvider;
  private final MediaStorageService storageService;

  public MediaAssetService(
      CurrentIdentityProvider identityProvider,
      MediaStorageService storageService) {
    this.identityProvider = identityProvider;
    this.storageService = storageService;
  }

  @Transactional
  public MediaUploadResponse upload(MultipartFile file, long imageSizeLimit) {
    CurrentIdentity identity = identityProvider.require();
    MediaStorageService.StoredMedia stored = storageService.store(file, imageSizeLimit);
    MediaAsset asset = new MediaAsset();
    asset.setPublicId(stored.publicId());
    asset.setStorageKey(stored.storageKey());
    asset.setOriginalName(file.getOriginalFilename());
    asset.setMediaType(stored.mediaType());
    asset.setMimeType(stored.mimeType());
    asset.setFileSize(stored.fileSize());
    asset.setAccessLevel("public");
    asset.setOwnerClientCode(identity.clientCode());
    asset.setTenantId(identity.tenantId());
    asset.setStoreId(identity.storeId());
    asset.setCreatedByAccountId(identity.accountId());
    asset.setStatus("temporary");
    try {
      save(asset);
    } catch (RuntimeException exception) {
      try {
        storageService.delete(stored.storageKey());
      } catch (RuntimeException cleanupException) {
        exception.addSuppressed(cleanupException);
      }
      throw exception;
    }
    return toResponse(asset);
  }

  public MediaAsset requireAvailable(Long mediaId) {
    if (mediaId == null) {
      return null;
    }
    MediaAsset asset = getById(mediaId);
    if (asset == null || "deleted".equals(asset.getStatus())) {
      throw new IllegalArgumentException("媒体资源不存在");
    }
    requireSameScope(asset);
    return asset;
  }

  public MediaAsset requireAvailableForUpdate(Long mediaId) {
    if (mediaId == null) {
      return null;
    }
    MediaAsset asset = baseMapper.selectByIdForUpdate(mediaId);
    if (asset == null || "deleted".equals(asset.getStatus())) {
      throw new IllegalArgumentException("媒体资源不存在");
    }
    requireSameScope(asset);
    return asset;
  }

  public String publicUrl(Long mediaId) {
    if (mediaId == null) {
      return null;
    }
    MediaAsset asset = getById(mediaId);
    return asset == null || "deleted".equals(asset.getStatus()) ? null : publicUrl(asset);
  }

  public Resource load(String publicId) {
    MediaAsset asset = baseMapper.selectAvailableByPublicId(publicId);
    if (asset == null || !"public".equals(asset.getAccessLevel())) {
      throw new IllegalArgumentException("媒体资源不存在");
    }
    return storageService.load(asset.getStorageKey());
  }

  public MediaAsset findPublic(String publicId) {
    return baseMapper.selectAvailableByPublicId(publicId);
  }

  public MediaUploadResponse toResponse(MediaAsset asset) {
    return new MediaUploadResponse(asset.getId(), publicUrl(asset), asset.getMediaType(), asset.getMimeType());
  }

  private String publicUrl(MediaAsset asset) {
    return "/api/open/media/" + asset.getPublicId();
  }

  private void requireSameScope(MediaAsset asset) {
    CurrentIdentity identity = identityProvider.require();
    if (identity.isSuperAdmin()) {
      return;
    }
    boolean matches = Objects.equals(asset.getOwnerClientCode(), identity.clientCode())
        && Objects.equals(asset.getTenantId(), identity.tenantId())
        && Objects.equals(asset.getStoreId(), identity.storeId());
    if (!matches) {
      throw new IllegalArgumentException("媒体资源不存在");
    }
  }

  @Transactional
  public void markReferenced(MediaAsset asset) {
    asset.setStatus("active");
    asset.setConfirmedAt(asset.getConfirmedAt() == null ? LocalDateTime.now() : asset.getConfirmedAt());
    asset.setLastReferencedAt(LocalDateTime.now());
    asset.setPendingDeleteAt(null);
    updateById(asset);
  }

  @Transactional
  public void linkDerivedMedia(Long derivedMediaId, Long sourceMediaId) {
    if (derivedMediaId == null) {
      return;
    }
    MediaAsset derived = requireAvailable(derivedMediaId);
    if (sourceMediaId == null) {
      derived.setDerivedFromMediaId(null);
    } else {
      MediaAsset source = requireAvailable(sourceMediaId);
      if (!"video".equals(source.getMediaType()) || !"image".equals(derived.getMediaType())) {
        throw new IllegalArgumentException("视频封面媒体类型不正确");
      }
      derived.setDerivedFromMediaId(source.getId());
    }
    updateById(derived);
  }
}
