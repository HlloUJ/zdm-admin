package com.zdm.platform.tenant;

import jakarta.validation.constraints.NotBlank;

public record TenantPurgeRequest(@NotBlank String confirmationName, java.util.Map<Long, String> storePlans) {
  public TenantPurgeRequest { storePlans = storePlans == null ? java.util.Map.of() : java.util.Map.copyOf(storePlans); }
}
