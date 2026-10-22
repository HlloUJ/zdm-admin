package com.zdm.platform.inventory;

import com.zdm.platform.security.CurrentIdentity;
import com.zdm.platform.security.CurrentIdentityProvider;
import java.math.BigDecimal;
import java.math.RoundingMode;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AccessoryGuidePriceSettingService {
  private static final long SETTING_ID = 1L;
  private final AccessoryGuidePriceSettingMapper mapper;
  private final CurrentIdentityProvider identityProvider;

  public AccessoryGuidePriceSettingService(
      AccessoryGuidePriceSettingMapper mapper,
      CurrentIdentityProvider identityProvider) {
    this.mapper = mapper;
    this.identityProvider = identityProvider;
  }

  public AccessoryGuidePriceSetting getSetting() {
    requirePlatformScope();
    AccessoryGuidePriceSetting result = mapper.selectById(SETTING_ID);
    if (result != null && !com.zdm.platform.security.DataScope.canAccess(identityProvider.require(), result.getCreatedByAccountId())) { return null; }
    return result;
  }

  @Transactional
  public AccessoryGuidePriceSetting saveSetting(BigDecimal coefficient) {
    CurrentIdentity identity = requirePlatformScope();
    AccessoryGuidePriceSetting setting = mapper.selectById(SETTING_ID);
    boolean creating = setting == null;
    if (creating) {
      setting = new AccessoryGuidePriceSetting();
      setting.setId(SETTING_ID);
      setting.setCreatedByAccountId(identity.accountId());
    }
    com.zdm.platform.security.DataScope.requireAccess(identity, setting.getCreatedByAccountId());
    setting.setPriceCoefficient(coefficient.setScale(4, RoundingMode.HALF_UP));
    setting.setUpdatedByName(identity.displayName());
    setting.setUpdatedByAccountId(identity.accountId());
    if (creating) {
      mapper.insert(setting);
    } else {
      mapper.updateById(setting);
    }
    AccessoryGuidePriceSetting result = mapper.selectById(SETTING_ID);
    if (result != null && !com.zdm.platform.security.DataScope.canAccess(identityProvider.require(), result.getCreatedByAccountId())) { return null; }
    return result;
  }

  private CurrentIdentity requirePlatformScope() {
    CurrentIdentity identity = identityProvider.require();
    if (identity.tenantId() != null || identity.storeId() != null) {
      throw new AccessDeniedException("仅运营管理平台可以维护配件指导价设置");
    }
    return identity;
  }
}
