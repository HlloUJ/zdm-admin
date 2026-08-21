package com.zdm.platform.role;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;

@TableName("terminal_function_policies")
public class TerminalFunctionPolicy {
  @TableId(type = IdType.AUTO)
  private Long id;
  private String terminal;
  private String functionPermissions;
  private LocalDateTime createdAt;
  private LocalDateTime updatedAt;

  public Long getId() {
    return id;
  }

  public void setId(Long id) {
    this.id = id;
  }

  public String getTerminal() {
    return terminal;
  }

  public void setTerminal(String terminal) {
    this.terminal = terminal;
  }

  public String getFunctionPermissions() {
    return functionPermissions;
  }

  public void setFunctionPermissions(String functionPermissions) {
    this.functionPermissions = functionPermissions;
  }

  public LocalDateTime getCreatedAt() {
    return createdAt;
  }

  public void setCreatedAt(LocalDateTime createdAt) {
    this.createdAt = createdAt;
  }

  public LocalDateTime getUpdatedAt() {
    return updatedAt;
  }

  public void setUpdatedAt(LocalDateTime updatedAt) {
    this.updatedAt = updatedAt;
  }
}
