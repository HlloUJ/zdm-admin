package com.zdm.platform.inventory;

import com.baomidou.mybatisplus.annotation.TableName;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;

@TableName("accessory_product_guide_prices")
public class AccessoryProductGuidePrice {
  private Long id;
  private Long accessoryProductId;
  @NotNull private Long skuId;
  private String variantLabel;
  @NotNull @DecimalMin("0.0000") @Digits(integer = 3, fraction = 4) private BigDecimal priceCoefficient;
  @NotNull @DecimalMin("0.00") private BigDecimal costPrice;
  @NotNull @DecimalMin("0.00") private BigDecimal price;

  public Long getId() { return id; }
  public void setId(Long value) { this.id = value; }
  public Long getAccessoryProductId() { return accessoryProductId; }
  public void setAccessoryProductId(Long value) { this.accessoryProductId = value; }
  public Long getSkuId() { return skuId; }
  public void setSkuId(Long value) { this.skuId = value; }
  public String getVariantLabel() { return variantLabel; }
  public void setVariantLabel(String value) { this.variantLabel = value; }
  public BigDecimal getPriceCoefficient() { return priceCoefficient; }
  public void setPriceCoefficient(BigDecimal value) { this.priceCoefficient = value; }
  public BigDecimal getCostPrice() { return costPrice; }
  public void setCostPrice(BigDecimal value) { this.costPrice = value; }
  public BigDecimal getPrice() { return price; }
  public void setPrice(BigDecimal value) { this.price = value; }
}
