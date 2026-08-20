package com.zdm.platform.supplier;

import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableName;
import com.zdm.platform.common.BaseEntity;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import java.util.List;

@TableName("suppliers")
public class Supplier extends BaseEntity {
  @NotBlank
  private String name;

  private String ownerScope;
  private Long ownerId;
  private Long tenantId;
  private Long storeId;

  private String contactName;
  private String contactPhone;
  private String region;
  private String address;
  private String qualificationStatus;
  private String createdByName;
  private Long createdByAccountId;
  private String remark;

  @TableField(exist = false)
  @NotEmpty(message = "请至少选择一个供货类型")
  private List<Long> supplyTypeIds;

  @TableField(exist = false)
  private List<SupplierSupplyType> supplyTypes;

  public String getName() {
    return name;
  }

  public void setName(String name) {
    this.name = name;
  }

  public String getOwnerScope() { return ownerScope; }
  public void setOwnerScope(String ownerScope) { this.ownerScope = ownerScope; }
  public Long getOwnerId() { return ownerId; }
  public void setOwnerId(Long ownerId) { this.ownerId = ownerId; }
  public Long getTenantId() { return tenantId; }
  public void setTenantId(Long tenantId) { this.tenantId = tenantId; }
  public Long getStoreId() { return storeId; }
  public void setStoreId(Long storeId) { this.storeId = storeId; }

  public String getContactName() {
    return contactName;
  }

  public void setContactName(String contactName) {
    this.contactName = contactName;
  }

  public String getContactPhone() {
    return contactPhone;
  }

  public void setContactPhone(String contactPhone) {
    this.contactPhone = contactPhone;
  }

  public String getRegion() {
    return region;
  }

  public void setRegion(String region) {
    this.region = region;
  }

  public String getAddress() {
    return address;
  }

  public void setAddress(String address) {
    this.address = address;
  }

  public String getQualificationStatus() {
    return qualificationStatus;
  }

  public void setQualificationStatus(String qualificationStatus) {
    this.qualificationStatus = qualificationStatus;
  }

  public String getCreatedByName() {
    return createdByName;
  }

  public void setCreatedByName(String createdByName) {
    this.createdByName = createdByName;
  }

  public Long getCreatedByAccountId() {
    return createdByAccountId;
  }

  public void setCreatedByAccountId(Long createdByAccountId) {
    this.createdByAccountId = createdByAccountId;
  }

  public String getRemark() {
    return remark;
  }

  public void setRemark(String remark) {
    this.remark = remark;
  }

  public List<Long> getSupplyTypeIds() {
    return supplyTypeIds == null ? List.of() : List.copyOf(supplyTypeIds);
  }

  public void setSupplyTypeIds(List<Long> supplyTypeIds) {
    this.supplyTypeIds = supplyTypeIds == null ? List.of() : List.copyOf(supplyTypeIds);
  }

  public List<SupplierSupplyType> getSupplyTypes() {
    return supplyTypes == null ? List.of() : List.copyOf(supplyTypes);
  }

  public void setSupplyTypes(List<SupplierSupplyType> supplyTypes) {
    this.supplyTypes = supplyTypes == null ? List.of() : List.copyOf(supplyTypes);
  }
}
