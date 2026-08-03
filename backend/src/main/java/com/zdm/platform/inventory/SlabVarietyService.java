package com.zdm.platform.inventory;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class SlabVarietyService extends ServiceImpl<SlabVarietyMapper, SlabVariety> {
  private static final String REFERENCED_MESSAGE =
      "该品种已被大板库存引用，不能删除，请先停用该品种";

  private final SlabInventoryMapper slabInventoryMapper;

  public SlabVarietyService(SlabInventoryMapper slabInventoryMapper) {
    this.slabInventoryMapper = slabInventoryMapper;
  }

  @Transactional
  public SlabVariety updateVariety(Long id, SlabVariety payload) {
    SlabVariety existing = getById(id);
    if (existing == null) {
      return null;
    }

    payload.setId(id);
    payload.setStatus(existing.getStatus());
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
}
