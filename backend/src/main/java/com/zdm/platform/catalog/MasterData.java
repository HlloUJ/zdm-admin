package com.zdm.platform.catalog;

import com.baomidou.mybatisplus.annotation.TableName;
import com.zdm.platform.common.BaseEntity;
import jakarta.validation.constraints.NotBlank;

@TableName("master_data")
public class MasterData extends BaseEntity {
  @NotBlank
  private String dataType;

  @NotBlank
  private String name;

  @NotBlank
  private String code;

  private String extra;

  public String getDataType() {
    return dataType;
  }

  public void setDataType(String dataType) {
    this.dataType = dataType;
  }

  public String getName() {
    return name;
  }

  public void setName(String name) {
    this.name = name;
  }

  public String getCode() {
    return code;
  }

  public void setCode(String code) {
    this.code = code;
  }

  public String getExtra() {
    return extra;
  }

  public void setExtra(String extra) {
    this.extra = extra;
  }
}
