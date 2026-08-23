package com.zdm.platform.media;

import com.baomidou.mybatisplus.annotation.TableName;
import com.zdm.platform.common.BaseEntity;
import java.time.LocalDateTime;

@TableName("media_assets")
public class MediaAsset extends BaseEntity {
  private String publicId;
  private String storageKey;
  private String originalName;
  private String mediaType;
  private String mimeType;
  private Long fileSize;
  private String accessLevel;
  private String ownerClientCode;
  private Long tenantId;
  private Long storeId;
  private Long createdByAccountId;
  private Long derivedFromMediaId;
  private LocalDateTime confirmedAt;
  private LocalDateTime lastReferencedAt;
  private LocalDateTime pendingDeleteAt;
  private LocalDateTime deletedAt;

  public String getPublicId() { return publicId; }
  public void setPublicId(String publicId) { this.publicId = publicId; }
  public String getStorageKey() { return storageKey; }
  public void setStorageKey(String storageKey) { this.storageKey = storageKey; }
  public String getOriginalName() { return originalName; }
  public void setOriginalName(String originalName) { this.originalName = originalName; }
  public String getMediaType() { return mediaType; }
  public void setMediaType(String mediaType) { this.mediaType = mediaType; }
  public String getMimeType() { return mimeType; }
  public void setMimeType(String mimeType) { this.mimeType = mimeType; }
  public Long getFileSize() { return fileSize; }
  public void setFileSize(Long fileSize) { this.fileSize = fileSize; }
  public String getAccessLevel() { return accessLevel; }
  public void setAccessLevel(String accessLevel) { this.accessLevel = accessLevel; }
  public String getOwnerClientCode() { return ownerClientCode; }
  public void setOwnerClientCode(String ownerClientCode) { this.ownerClientCode = ownerClientCode; }
  public Long getTenantId() { return tenantId; }
  public void setTenantId(Long tenantId) { this.tenantId = tenantId; }
  public Long getStoreId() { return storeId; }
  public void setStoreId(Long storeId) { this.storeId = storeId; }
  public Long getCreatedByAccountId() { return createdByAccountId; }
  public void setCreatedByAccountId(Long createdByAccountId) { this.createdByAccountId = createdByAccountId; }
  public Long getDerivedFromMediaId() { return derivedFromMediaId; }
  public void setDerivedFromMediaId(Long derivedFromMediaId) { this.derivedFromMediaId = derivedFromMediaId; }
  public LocalDateTime getConfirmedAt() { return confirmedAt; }
  public void setConfirmedAt(LocalDateTime confirmedAt) { this.confirmedAt = confirmedAt; }
  public LocalDateTime getLastReferencedAt() { return lastReferencedAt; }
  public void setLastReferencedAt(LocalDateTime lastReferencedAt) { this.lastReferencedAt = lastReferencedAt; }
  public LocalDateTime getPendingDeleteAt() { return pendingDeleteAt; }
  public void setPendingDeleteAt(LocalDateTime pendingDeleteAt) { this.pendingDeleteAt = pendingDeleteAt; }
  public LocalDateTime getDeletedAt() { return deletedAt; }
  public void setDeletedAt(LocalDateTime deletedAt) { this.deletedAt = deletedAt; }
}
