package com.zdm.platform.inventory;

import com.baomidou.mybatisplus.annotation.TableName;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;

@TableName("slab_prices")
public class SlabPrice {
  private Long id;
  private Long slabId;

  @NotNull
  private Long storeLevelId;

  private String storeLevelName;

  @NotNull
  @DecimalMin("0.0000")
  @Digits(integer = 3, fraction = 4)
  private BigDecimal priceCoefficient;

  @NotNull
  @DecimalMin("0.00")
  private BigDecimal costPrice;

  @NotNull
  @DecimalMin("0.00")
  private BigDecimal price;

  public Long getId() { return id; }
  public void setId(Long id) { this.id = id; }
  public Long getSlabId() { return slabId; }
  public void setSlabId(Long slabId) { this.slabId = slabId; }
  public Long getStoreLevelId() { return storeLevelId; }
  public void setStoreLevelId(Long storeLevelId) { this.storeLevelId = storeLevelId; }
  public String getStoreLevelName() { return storeLevelName; }
  public void setStoreLevelName(String storeLevelName) { this.storeLevelName = storeLevelName; }
  public BigDecimal getPriceCoefficient() { return priceCoefficient; }
  public void setPriceCoefficient(BigDecimal priceCoefficient) { this.priceCoefficient = priceCoefficient; }
  public BigDecimal getCostPrice() { return costPrice; }
  public void setCostPrice(BigDecimal costPrice) { this.costPrice = costPrice; }
  public BigDecimal getPrice() { return price; }
  public void setPrice(BigDecimal price) { this.price = price; }
}
