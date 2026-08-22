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
public class FinishedMarkupConfigurationService {
  private static final String DUPLICATE_NAME_MESSAGE = "成品现货价格层级名称已存在";
  private final FinishedMarkupConfigurationMapper mapper;
  private final CurrentIdentityProvider identityProvider;
  private final CreatorOwnershipGuard ownershipGuard;

  public FinishedMarkupConfigurationService(FinishedMarkupConfigurationMapper mapper,
      CurrentIdentityProvider identityProvider, CreatorOwnershipGuard ownershipGuard) {
    this.mapper = mapper;
    this.identityProvider = identityProvider;
    this.ownershipGuard = ownershipGuard;
  }

  public List<FinishedMarkupConfiguration> listConfigurations(boolean enabledOnly) {
    requirePlatformScope();
    var query = Wrappers.<FinishedMarkupConfiguration>lambdaQuery();
    if (enabledOnly) {
      query.eq(FinishedMarkupConfiguration::getStatus, "enabled");
    }
    List<FinishedMarkupConfiguration> result = mapper.selectList(query
        .orderByAsc(FinishedMarkupConfiguration::getSortOrder)
        .orderByDesc(FinishedMarkupConfiguration::getCreatedAt)
        .orderByDesc(FinishedMarkupConfiguration::getId));
    result.forEach(item -> item.setReferenced(mapper.countProductReferences(item.getId()) > 0));
    return result;
  }

  @Transactional
  public FinishedMarkupConfiguration createConfiguration(FinishedMarkupConfiguration payload) {
    CurrentIdentity identity = requirePlatformScope();
    payload.setId(null);
    payload.setName(normalizedName(payload.getName()));
    payload.setStatus("enabled");
    payload.setSortOrder(nextSortOrder());
    payload.setCreatedByName(identity.displayName());
    payload.setCreatedByAccountId(identity.accountId());
    validateUniqueName(payload.getName(), null);
    try { mapper.insert(payload); } catch (DuplicateKeyException exception) {
      throw new IllegalArgumentException(DUPLICATE_NAME_MESSAGE, exception);
    }
    return requireConfiguration(payload.getId());
  }

  @Transactional
  public FinishedMarkupConfiguration updateConfiguration(Long id, FinishedMarkupConfiguration payload) {
    requirePlatformScope();
    FinishedMarkupConfiguration existing = requireConfiguration(id);
    ownershipGuard.requireCreator(existing.getCreatedByAccountId(), existing.getCreatedByName());
    payload.setId(id);
    payload.setName(normalizedName(payload.getName()));
    payload.setStatus(existing.getStatus());
    payload.setSortOrder(existing.getSortOrder());
    payload.setCreatedByName(existing.getCreatedByName());
    payload.setCreatedByAccountId(existing.getCreatedByAccountId());
    validateUniqueName(payload.getName(), id);
    try { mapper.updateById(payload); } catch (DuplicateKeyException exception) {
      throw new IllegalArgumentException(DUPLICATE_NAME_MESSAGE, exception);
    }
    return requireConfiguration(id);
  }

  @Transactional
  public FinishedMarkupConfiguration updateStatus(Long id, String status) {
    requirePlatformScope();
    FinishedMarkupConfiguration existing = requireConfiguration(id);
    ownershipGuard.requireCreator(existing.getCreatedByAccountId(), existing.getCreatedByName());
    existing.setStatus(status);
    mapper.updateById(existing);
    return requireConfiguration(id);
  }

  @Transactional
  public List<FinishedMarkupConfiguration> reorderConfigurations(List<Long> orderedIds) {
    requirePlatformScope();
    List<FinishedMarkupConfiguration> configurations = mapper.selectList(
        Wrappers.<FinishedMarkupConfiguration>lambdaQuery());
    if (orderedIds == null || orderedIds.size() != configurations.size()
        || new HashSet<>(orderedIds).size() != configurations.size()) {
      throw new IllegalArgumentException("请提交成品现货的全部价格层级");
    }
    Map<Long, FinishedMarkupConfiguration> byId = configurations.stream()
        .collect(Collectors.toMap(FinishedMarkupConfiguration::getId, Function.identity()));
    if (!byId.keySet().equals(new HashSet<>(orderedIds))) {
      throw new IllegalArgumentException("价格层级顺序与当前数据不一致");
    }
    configurations.forEach(item -> ownershipGuard.requireCreator(
        item.getCreatedByAccountId(), item.getCreatedByName()));
    for (int index = 0; index < orderedIds.size(); index += 1) {
      FinishedMarkupConfiguration configuration = byId.get(orderedIds.get(index));
      configuration.setSortOrder(index + 1);
      mapper.updateById(configuration);
    }
    return listConfigurations(false);
  }

  @Transactional
  public void deleteConfiguration(Long id) {
    requirePlatformScope();
    FinishedMarkupConfiguration existing = requireConfiguration(id);
    ownershipGuard.requireCreator(existing.getCreatedByAccountId(), existing.getCreatedByName());
    if (mapper.countProductReferences(id) > 0) {
      throw new IllegalArgumentException("价格层级“" + existing.getName() + "”已被成品现货使用，只能停用");
    }
    mapper.deleteById(id);
  }

  public FinishedMarkupConfiguration requireConfiguration(Long id) {
    FinishedMarkupConfiguration configuration = mapper.selectById(id);
    if (configuration == null) {
      throw new IllegalArgumentException("成品现货价格层级不存在");
    }
    configuration.setReferenced(mapper.countProductReferences(id) > 0);
    return configuration;
  }

  private CurrentIdentity requirePlatformScope() {
    CurrentIdentity identity = identityProvider.require();
    if (identity.tenantId() != null || identity.storeId() != null) {
      throw new AccessDeniedException("仅运营管理平台可以维护成品现货价格层级");
    }
    return identity;
  }

  private void validateUniqueName(String name, Long excludedId) {
    var query = Wrappers.<FinishedMarkupConfiguration>lambdaQuery()
        .eq(FinishedMarkupConfiguration::getName, name);
    if (excludedId != null) {
      query.ne(FinishedMarkupConfiguration::getId, excludedId);
    }
    if (mapper.selectCount(query) > 0) {
      throw new IllegalArgumentException(DUPLICATE_NAME_MESSAGE);
    }
  }

  private int nextSortOrder() {
    FinishedMarkupConfiguration last = mapper.selectOne(
        Wrappers.<FinishedMarkupConfiguration>lambdaQuery()
            .orderByDesc(FinishedMarkupConfiguration::getSortOrder).last("LIMIT 1"));
    return last == null || last.getSortOrder() == null ? 1 : last.getSortOrder() + 1;
  }

  private String normalizedName(String value) {
    if (!StringUtils.hasText(value)) {
      throw new IllegalArgumentException("请输入价格层级名称");
    }
    String name = value.trim();
    if (name.length() > 20) {
      throw new IllegalArgumentException("价格层级名称最多20个字");
    }
    return name;
  }
}
