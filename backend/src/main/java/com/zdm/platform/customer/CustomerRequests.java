package com.zdm.platform.customer;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.LocalDateTime;
import java.util.List;

public final class CustomerRequests {
  private CustomerRequests() {}
  public record Profile(@NotBlank @Size(max = 80) String name,
      @Size(max = 80) String phone, @Size(max = 100) String wechat,
      @Size(max = 100) String requirement, @Size(max = 100) String remark,
      @NotNull Long ownerAccountId, @Size(max = 2) String nationality, @Size(max = 2) String phoneRegion) {}
  public record Action(@NotNull @Size(min = 1, max = 200) List<@NotNull Long> ids,
      @NotNull @Pattern(regexp = "daily|archived") String status,
      @NotNull @Pattern(regexp = "assign|archive|restore|purge") String action,
      Long ownerAccountId) {
    public Action { ids = ids == null ? null : java.util.Collections.unmodifiableList(new java.util.ArrayList<>(ids)); }
  }
  public record Followup(@NotNull LocalDateTime followedAt,
      @NotBlank @Size(max = 10000) String content, LocalDateTime nextFollowAt,
      @Size(max = 2000) String nextFollowTask, @NotNull @Size(max = 3) List<@NotNull Long> mediaIds) {
    public Followup { mediaIds = mediaIds == null ? null : java.util.Collections.unmodifiableList(new java.util.ArrayList<>(mediaIds)); }
  }
}
