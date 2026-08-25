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
public class SlabVarietyService extends ServiceImpl<SlabVarietyMapper, SlabVariety> {
  private static final String DEFAULT_CREATED_BY_NAME = "韩健";
  private static final String DUPLICATE_NAME_MESSAGE = "品种名称已存在";
  private static final String REFERENCED_MESSAGE =
      "该品种已被大板库存引用，不能删除，请先停用该品种";

  private final SlabInventoryMapper slabInventoryMapper;
  private final CurrentIdentityProvider identityProvider;

  public SlabVarietyService(
      SlabInventoryMapper slabInventoryMapper,
      CurrentIdentityProvider identityProvider) {
    this.slabInventoryMapper = slabInventoryMapper;
    this.identityProvider = identityProvider;
  }

  @Transactional
  public SlabVariety createVariety(SlabVariety variety) {
    variety.setId(null);
    normalizeAndValidateName(variety, null);
    variety.setCreatedByName(resolveCreatedByName());
    variety.setCreatedByAccountId(identityProvider.require().accountId());
    save(variety);
    return variety;
  }

  @Transactional
  public SlabVariety updateVariety(Long id, SlabVariety payload) {
    SlabVariety existing = getById(id);
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
  public SlabVariety updateStatus(Long id, String status) {
    SlabVariety existing = getById(id);
    if (existing == null) {
      return null;
    }

    existing.setStatus(status);
    updateById(existing);
    return getById(id);
  }

  @Transactional
  public boolean deleteVariety(Long id) {
    SlabVariety existing = getById(id);
    if (existing == null) {
      return false;
    }
    Long referenceCount = slabInventoryMapper.selectCount(
        Wrappers.<SlabInventory>lambdaQuery().eq(SlabInventory::getVarietyId, id));
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

  private void normalizeAndValidateName(SlabVariety variety, Long excludedVarietyId) {
    String varietyName = variety.getName().trim();
    variety.setName(varietyName);
    var duplicateQuery = lambdaQuery().eq(SlabVariety::getName, varietyName);
    if (excludedVarietyId != null) {
      duplicateQuery.ne(SlabVariety::getId, excludedVarietyId);
    }
    if (duplicateQuery.count() > 0) {
      throw new IllegalArgumentException(DUPLICATE_NAME_MESSAGE);
    }
  }
}
