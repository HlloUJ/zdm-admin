package com.zdm.platform.inventory;

import com.zdm.platform.security.CurrentIdentity;
import com.zdm.platform.security.CurrentIdentityProvider;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Component;

/** Resolves the current city-partner store without trusting a request parameter. */
@Component
public class CityPartnerStoreScope {
  public record Store(Long tenantId, Long storeId, Long storeLevelId, Long accountId, String operatorName) {}

  private final CurrentIdentityProvider identities;
  private final JdbcTemplate jdbc;

  public CityPartnerStoreScope(CurrentIdentityProvider identities, JdbcTemplate jdbc) {
    this.identities = identities;
    this.jdbc = jdbc;
  }

  public Store require() {
    CurrentIdentity identity = identities.require();
    if (identity.storeId() == null || identity.tenantId() == null || "supply-chain".equals(identity.clientCode())) {
      throw new AccessDeniedException("请先切换到城市合伙人门店身份");
    }
    var stores = jdbc.query("""
        SELECT store_level_id FROM stores
        WHERE id = ? AND tenant_id = ? AND type = 'cityPartner' AND status = 'enabled'
        """, (row, index) -> row.getObject("store_level_id", Long.class),
        identity.storeId(), identity.tenantId());
    if (stores.isEmpty()) {
      throw new AccessDeniedException("当前身份不属于可用的城市合伙人门店");
    }
    return new Store(identity.tenantId(), identity.storeId(), stores.getFirst(),
        identity.accountId(), identity.displayName());
  }
}
