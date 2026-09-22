package com.zdm.platform.inventory;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import java.util.List;
import org.springframework.stereotype.Service;

@Service
public class SlabOffShelfRecordService
    extends ServiceImpl<SlabOffShelfRecordMapper, SlabOffShelfRecord> {

  private final com.zdm.platform.security.CurrentIdentityProvider identities;
  public SlabOffShelfRecordService(com.zdm.platform.security.CurrentIdentityProvider identities) { this.identities=identities; }
  public List<SlabOffShelfRecord> listSourceBySlabId(Long id) {
    return lambdaQuery().eq(SlabOffShelfRecord::getBusinessClientCode, "supply-chain")
        .eq(SlabOffShelfRecord::getSlabId, id)
        .orderByDesc(SlabOffShelfRecord::getOffShelvedAt)
        .orderByDesc(SlabOffShelfRecord::getId).list();
  }

  public List<SlabOffShelfRecord> listBySlabIds(List<Long> slabIds) {
    if (slabIds.isEmpty()) {
      return List.of();
    }
    return lambdaQuery()
        .eq(SlabOffShelfRecord::getBusinessClientCode, identities.require().clientCode())
        .in(SlabOffShelfRecord::getSlabId, slabIds)
        .orderByDesc(SlabOffShelfRecord::getOffShelvedAt)
        .orderByDesc(SlabOffShelfRecord::getId)
        .list();
  }
}
