package com.zdm.platform.supplier;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.zdm.platform.security.CurrentIdentity;
import com.zdm.platform.security.CurrentIdentityProvider;
import java.util.List;
import java.util.UUID;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

@Service
public class SupplierSupplyTypeService {
  private static final String DUPLICATE_NAME_MESSAGE = "供货类型名称已存在";

  private final SupplierSupplyTypeMapper mapper;
  private final CurrentIdentityProvider identityProvider;

  public SupplierSupplyTypeService(
      SupplierSupplyTypeMapper mapper,
      CurrentIdentityProvider identityProvider) {
    this.mapper = mapper;
    this.identityProvider = identityProvider;
  }

  public List<SupplierSupplyType> listTypes() {
    SupplierScope.from(identityProvider.require());
    List<SupplierSupplyType> types = mapper.selectList(Wrappers.<SupplierSupplyType>lambdaQuery()
        .orderByDesc(SupplierSupplyType::getCreatedAt)
        .orderByDesc(SupplierSupplyType::getId));
    types.forEach(type -> type.setReferenced(mapper.countSupplierReferences(type.getId()) > 0));
    return types;
  }

  @Transactional
  public SupplierSupplyType createType(SupplierSupplyType type) {
    CurrentIdentity identity = requirePlatformScope();
    type.setId(null);
    type.setCode("custom_" + UUID.randomUUID().toString().replace("-", ""));
    type.setName(normalizedName(type.getName()));
    type.setStatus("enabled");
    type.setCreatedByName(identity.displayName());
    type.setCreatedByAccountId(identity.accountId());
    validateUniqueName(type.getName(), null);
    try {
      mapper.insert(type);
    } catch (DuplicateKeyException exception) {
      throw new IllegalArgumentException(DUPLICATE_NAME_MESSAGE, exception);
    }
    return requireType(type.getId());
  }

  @Transactional
  public SupplierSupplyType updateType(Long id, SupplierSupplyType payload) {
    requirePlatformScope();
    SupplierSupplyType existing = requireType(id);
    payload.setId(id);
    payload.setCode(existing.getCode());
    payload.setName(normalizedName(payload.getName()));
    payload.setStatus(existing.getStatus());
    payload.setCreatedByName(existing.getCreatedByName());
    payload.setCreatedByAccountId(existing.getCreatedByAccountId());
    validateUniqueName(payload.getName(), id);
    try {
      mapper.updateById(payload);
    } catch (DuplicateKeyException exception) {
      throw new IllegalArgumentException(DUPLICATE_NAME_MESSAGE, exception);
    }
    return requireType(id);
  }

  @Transactional
  public void deleteType(Long id) {
    requirePlatformScope();
    SupplierSupplyType existing = requireType(id);
    if (mapper.countSupplierReferences(id) > 0) {
      throw new IllegalArgumentException("供货类型“" + existing.getName() + "”已被供应商使用，无法删除");
    }
    mapper.deleteById(id);
  }

  @Transactional
  public SupplierSupplyType updateStatus(Long id, String status) {
    requirePlatformScope();
    SupplierSupplyType existing = requireType(id);
    existing.setStatus(status);
    mapper.updateById(existing);
    return requireType(id);
  }

  private SupplierSupplyType requireType(Long id) {
    SupplierSupplyType type = mapper.selectById(id);
    if (type == null) {
      throw new IllegalArgumentException("供货类型不存在");
    }
    type.setReferenced(mapper.countSupplierReferences(id) > 0);
    return type;
  }

  private CurrentIdentity requirePlatformScope() {
    CurrentIdentity identity = identityProvider.require();
    SupplierScope scope = SupplierScope.from(identity);
    if (!"platform".equals(scope.ownerScope())) {
      throw new AccessDeniedException("仅运营平台可以配置供货类型");
    }
    return identity;
  }

  private void validateUniqueName(String name, Long excludedId) {
    var query = Wrappers.<SupplierSupplyType>lambdaQuery().eq(SupplierSupplyType::getName, name);
    if (excludedId != null) {
      query.ne(SupplierSupplyType::getId, excludedId);
    }
    if (mapper.selectCount(query) > 0) {
      throw new IllegalArgumentException(DUPLICATE_NAME_MESSAGE);
    }
  }

  private String normalizedName(String value) {
    if (!StringUtils.hasText(value)) {
      throw new IllegalArgumentException("请输入供货类型名称");
    }
    return value.trim();
  }
}
