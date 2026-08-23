package com.zdm.platform.inventory;

import com.baomidou.mybatisplus.annotation.TableName;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;

@TableName("finished_product_prices")
public class FinishedProductPrice {
  private Long id;
  private Long finishedProductId;
  private String variantKey;
  private String variantLabel;
  @NotNull private Long markupConfigurationId;
  @NotNull @DecimalMin("0.0000") @Digits(integer = 3, fraction = 4) private BigDecimal markupRate;
  @NotNull @DecimalMin("0.00") private BigDecimal costPrice;
  @NotNull @DecimalMin("0.00") private BigDecimal price;

  public Long getId() { return id; }
  public void setId(Long id) { this.id = id; }
  public Long getFinishedProductId() { return finishedProductId; }
  public void setFinishedProductId(Long value) { this.finishedProductId = value; }
  public String getVariantKey() { return variantKey; }
  public void setVariantKey(String value) { this.variantKey = value; }
  public String getVariantLabel() { return variantLabel; }
  public void setVariantLabel(String value) { this.variantLabel = value; }
  public Long getMarkupConfigurationId() { return markupConfigurationId; }
  public void setMarkupConfigurationId(Long value) { this.markupConfigurationId = value; }
  public BigDecimal getMarkupRate() { return markupRate; }
  public void setMarkupRate(BigDecimal value) { this.markupRate = value; }
  public BigDecimal getCostPrice() { return costPrice; }
  public void setCostPrice(BigDecimal value) { this.costPrice = value; }
  public BigDecimal getPrice() { return price; }
  public void setPrice(BigDecimal value) { this.price = value; }
}
