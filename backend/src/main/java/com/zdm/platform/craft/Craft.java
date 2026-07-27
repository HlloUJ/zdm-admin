package com.zdm.platform.craft;

import com.baomidou.mybatisplus.annotation.TableName;
import com.zdm.platform.common.BaseEntity;
import jakarta.validation.constraints.NotBlank;

@TableName("crafts")
public class Craft extends BaseEntity {
  @NotBlank
  private String name;

  @NotBlank
  private String type;

  private String description;
  private String imageUrl;
  private String pricingMethod;

  public String getName() {
    return name;
  }

  public void setName(String name) {
    this.name = name;
  }

  public String getType() {
    return type;
  }

  public void setType(String type) {
    this.type = type;
  }

  public String getDescription() {
    return description;
  }

  public void setDescription(String description) {
    this.description = description;
  }

  public String getImageUrl() {
    return imageUrl;
  }

  public void setImageUrl(String imageUrl) {
    this.imageUrl = imageUrl;
  }

  public String getPricingMethod() {
    return pricingMethod;
  }

  public void setPricingMethod(String pricingMethod) {
    this.pricingMethod = pricingMethod;
  }
}
