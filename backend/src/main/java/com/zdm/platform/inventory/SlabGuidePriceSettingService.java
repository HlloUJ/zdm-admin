package com.zdm.platform.inventory;

import com.zdm.platform.security.CurrentIdentity;
import com.zdm.platform.security.CurrentIdentityProvider;
import java.math.BigDecimal;
import java.math.RoundingMode;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class SlabGuidePriceSettingService {
  private static final long SETTING_ID = 1L;
  private final SlabGuidePriceSettingMapper mapper;
  private final CurrentIdentityProvider identityProvider;

  public SlabGuidePriceSettingService(
      SlabGuidePriceSettingMapper mapper,
      CurrentIdentityProvider identityProvider) {
    this.mapper = mapper;
    this.identityProvider = identityProvider;
  }

  public SlabGuidePriceSetting getSetting() {
    requirePlatformScope();
    return mapper.selectById(SETTING_ID);
  }

  @Transactional
  public SlabGuidePriceSetting saveSetting(BigDecimal coefficient) {
    CurrentIdentity identity = requirePlatformScope();
    SlabGuidePriceSetting setting = mapper.selectById(SETTING_ID);
    boolean creating = setting == null;
    if (creating) {
      setting = new SlabGuidePriceSetting();
      setting.setId(SETTING_ID);
    }
    setting.setPriceCoefficient(coefficient.setScale(4, RoundingMode.HALF_UP));
    setting.setUpdatedByName(identity.displayName());
    setting.setUpdatedByAccountId(identity.accountId());
    if (creating) {
      mapper.insert(setting);
    } else {
      mapper.updateById(setting);
    }
    return mapper.selectById(SETTING_ID);
  }

  private CurrentIdentity requirePlatformScope() {
    CurrentIdentity identity = identityProvider.require();
    if (identity.tenantId() != null || identity.storeId() != null) {
      throw new AccessDeniedException("仅运营管理平台可以维护大板指导价设置");
    }
    return identity;
  }
}
