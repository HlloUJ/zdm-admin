package com.zdm.platform.store;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.zdm.platform.security.CurrentIdentityProvider;
import java.util.HashSet;
import java.util.List;
import java.util.Objects;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class StoreCategoryService extends ServiceImpl<StoreCategoryMapper, StoreCategory> {
  private static final String DUPLICATE_NAME_MESSAGE = "同级分类名称不能重复";
  private final CurrentIdentityProvider identityProvider;

  public StoreCategoryService(CurrentIdentityProvider identityProvider) {
    this.identityProvider = identityProvider;
  }

  private Long requireStoreId() {
    var identity = identityProvider.require();
    if (!"admin".equals(identity.clientCode()) || identity.storeId() == null || identity.tenantId() == null) {
      throw new AccessDeniedException("当前身份未关联门店");
    }
    if (baseMapper.countStore(identity.storeId(), identity.tenantId()) != 1) {
      throw new AccessDeniedException("当前身份未关联门店");
    }
    return identity.storeId();
  }

  private void requireScope(String scope) {
    if (!List.of("finished", "accessory").contains(Objects.toString(scope, ""))) {
      throw new IllegalArgumentException("分类类型不正确");
    }
  }

  public List<StoreCategory> listOrdered(String scope) {
    requireScope(scope);
    return lambdaQuery().eq(StoreCategory::getStoreId, requireStoreId())
        .eq(StoreCategory::getScope, scope).orderByAsc(StoreCategory::getSortOrder)
        .orderByDesc(StoreCategory::getCreatedAt).orderByDesc(StoreCategory::getId).list();
  }

  public StoreCategory requireCategory(Long id, String scope) {
    requireScope(scope);
    StoreCategory category = lambdaQuery().eq(StoreCategory::getId, id)
        .eq(StoreCategory::getStoreId, requireStoreId()).eq(StoreCategory::getScope, scope).one();
    if (category == null) {
      throw new IllegalArgumentException("分类不存在或已被删除");
    }
    return category;
  }

  @Transactional
  public StoreCategory createCategory(StoreCategoryCreateRequest request) {
    requireScope(request.scope());
    Long storeId = requireStoreId();
    if (request.parentId() != null) {
      StoreCategory parent = requireCategory(request.parentId(), request.scope());
      if (parent.getParentId() != null
          && requireCategory(parent.getParentId(), request.scope()).getParentId() != null) {
        throw new IllegalArgumentException("门店分类最多支持三级");
      }
    }
    requireUniqueName(request.scope(), request.parentId(), request.name().trim(), null);
    for (StoreCategory sibling : listSiblings(request.scope(), request.parentId())) {
      sibling.setSortOrder(sibling.getSortOrder() + 1);
      updateById(sibling);
    }
    StoreCategory category = new StoreCategory();
    category.setStoreId(storeId);
    category.setScope(request.scope());
    category.setParentId(request.parentId());
    category.setName(request.name().trim());
    category.setStatus(request.status());
    category.setProductCount(0);
    category.setSortOrder(1);
    category.setCreatedByName(identityProvider.require().displayName());
    category.setCreatedByAccountId(identityProvider.require().accountId());
    try {
      save(category);
    } catch (DuplicateKeyException exception) {
      throw new IllegalArgumentException(DUPLICATE_NAME_MESSAGE, exception);
    }
    return requireCategory(category.getId(), request.scope());
  }

  @Transactional
  public StoreCategory updateCategory(Long id, String scope, StoreCategoryUpdateRequest request) {
    StoreCategory category = requireCategory(id, scope);
    requireUniqueName(scope, category.getParentId(), request.name().trim(), id);
    category.setName(request.name().trim());
    try {
      updateById(category);
    } catch (DuplicateKeyException exception) {
      throw new IllegalArgumentException(DUPLICATE_NAME_MESSAGE, exception);
    }
    if (request.status() != null && !request.status().equals(category.getStatus())) {
      updateStatus(id, scope, request.status());
    }
    return requireCategory(id, scope);
  }

  @Transactional
  public StoreCategory updateStatus(Long id, String scope, String status) {
    StoreCategory category = requireCategory(id, scope);
    var familyIds = new HashSet<Long>();
    familyIds.add(id);
    var categories = listOrdered(scope);
    boolean changed;
    do {
      changed = false;
      for (StoreCategory child : categories) {
        if (child.getParentId() != null && familyIds.contains(child.getParentId()) && familyIds.add(child.getId())) {
          changed = true;
        }
      }
    } while (changed);
    update(Wrappers.<StoreCategory>lambdaUpdate()
        .eq(StoreCategory::getStoreId, category.getStoreId()).eq(StoreCategory::getScope, scope)
        .in(StoreCategory::getId, familyIds).set(StoreCategory::getStatus, status));
    return requireCategory(id, scope);
  }

  @Transactional
  public List<StoreCategory> sortCategories(StoreCategorySortRequest request) {
    requireScope(request.scope());
    if (request.parentId() != null) {
      requireCategory(request.parentId(), request.scope());
    }
    var siblings = listSiblings(request.scope(), request.parentId());
    var ids = request.orderedIds();
    var expected = siblings.stream().map(StoreCategory::getId).collect(java.util.stream.Collectors.toSet());
    if (new HashSet<>(ids).size() != ids.size() || !expected.equals(new HashSet<>(ids))) {
      throw new IllegalArgumentException("只能对当前门店同类型的完整同级分类排序，请刷新后重试");
    }
    for (int index = 0; index < ids.size(); index++) {
      StoreCategory category = requireCategory(ids.get(index), request.scope());
      category.setSortOrder(index + 1);
      updateById(category);
    }
    return listOrdered(request.scope());
  }

  @Transactional
  public void deleteCategory(Long id, String scope) {
    StoreCategory category = requireCategory(id, scope);
    if (!listSiblings(scope, id).isEmpty()) {
      throw new IllegalArgumentException("该分类包含下级分类，请先删除或转移下级分类");
    }
    if (category.getProductCount() != null && category.getProductCount() > 0) {
      throw new IllegalArgumentException("该分类已关联商品，不能删除，请先停用该分类");
    }
    if (!removeById(id)) {
      throw new IllegalArgumentException("分类删除失败，请刷新后重试");
    }
    var siblings = listSiblings(scope, category.getParentId());
    for (int index = 0; index < siblings.size(); index++) {
      siblings.get(index).setSortOrder(index + 1);
      updateById(siblings.get(index));
    }
  }

  private List<StoreCategory> listSiblings(String scope, Long parentId) {
    return listOrdered(scope).stream().filter(category -> Objects.equals(parentId, category.getParentId())).toList();
  }

  private void requireUniqueName(String scope, Long parentId, String name, Long excludedId) {
    if (listSiblings(scope, parentId).stream()
        .anyMatch(category -> category.getName().equals(name) && !Objects.equals(category.getId(), excludedId))) {
      throw new IllegalArgumentException(DUPLICATE_NAME_MESSAGE);
    }
  }
}
