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
public class SlabMarkupConfigurationService {
  private static final String DUPLICATE_NAME_MESSAGE = "大板价格层级名称已存在";

  private final SlabMarkupConfigurationMapper mapper;
  private final CurrentIdentityProvider identityProvider;
  private final CreatorOwnershipGuard ownershipGuard;

  public SlabMarkupConfigurationService(
      SlabMarkupConfigurationMapper mapper,
      CurrentIdentityProvider identityProvider,
      CreatorOwnershipGuard ownershipGuard) {
    this.mapper = mapper;
    this.identityProvider = identityProvider;
    this.ownershipGuard = ownershipGuard;
  }

  public List<SlabMarkupConfiguration> listConfigurations(boolean enabledOnly) {
    requirePlatformScope();
    var query = Wrappers.<SlabMarkupConfiguration>lambdaQuery();
    if (enabledOnly) {
      query.eq(SlabMarkupConfiguration::getStatus, "enabled");
    }
    List<SlabMarkupConfiguration> configurations = mapper.selectList(query
        .orderByAsc(SlabMarkupConfiguration::getSortOrder)
        .orderByDesc(SlabMarkupConfiguration::getCreatedAt)
        .orderByDesc(SlabMarkupConfiguration::getId));
    configurations.forEach(item -> item.setReferenced(mapper.countProductReferences(item.getId()) > 0));
    return configurations;
  }

  @Transactional
  public SlabMarkupConfiguration createConfiguration(SlabMarkupConfiguration payload) {
    CurrentIdentity identity = requirePlatformScope();
    payload.setId(null);
    payload.setName(normalizedName(payload.getName()));
    payload.setStatus("enabled");
    payload.setSortOrder(nextSortOrder());
    payload.setCreatedByName(identity.displayName());
    payload.setCreatedByAccountId(identity.accountId());
    validateUniqueName(payload.getName(), null);
    try {
      mapper.insert(payload);
    } catch (DuplicateKeyException exception) {
      throw new IllegalArgumentException(DUPLICATE_NAME_MESSAGE, exception);
    }
    return requireConfiguration(payload.getId());
  }

  @Transactional
  public SlabMarkupConfiguration updateConfiguration(
      Long id,
      SlabMarkupConfiguration payload) {
    requirePlatformScope();
    SlabMarkupConfiguration existing = requireConfiguration(id);
    ownershipGuard.requireCreator(existing.getCreatedByAccountId(), existing.getCreatedByName());
    payload.setId(id);
    payload.setName(normalizedName(payload.getName()));
    payload.setStatus(existing.getStatus());
    payload.setSortOrder(existing.getSortOrder());
    payload.setCreatedByName(existing.getCreatedByName());
    payload.setCreatedByAccountId(existing.getCreatedByAccountId());
    validateUniqueName(payload.getName(), id);
    try {
      mapper.updateById(payload);
    } catch (DuplicateKeyException exception) {
      throw new IllegalArgumentException(DUPLICATE_NAME_MESSAGE, exception);
    }
    return requireConfiguration(id);
  }

  @Transactional
  public SlabMarkupConfiguration updateStatus(Long id, String status) {
    requirePlatformScope();
    SlabMarkupConfiguration existing = requireConfiguration(id);
    ownershipGuard.requireCreator(existing.getCreatedByAccountId(), existing.getCreatedByName());
    existing.setStatus(status);
    mapper.updateById(existing);
    return requireConfiguration(id);
  }

  @Transactional
  public List<SlabMarkupConfiguration> reorderConfigurations(List<Long> orderedIds) {
    requirePlatformScope();
    List<SlabMarkupConfiguration> configurations = mapper.selectList(
        Wrappers.<SlabMarkupConfiguration>lambdaQuery());
    if (orderedIds == null
        || orderedIds.size() != configurations.size()
        || new HashSet<>(orderedIds).size() != configurations.size()) {
      throw new IllegalArgumentException("请提交当前商品类型的全部加价配置");
    }
    Map<Long, SlabMarkupConfiguration> configurationsById = configurations.stream()
        .collect(Collectors.toMap(SlabMarkupConfiguration::getId, Function.identity()));
    if (!configurationsById.keySet().equals(new HashSet<>(orderedIds))) {
      throw new IllegalArgumentException("加价配置顺序与当前数据不一致");
    }
    configurations.forEach(item ->
        ownershipGuard.requireCreator(item.getCreatedByAccountId(), item.getCreatedByName()));
    for (int index = 0; index < orderedIds.size(); index += 1) {
      SlabMarkupConfiguration configuration = configurationsById.get(orderedIds.get(index));
      configuration.setSortOrder(index + 1);
      mapper.updateById(configuration);
    }
    return listConfigurations(false);
  }

  @Transactional
  public void deleteConfiguration(Long id) {
    requirePlatformScope();
    SlabMarkupConfiguration existing = requireConfiguration(id);
    ownershipGuard.requireCreator(existing.getCreatedByAccountId(), existing.getCreatedByName());
    if (mapper.countProductReferences(id) > 0) {
      throw new IllegalArgumentException("加价配置“" + existing.getName() + "”已被商品使用，只能停用");
    }
    mapper.deleteById(id);
  }

  public SlabMarkupConfiguration requireConfiguration(Long id) {
    SlabMarkupConfiguration configuration = mapper.selectById(id);
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

  private void validateUniqueName(String name, Long excludedId) {
    var query = Wrappers.<SlabMarkupConfiguration>lambdaQuery()
        .eq(SlabMarkupConfiguration::getName, name);
    if (excludedId != null) {
      query.ne(SlabMarkupConfiguration::getId, excludedId);
    }
    if (mapper.selectCount(query) > 0) {
      throw new IllegalArgumentException(DUPLICATE_NAME_MESSAGE);
    }
  }

  private int nextSortOrder() {
    SlabMarkupConfiguration lastConfiguration = mapper.selectOne(
        Wrappers.<SlabMarkupConfiguration>lambdaQuery()
            .orderByDesc(SlabMarkupConfiguration::getSortOrder)
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
