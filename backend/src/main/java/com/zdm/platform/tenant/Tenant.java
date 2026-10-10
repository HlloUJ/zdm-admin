package com.zdm.platform.tenant;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import java.time.LocalDateTime;

@TableName("tenants")
public class Tenant implements com.zdm.platform.security.CreatorOwned, com.zdm.platform.account.NamedCreatorOwned {
  @TableId(type = IdType.AUTO)
  private Long id;

  @com.fasterxml.jackson.annotation.JsonIgnore
  private Long accountId;
  public Long getAccountId() { return accountId; }
  public void setAccountId(Long value) { accountId = value; }

  @NotBlank
  @com.baomidou.mybatisplus.annotation.TableField(exist = false)
  private String name;

  @NotBlank
  @Pattern(regexp = "^1[3-9]\\d{9}$")
  @com.baomidou.mybatisplus.annotation.TableField(exist = false)
  private String contactPhone;

  @NotBlank
  private String status;

  @com.baomidou.mybatisplus.annotation.TableField(exist = false)
  private String createdByName;
  private Long createdByAccountId;
  private String businessTypes;
  private String remark;
  private LocalDateTime createdAt;
  private LocalDateTime updatedAt;

  public Long getId() {
    return id;
  }

  public void setId(Long id) {
    this.id = id;
  }

  public String getName() {
    return name;
  }

  public void setName(String name) {
    this.name = name;
  }

  public String getContactPhone() {
    return contactPhone;
  }

  public void setContactPhone(String contactPhone) {
    this.contactPhone = contactPhone;
  }

  public String getStatus() {
    return status;
  }

  public void setStatus(String status) {
    this.status = status;
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

  public String getBusinessTypes() {
    return businessTypes;
  }

  public void setBusinessTypes(String businessTypes) {
    this.businessTypes = businessTypes;
  }

  public String getRemark() {
    return remark;
  }

  public void setRemark(String remark) {
    this.remark = remark;
  }

  public LocalDateTime getCreatedAt() {
    return createdAt;
  }

  public void setCreatedAt(LocalDateTime createdAt) {
    this.createdAt = createdAt;
  }

  public LocalDateTime getUpdatedAt() {
    return updatedAt;
  }

  public void setUpdatedAt(LocalDateTime updatedAt) {
    this.updatedAt = updatedAt;
  }
}
