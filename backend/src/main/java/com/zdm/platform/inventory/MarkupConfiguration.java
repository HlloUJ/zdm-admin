package com.zdm.platform.inventory;

import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableName;
import com.zdm.platform.common.BaseEntity;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;

@TableName("markup_configurations")
public class MarkupConfiguration extends BaseEntity {
  @NotBlank
  private String productType;

  @NotBlank
  @Size(max = 20)
  private String name;

  @NotNull
  @DecimalMin("0.0000")
  @Digits(integer = 3, fraction = 4)
  private BigDecimal markupRate;

  private Integer sortOrder;

  private String createdByName;
  private Long createdByAccountId;

  @TableField(exist = false)
  private boolean referenced;

  public String getProductType() {
    return productType;
  }

  public void setProductType(String productType) {
    this.productType = productType;
  }

  public String getName() {
    return name;
  }

  public void setName(String name) {
    this.name = name;
  }

  public BigDecimal getMarkupRate() {
    return markupRate;
  }

  public void setMarkupRate(BigDecimal markupRate) {
    this.markupRate = markupRate;
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

  public boolean isReferenced() {
    return referenced;
  }

  public void setReferenced(boolean referenced) {
    this.referenced = referenced;
  }
}
