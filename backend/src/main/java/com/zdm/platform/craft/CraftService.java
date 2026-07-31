package com.zdm.platform.craft;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.zdm.platform.security.CurrentIdentity;
import com.zdm.platform.security.CurrentIdentityProvider;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

@Service
public class CraftService extends ServiceImpl<CraftMapper, Craft> {
  private static final String DEFAULT_CREATED_BY_NAME = "韩健";

  private final CurrentIdentityProvider identityProvider;

  public CraftService(CurrentIdentityProvider identityProvider) {
    this.identityProvider = identityProvider;
  }

  public List<Craft> listForCurrentAdmin() {
    CurrentIdentity identity = identityProvider.current().orElse(null);
    if (identity == null) {
      return List.of();
    }
    if (identity.isSuperAdmin() || "all".equals(identity.dataPermission())) {
      return list();
    }
    if (!StringUtils.hasText(identity.displayName())) {
      return List.of();
    }
    return lambdaQuery().eq(Craft::getCreatedByName, identity.displayName()).list();
  }

  @Transactional
  public Craft createCraft(Craft craft) {
    craft.setId(null);
    craft.setCreatedByName(resolveCreatedByName());
    save(craft);
    return craft;
  }

  @Transactional
  public Craft updateCraft(Long id, Craft payload) {
    Craft existing = getById(id);
    if (existing == null) {
      return null;
    }

    payload.setId(id);
    payload.setCreatedByName(existing.getCreatedByName());
    updateById(payload);
    return getById(id);
  }

  private String resolveCreatedByName() {
    CurrentIdentity identity = identityProvider.current().orElse(null);
    return identity != null && StringUtils.hasText(identity.displayName())
        ? identity.displayName()
        : DEFAULT_CREATED_BY_NAME;
  }
}
