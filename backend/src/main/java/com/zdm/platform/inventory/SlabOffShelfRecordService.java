package com.zdm.platform.inventory;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import java.util.List;
import org.springframework.stereotype.Service;

@Service
public class SlabOffShelfRecordService
    extends ServiceImpl<SlabOffShelfRecordMapper, SlabOffShelfRecord> {

  public List<SlabOffShelfRecord> listBySlabIds(List<Long> slabIds) {
    if (slabIds.isEmpty()) {
      return List.of();
    }
    return lambdaQuery()
        .in(SlabOffShelfRecord::getSlabId, slabIds)
        .orderByDesc(SlabOffShelfRecord::getOffShelvedAt)
        .orderByDesc(SlabOffShelfRecord::getId)
        .list();
  }
}
