package com.zdm.platform.inventory;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.zdm.platform.security.CurrentIdentity;
import com.zdm.platform.security.CurrentIdentityProvider;
import com.zdm.platform.security.CreatorOwnershipGuard;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

@Service
public class MarkupConfigurationService {
  private static final String DUPLICATE_NAME_MESSAGE = "当前商品类型下的加价名称已存在";

  private final MarkupConfigurationMapper mapper;
  private final CurrentIdentityProvider identityProvider;
  private final CreatorOwnershipGuard ownershipGuard;

  public MarkupConfigurationService(
      MarkupConfigurationMapper mapper,
      CurrentIdentityProvider identityProvider,
      CreatorOwnershipGuard ownershipGuard) {
    this.mapper = mapper;
    this.identityProvider = identityProvider;
    this.ownershipGuard = ownershipGuard;
  }

  public List<MarkupConfiguration> listConfigurations(String productType, boolean enabledOnly) {
    requirePlatformScope();
    String normalizedType = MarkupProductType.require(productType).value();
    var query = Wrappers.<MarkupConfiguration>lambdaQuery()
        .eq(MarkupConfiguration::getProductType, normalizedType);
    if (enabledOnly) {
      query.eq(MarkupConfiguration::getStatus, "enabled");
    }
    List<MarkupConfiguration> configurations = mapper.selectList(query
        .orderByAsc(MarkupConfiguration::getSortOrder)
        .orderByDesc(MarkupConfiguration::getCreatedAt)
        .orderByDesc(MarkupConfiguration::getId));
    configurations.forEach(item -> item.setReferenced(mapper.countProductReferences(item.getId()) > 0));
    return configurations;
  }

  @Transactional
  public MarkupConfiguration createConfiguration(MarkupConfiguration payload) {
    CurrentIdentity identity = requirePlatformScope();
    payload.setId(null);
    payload.setProductType(MarkupProductType.require(payload.getProductType()).value());
    payload.setName(normalizedName(payload.getName()));
    payload.setStatus("enabled");
    payload.setSortOrder(nextSortOrder(payload.getProductType()));
    payload.setCreatedByName(identity.displayName());
    payload.setCreatedByAccountId(identity.accountId());
    validateUniqueName(payload.getProductType(), payload.getName(), null);
    try {
      mapper.insert(payload);
    } catch (DuplicateKeyException exception) {
      throw new IllegalArgumentException(DUPLICATE_NAME_MESSAGE, exception);
    }
    return requireConfiguration(payload.getId(), payload.getProductType());
  }

  @Transactional
  public MarkupConfiguration updateConfiguration(
      Long id,
      String productType,
      MarkupConfiguration payload) {
    requirePlatformScope();
    String normalizedType = MarkupProductType.require(productType).value();
    MarkupConfiguration existing = requireConfiguration(id, normalizedType);
    ownershipGuard.requireCreator(existing.getCreatedByAccountId(), existing.getCreatedByName());
    payload.setId(id);
    payload.setProductType(normalizedType);
    payload.setName(normalizedName(payload.getName()));
    payload.setStatus(existing.getStatus());
    payload.setSortOrder(existing.getSortOrder());
    payload.setCreatedByName(existing.getCreatedByName());
    payload.setCreatedByAccountId(existing.getCreatedByAccountId());
    validateUniqueName(normalizedType, payload.getName(), id);
    try {
      mapper.updateById(payload);
    } catch (DuplicateKeyException exception) {
      throw new IllegalArgumentException(DUPLICATE_NAME_MESSAGE, exception);
    }
    return requireConfiguration(id, normalizedType);
  }

  @Transactional
  public MarkupConfiguration updateStatus(Long id, String productType, String status) {
    requirePlatformScope();
    MarkupConfiguration existing = requireConfiguration(id, MarkupProductType.require(productType).value());
    ownershipGuard.requireCreator(existing.getCreatedByAccountId(), existing.getCreatedByName());
    existing.setStatus(status);
    mapper.updateById(existing);
    return requireConfiguration(id, existing.getProductType());
  }

