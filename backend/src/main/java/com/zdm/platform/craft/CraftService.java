package com.zdm.platform.craft;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.zdm.platform.security.CurrentIdentity;
import com.zdm.platform.security.CurrentIdentityProvider;
import com.zdm.platform.security.CreatorOwnershipGuard;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

@Service
public class CraftService extends ServiceImpl<CraftMapper, Craft> {
  private static final String DEFAULT_CREATED_BY_NAME = "韩健";

  private final CurrentIdentityProvider identityProvider;
  private final CreatorOwnershipGuard ownershipGuard;

  public CraftService(
      CurrentIdentityProvider identityProvider,
      CreatorOwnershipGuard ownershipGuard) {
    this.identityProvider = identityProvider;
    this.ownershipGuard = ownershipGuard;
  }

  @Transactional
  public Craft createCraft(Craft craft) {
    craft.setId(null);
    craft.setCreatedByName(resolveCreatedByName());
    craft.setCreatedByAccountId(ownershipGuard.currentAccountId());
    save(craft);
    return craft;
  }

  @Transactional
  public Craft updateCraft(Long id, Craft payload) {
    Craft existing = getById(id);
    if (existing == null) {
      return null;
    }
    ownershipGuard.requireCreator(existing.getCreatedByAccountId(), existing.getCreatedByName());

    payload.setId(id);
    payload.setCreatedByName(existing.getCreatedByName());
    payload.setCreatedByAccountId(existing.getCreatedByAccountId());
    updateById(payload);
    return getById(id);
  }

  @Transactional
  public Craft updateStatus(Long id, String status) {
    Craft existing = getById(id);
    if (existing == null) {
      return null;
    }
    ownershipGuard.requireCreator(existing.getCreatedByAccountId(), existing.getCreatedByName());
    existing.setStatus(status);
    updateById(existing);
    return getById(id);
  }

  @Transactional
  public boolean deleteCraft(Long id) {
    Craft existing = getById(id);
    if (existing == null) {
      return false;
    }
    ownershipGuard.requireCreator(existing.getCreatedByAccountId(), existing.getCreatedByName());
    return removeById(id);
  }

  private String resolveCreatedByName() {
    CurrentIdentity identity = identityProvider.current().orElse(null);
    return identity != null && StringUtils.hasText(identity.displayName())
        ? identity.displayName()
        : DEFAULT_CREATED_BY_NAME;
  }
}
