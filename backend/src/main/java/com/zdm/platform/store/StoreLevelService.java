package com.zdm.platform.store;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.zdm.platform.security.CurrentIdentity;
import com.zdm.platform.security.CurrentIdentityProvider;
import com.zdm.platform.security.CreatorOwnershipGuard;
import java.util.List;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

@Service
public class StoreLevelService extends ServiceImpl<StoreLevelMapper, StoreLevel> {
  private static final String DEFAULT_CREATED_BY_NAME = "韩健";
  private static final String REFERENCED_MESSAGE = "该店铺级别已被门店引用，不能删除，请先停用该店铺级别";

  private final StoreMapper storeMapper;
  private final CurrentIdentityProvider identityProvider;
  private final CreatorOwnershipGuard ownershipGuard;

  public StoreLevelService(
      StoreMapper storeMapper,
      CurrentIdentityProvider identityProvider,
      CreatorOwnershipGuard ownershipGuard) {
    this.storeMapper = storeMapper;
    this.identityProvider = identityProvider;
    this.ownershipGuard = ownershipGuard;
  }

  public List<StoreLevel> listEnabled() {
    return lambdaQuery().eq(StoreLevel::getStatus, "enabled").orderByAsc(StoreLevel::getId).list();
  }

  @Transactional
  public StoreLevel createLevel(StoreLevel level) {
    level.setId(null);
    normalizeAndValidate(level, null);
    level.setStatus("enabled");
    level.setCreatedByName(resolveCreatedByName());
    level.setCreatedByAccountId(ownershipGuard.currentAccountId());
    save(level);
    return level;
  }

  @Transactional
  public StoreLevel updateLevel(Long id, StoreLevel payload) {
    StoreLevel existing = getById(id);
    if (existing == null) {
      return null;
    }
    requireAccessible(existing);
    payload.setId(id);
    payload.setStatus(existing.getStatus());
    payload.setCreatedByName(existing.getCreatedByName());
    payload.setCreatedByAccountId(existing.getCreatedByAccountId());
    normalizeAndValidate(payload, id);
    updateById(payload);
    return getById(id);
  }

  @Transactional
  public StoreLevel updateStatus(Long id, String status) {
    StoreLevel existing = getById(id);
    if (existing == null) {
      return null;
    }
    requireAccessible(existing);
    existing.setStatus(status);
    updateById(existing);
    return getById(id);
  }

  @Transactional
  public boolean deleteLevel(Long id) {
    StoreLevel existing = getById(id);
    if (existing == null) {
      return false;
    }
    requireAccessible(existing);
    Long referenceCount = storeMapper.selectCount(
        Wrappers.<Store>lambdaQuery().eq(Store::getStoreLevelId, id));
    if (referenceCount > 0) {
      throw new IllegalArgumentException(REFERENCED_MESSAGE);
    }
    try {
      return removeById(id);
    } catch (DataIntegrityViolationException exception) {
      throw new IllegalArgumentException(REFERENCED_MESSAGE, exception);
    }
  }

  public void requireSelectable(Long id) {
    StoreLevel level = id == null ? null : getById(id);
    if (level == null) {
      throw new IllegalArgumentException("店铺级别不存在");
    }
    if (!"enabled".equals(level.getStatus())) {
      throw new IllegalArgumentException("店铺级别已停用");
    }
  }

  private String resolveCreatedByName() {
    CurrentIdentity identity = identityProvider.current().orElse(null);
    return identity != null && StringUtils.hasText(identity.displayName())
        ? identity.displayName()
        : DEFAULT_CREATED_BY_NAME;
  }

  private void requireAccessible(StoreLevel level) {
    ownershipGuard.requireCreator(level.getCreatedByAccountId(), level.getCreatedByName());
  }

  private void normalizeAndValidate(StoreLevel level, Long excludedId) {
    String name = level.getName().trim();
    level.setName(name);

    var duplicateName = lambdaQuery().eq(StoreLevel::getName, name);
    if (excludedId != null) {
      duplicateName.ne(StoreLevel::getId, excludedId);
    }
    if (duplicateName.count() > 0) {
      throw new IllegalArgumentException("级别名称已存在");
    }
  }
}
