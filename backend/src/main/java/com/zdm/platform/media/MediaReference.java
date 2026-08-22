package com.zdm.platform.media;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;

@TableName("media_references")
public class MediaReference {
  @TableId(type = IdType.AUTO)
  private Long id;
  private Long mediaId;
  private String businessDomain;
  private Long businessId;
  private String fieldKey;
  private String ownerClientCode;
  private Long tenantId;
  private Long storeId;
  private LocalDateTime createdAt;
  private LocalDateTime updatedAt;

  public Long getId() { return id; }
  public void setId(Long id) { this.id = id; }
  public Long getMediaId() { return mediaId; }
  public void setMediaId(Long mediaId) { this.mediaId = mediaId; }
  public String getBusinessDomain() { return businessDomain; }
  public void setBusinessDomain(String businessDomain) { this.businessDomain = businessDomain; }
  public Long getBusinessId() { return businessId; }
  public void setBusinessId(Long businessId) { this.businessId = businessId; }
  public String getFieldKey() { return fieldKey; }
  public void setFieldKey(String fieldKey) { this.fieldKey = fieldKey; }
  public String getOwnerClientCode() { return ownerClientCode; }
  public void setOwnerClientCode(String ownerClientCode) { this.ownerClientCode = ownerClientCode; }
  public Long getTenantId() { return tenantId; }
  public void setTenantId(Long tenantId) { this.tenantId = tenantId; }
  public Long getStoreId() { return storeId; }
  public void setStoreId(Long storeId) { this.storeId = storeId; }
  public LocalDateTime getCreatedAt() { return createdAt; }
  public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
  public LocalDateTime getUpdatedAt() { return updatedAt; }
  public void setUpdatedAt(LocalDateTime updatedAt) { this.updatedAt = updatedAt; }
}
