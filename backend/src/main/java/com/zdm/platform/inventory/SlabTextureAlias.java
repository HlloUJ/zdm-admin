package com.zdm.platform.inventory;

import com.baomidou.mybatisplus.annotation.TableName;
import com.zdm.platform.common.BaseEntity;
import jakarta.validation.constraints.NotBlank;

@TableName("slab_texture_aliases")
public class SlabTextureAlias extends BaseEntity {
  private Long textureId;
  @NotBlank
  private String name;

  public Long getTextureId() { return textureId; }
  public void setTextureId(Long textureId) { this.textureId = textureId; }
  public String getName() { return name; }
  public void setName(String name) { this.name = name; }
}
