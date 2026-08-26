package com.zdm.platform.store;

import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableName;
import com.zdm.platform.common.BaseEntity;
import jakarta.validation.constraints.NotBlank;

@TableName("store_levels")
public class StoreLevel extends BaseEntity {
  @NotBlank
  private String name;
  private Integer sortOrder;

  private String createdByName;
  private Long createdByAccountId;
  private String remark;
  @TableField(exist = false) private boolean finishedPriceConfigured;
  @TableField(exist = false) private boolean slabPriceConfigured;
  @TableField(exist = false) private boolean priceComplete;

  public String getName() {
    return name;
  }

  public void setName(String name) {
    this.name = name;
  }

  public Integer getSortOrder() {
    return sortOrder;
  }

  public void setSortOrder(Integer sortOrder) {
    this.sortOrder = sortOrder;
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

  public boolean isFinishedPriceConfigured() {
    return finishedPriceConfigured;
  }

  public void setFinishedPriceConfigured(boolean finishedPriceConfigured) {
    this.finishedPriceConfigured = finishedPriceConfigured;
  }

  public boolean isSlabPriceConfigured() {
    return slabPriceConfigured;
  }

  public void setSlabPriceConfigured(boolean slabPriceConfigured) {
    this.slabPriceConfigured = slabPriceConfigured;
  }

  public boolean isPriceComplete() {
    return priceComplete;
  }

  public void setPriceComplete(boolean priceComplete) {
    this.priceComplete = priceComplete;
  }
}
