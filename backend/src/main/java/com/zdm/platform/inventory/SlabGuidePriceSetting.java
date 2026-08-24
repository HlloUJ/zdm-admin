package com.zdm.platform.inventory;

import com.baomidou.mybatisplus.annotation.TableName;
import java.math.BigDecimal;
import java.time.LocalDateTime;

@TableName("slab_guide_price_settings")
public class SlabGuidePriceSetting {
  private Long id;
  private BigDecimal priceCoefficient;
  private String updatedByName;
  private Long updatedByAccountId;
  private LocalDateTime createdAt;
  private LocalDateTime updatedAt;

  public Long getId() { return id; }
  public void setId(Long id) { this.id = id; }
  public BigDecimal getPriceCoefficient() { return priceCoefficient; }
  public void setPriceCoefficient(BigDecimal value) { this.priceCoefficient = value; }
  public String getUpdatedByName() { return updatedByName; }
  public void setUpdatedByName(String value) { this.updatedByName = value; }
  public Long getUpdatedByAccountId() { return updatedByAccountId; }
  public void setUpdatedByAccountId(Long value) { this.updatedByAccountId = value; }
  public LocalDateTime getCreatedAt() { return createdAt; }
  public void setCreatedAt(LocalDateTime value) { this.createdAt = value; }
  public LocalDateTime getUpdatedAt() { return updatedAt; }
  public void setUpdatedAt(LocalDateTime value) { this.updatedAt = value; }
}