  @Transactional
  public List<MarkupConfiguration> reorderConfigurations(String productType, List<Long> orderedIds) {
    requirePlatformScope();
    String normalizedType = MarkupProductType.require(productType).value();
    List<MarkupConfiguration> configurations = mapper.selectList(
        Wrappers.<MarkupConfiguration>lambdaQuery()
            .eq(MarkupConfiguration::getProductType, normalizedType));
    if (orderedIds == null
        || orderedIds.size() != configurations.size()
        || new HashSet<>(orderedIds).size() != configurations.size()) {
      throw new IllegalArgumentException("请提交当前商品类型的全部加价配置");
    }
    Map<Long, MarkupConfiguration> configurationsById = configurations.stream()
        .collect(Collectors.toMap(MarkupConfiguration::getId, Function.identity()));
    if (!configurationsById.keySet().equals(new HashSet<>(orderedIds))) {
      throw new IllegalArgumentException("加价配置顺序与当前数据不一致");
    }
    configurations.forEach(item ->
        ownershipGuard.requireCreator(item.getCreatedByAccountId(), item.getCreatedByName()));
    for (int index = 0; index < orderedIds.size(); index += 1) {
      MarkupConfiguration configuration = configurationsById.get(orderedIds.get(index));
      configuration.setSortOrder(index + 1);
      mapper.updateById(configuration);
    }
    return listConfigurations(normalizedType, false);
  }

  @Transactional
  public void deleteConfiguration(Long id, String productType) {
    requirePlatformScope();
    MarkupConfiguration existing = requireConfiguration(id, MarkupProductType.require(productType).value());
    ownershipGuard.requireCreator(existing.getCreatedByAccountId(), existing.getCreatedByName());
    if (mapper.countProductReferences(id) > 0) {
      throw new IllegalArgumentException("加价配置“" + existing.getName() + "”已被商品使用，只能停用");
    }
    mapper.deleteById(id);
  }

  public MarkupConfiguration requireConfiguration(Long id, String productType) {
    MarkupConfiguration configuration = mapper.selectOne(Wrappers.<MarkupConfiguration>lambdaQuery()
        .eq(MarkupConfiguration::getId, id)
        .eq(MarkupConfiguration::getProductType, MarkupProductType.require(productType).value()));
    if (configuration == null) {
      throw new IllegalArgumentException("加价配置不存在");
    }
    configuration.setReferenced(mapper.countProductReferences(id) > 0);
    return configuration;
  }

  private CurrentIdentity requirePlatformScope() {
    CurrentIdentity identity = identityProvider.require();
    if (identity.tenantId() != null || identity.storeId() != null) {
      throw new AccessDeniedException("仅运营管理平台可以维护加价配置");
    }
    return identity;
  }

  private void validateUniqueName(String productType, String name, Long excludedId) {
    var query = Wrappers.<MarkupConfiguration>lambdaQuery()
        .eq(MarkupConfiguration::getProductType, productType)
        .eq(MarkupConfiguration::getName, name);
    if (excludedId != null) {
      query.ne(MarkupConfiguration::getId, excludedId);
    }
    if (mapper.selectCount(query) > 0) {
      throw new IllegalArgumentException(DUPLICATE_NAME_MESSAGE);
    }
  }

  private int nextSortOrder(String productType) {
    MarkupConfiguration lastConfiguration = mapper.selectOne(
        Wrappers.<MarkupConfiguration>lambdaQuery()
            .eq(MarkupConfiguration::getProductType, productType)
            .orderByDesc(MarkupConfiguration::getSortOrder)
            .last("LIMIT 1"));
    return lastConfiguration == null || lastConfiguration.getSortOrder() == null
        ? 1
        : lastConfiguration.getSortOrder() + 1;
  }

  private String normalizedName(String value) {
    if (!StringUtils.hasText(value)) {
      throw new IllegalArgumentException("请输入加价名称");
    }
    String name = value.trim();
    if (name.length() > 20) {
      throw new IllegalArgumentException("加价名称最多20个字");
    }
    return name;
  }
}
