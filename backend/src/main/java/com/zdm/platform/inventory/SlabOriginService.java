package com.zdm.platform.inventory;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.zdm.platform.security.CurrentIdentity;
import com.zdm.platform.security.CurrentIdentityProvider;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

@Service
public class SlabOriginService extends ServiceImpl<SlabOriginMapper, SlabOrigin> {
  private static final String DEFAULT_CREATED_BY_NAME = "韩健";
  private static final String DUPLICATE_NAME_MESSAGE = "产地名称已存在";
  private static final String REFERENCED_MESSAGE =
      "该产地已被大板库存引用，不能删除，请先停用该产地";

  private final SlabInventoryMapper slabInventoryMapper;
  private final CurrentIdentityProvider identityProvider;

  public SlabOriginService(
      SlabInventoryMapper slabInventoryMapper,
      CurrentIdentityProvider identityProvider) {
    this.slabInventoryMapper = slabInventoryMapper;
    this.identityProvider = identityProvider;
  }

  @Transactional
  public SlabOrigin createOrigin(SlabOrigin origin) {
    origin.setId(null);
    normalizeAndValidateName(origin, null);
    origin.setCreatedByName(resolveCreatedByName());
    origin.setCreatedByAccountId(identityProvider.require().accountId());
    save(origin);
    return origin;
  }

  @Transactional
  public SlabOrigin updateOrigin(Long id, SlabOrigin payload) {
    SlabOrigin existing = getById(id);
    if (existing == null) {
      return null;
    }
    payload.setId(id);
    payload.setStatus(existing.getStatus());
    payload.setCreatedByName(existing.getCreatedByName());
    payload.setCreatedByAccountId(existing.getCreatedByAccountId());
    normalizeAndValidateName(payload, id);
    updateById(payload);
    return getById(id);
  }

  @Transactional
  public SlabOrigin updateStatus(Long id, String status) {
    SlabOrigin existing = getById(id);
    if (existing == null) {
      return null;
    }
    existing.setStatus(status);
    updateById(existing);
    return getById(id);
  }

  @Transactional
  public boolean deleteOrigin(Long id) {
    SlabOrigin existing = getById(id);
    if (existing == null) {
      return false;
    }
    Long referenceCount = slabInventoryMapper.selectCount(
        Wrappers.<SlabInventory>lambdaQuery().eq(SlabInventory::getOriginId, id));
    if (referenceCount > 0) {
      throw new IllegalArgumentException(REFERENCED_MESSAGE);
    }
    try {
      return removeById(id);
    } catch (DataIntegrityViolationException exception) {
      throw new IllegalArgumentException(REFERENCED_MESSAGE, exception);
    }
  }

  private String resolveCreatedByName() {
    CurrentIdentity identity = identityProvider.current().orElse(null);
    return identity != null && StringUtils.hasText(identity.displayName())
        ? identity.displayName()
        : DEFAULT_CREATED_BY_NAME;
  }

  private void normalizeAndValidateName(SlabOrigin origin, Long excludedOriginId) {
    String originName = origin.getName().trim();
    origin.setName(originName);
    var duplicateQuery = lambdaQuery().eq(SlabOrigin::getName, originName);
    if (excludedOriginId != null) {
      duplicateQuery.ne(SlabOrigin::getId, excludedOriginId);
    }
    if (duplicateQuery.count() > 0) {
      throw new IllegalArgumentException(DUPLICATE_NAME_MESSAGE);
    }
  }
}
