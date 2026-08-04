package com.zdm.platform.catalog;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import java.util.List;
import org.springframework.stereotype.Service;

@Service
public class ProductAttributeService extends ServiceImpl<ProductAttributeMapper, ProductAttribute> {
  public List<ProductAttribute> listWithTemplateCounts() {
    return baseMapper.selectWithTemplateCounts();
  }
}
