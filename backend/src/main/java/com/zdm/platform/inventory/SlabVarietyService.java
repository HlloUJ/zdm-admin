package com.zdm.platform.inventory;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import java.util.List;
import java.util.stream.Collectors;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class SlabVarietyService extends ServiceImpl<SlabVarietyMapper, SlabVariety> {
  private static final String DEFAULT_REFERENCED_MESSAGE =
      "该品种已被大板库存引用，不能删除，请先停用该品种";

  private final SlabInventoryMapper slabInventoryMapper;

  public SlabVarietyService(SlabInventoryMapper slabInventoryMapper) {
    this.slabInventoryMapper = slabInventoryMapper;
  }

  @Transactional
  public boolean deleteVariety(Long id) {
    Long referenceCount = slabInventoryMapper.selectCount(
        Wrappers.<SlabInventory>lambdaQuery().eq(SlabInventory::getVarietyId, id));
    if (referenceCount > 0) {
      List<SlabInventory> references = slabInventoryMapper.selectList(
          Wrappers.<SlabInventory>lambdaQuery()
              .select(SlabInventory::getName, SlabInventory::getSerialNo)
              .eq(SlabInventory::getVarietyId, id)
              .last("LIMIT 3"));
      throw new IllegalArgumentException(buildReferencedMessage(references, referenceCount));
    }

    try {
      return removeById(id);
    } catch (DataIntegrityViolationException exception) {
      throw new IllegalArgumentException(DEFAULT_REFERENCED_MESSAGE, exception);
    }
  }

  private String buildReferencedMessage(List<SlabInventory> references, long referenceCount) {
    String slabLabels = references.stream()
        .limit(3)
        .map(slab -> slab.getName() + "（" + slab.getSerialNo() + "）")
        .collect(Collectors.joining("、"));
    String remainingCount = referenceCount > 3
        ? "等" + referenceCount + "块大板"
        : "";
    return "该品种已被大板【" + slabLabels + remainingCount + "】引用，不能删除，请先停用该品种";
  }
}
