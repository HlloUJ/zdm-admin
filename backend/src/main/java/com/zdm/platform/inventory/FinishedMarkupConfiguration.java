package com.zdm.platform.inventory;

import com.baomidou.mybatisplus.annotation.TableName;
import com.zdm.platform.common.BaseEntity;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;

@TableName("finished_markup_configurations")
public class FinishedMarkupConfiguration extends BaseEntity {
  @NotNull private Long storeLevelId;
  private String name;
  @NotNull @DecimalMin(value = "0.0000", inclusive = false) @Digits(integer = 3, fraction = 4)
  private BigDecimal priceCoefficient;
  private Integer sortOrder;
  private String createdByName;
  private Long createdByAccountId;
  private Boolean legacySeeded;

  public Long getStoreLevelId() { return storeLevelId; }
  public void setStoreLevelId(Long storeLevelId) { this.storeLevelId = storeLevelId; }
  public String getName() { return name; }
  public void setName(String name) { this.name = name; }
  public BigDecimal getPriceCoefficient() { return priceCoefficient; }
  public void setPriceCoefficient(BigDecimal priceCoefficient) { this.priceCoefficient = priceCoefficient; }
  public Integer getSortOrder() { return sortOrder; }
  public void setSortOrder(Integer sortOrder) { this.sortOrder = sortOrder; }
  public String getCreatedByName() { return createdByName; }
  public void setCreatedByName(String createdByName) { this.createdByName = createdByName; }
  public Long getCreatedByAccountId() { return createdByAccountId; }
  public void setCreatedByAccountId(Long createdByAccountId) { this.createdByAccountId = createdByAccountId; }
  public Boolean getLegacySeeded() { return legacySeeded; }
  public void setLegacySeeded(Boolean legacySeeded) { this.legacySeeded = legacySeeded; }
}
