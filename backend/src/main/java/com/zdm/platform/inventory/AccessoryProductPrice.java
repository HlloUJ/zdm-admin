package com.zdm.platform.inventory;

import com.baomidou.mybatisplus.annotation.TableName;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;

@TableName("accessory_product_prices")
public class AccessoryProductPrice {
  private Long id;
  private Long accessoryProductId;
  private Long skuId;
  private String variantLabel;
  @NotNull private Long storeLevelId;
  private String storeLevelName;
  @NotNull @DecimalMin("0.0000") @Digits(integer = 3, fraction = 4) private BigDecimal priceCoefficient;
  @NotNull @DecimalMin("0.00") private BigDecimal costPrice;
  @NotNull @DecimalMin("0.00") private BigDecimal price;

  private String priceSource;
  private Long sourceConfigurationId;
  public String getPriceSource() { return priceSource; }
  public void setPriceSource(String value) { priceSource = value; }
  public Long getSourceConfigurationId() { return sourceConfigurationId; }
  public void setSourceConfigurationId(Long value) { sourceConfigurationId = value; }

  public Long getId() { return id; }
  public void setId(Long id) { this.id = id; }
  public Long getAccessoryProductId() { return accessoryProductId; }
  public void setAccessoryProductId(Long value) { this.accessoryProductId = value; }
  public Long getSkuId() { return skuId; }
  public void setSkuId(Long value) { this.skuId = value; }
  public String getVariantLabel() { return variantLabel; }
  public void setVariantLabel(String value) { this.variantLabel = value; }
  public Long getStoreLevelId() { return storeLevelId; }
  public void setStoreLevelId(Long value) { this.storeLevelId = value; }
  public String getStoreLevelName() { return storeLevelName; }
  public void setStoreLevelName(String value) { this.storeLevelName = value; }
  public BigDecimal getPriceCoefficient() { return priceCoefficient; }
  public void setPriceCoefficient(BigDecimal value) { this.priceCoefficient = value; }
  public BigDecimal getCostPrice() { return costPrice; }
  public void setCostPrice(BigDecimal value) { this.costPrice = value; }
  public BigDecimal getPrice() { return price; }
  public void setPrice(BigDecimal value) { this.price = value; }
}
