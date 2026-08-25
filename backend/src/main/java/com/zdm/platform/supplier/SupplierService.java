package com.zdm.platform.supplier;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.zdm.platform.common.SlabSupplierOptionProvider;
import com.zdm.platform.security.CurrentIdentity;
import com.zdm.platform.security.CurrentIdentityProvider;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

@Service
public class SupplierService extends ServiceImpl<SupplierMapper, Supplier>
    implements SlabSupplierOptionProvider {
  private static final String DUPLICATE_NAME_MESSAGE = "供应商名称已存在";
  private static final String SLAB_REFERENCED_MESSAGE =
      "该供应商已关联大板库存，不能删除，请先停用该供应商";
  private static final String FINISHED_REFERENCED_MESSAGE =
      "该供应商已关联成品，不能删除，请先停用该供应商";
  private static final String REFERENCED_MESSAGE =
      "该供应商已关联大板库存或成品，不能删除，请先停用该供应商";

  private final JdbcTemplate jdbcTemplate;
  private final CurrentIdentityProvider identityProvider;
  private final SupplierSupplyTypeMapper supplyTypeMapper;

  public SupplierService(
      JdbcTemplate jdbcTemplate,
      CurrentIdentityProvider identityProvider,
      SupplierSupplyTypeMapper supplyTypeMapper) {
    this.jdbcTemplate = jdbcTemplate;
    this.identityProvider = identityProvider;
    this.supplyTypeMapper = supplyTypeMapper;
  }

  public List<Supplier> listSuppliers() {
    CurrentIdentity identity = identityProvider.require();
    SupplierScope scope = SupplierScope.from(identity);
    var query = lambdaQuery()
        .eq(Supplier::getOwnerScope, scope.ownerScope())
        .eq(Supplier::getOwnerId, scope.ownerId());
    if (!identity.isSuperAdmin() && "self".equals(identity.dataPermission())) {
      query.eq(Supplier::getCreatedByAccountId, identity.accountId());
    }
    List<Supplier> suppliers = query
        .orderByDesc(Supplier::getCreatedAt)
        .orderByDesc(Supplier::getId)
        .list();
    enrichSupplyTypes(suppliers);
    return suppliers;
  }

  /**
   * Returns suppliers that can be selected by the slab business form.
   * Business option lookup intentionally ignores the operator's self/all data permission,
   * while still keeping the current identity's organization ownership boundary.
   */
  private List<Supplier> selectableSlabSuppliers() {
    SupplierScope scope = SupplierScope.from(identityProvider.require());
    List<Supplier> suppliers = lambdaQuery()
        .eq(Supplier::getOwnerScope, scope.ownerScope())
        .eq(Supplier::getOwnerId, scope.ownerId())
        .eq(Supplier::getStatus, "enabled")
        .orderByAsc(Supplier::getName)
        .orderByAsc(Supplier::getId)
        .list();
    enrichSupplyTypes(suppliers);
    return suppliers.stream().filter(this::suppliesSlabs).toList();
  }

  @Override
  public List<SlabSupplierOptionProvider.Option> listSelectableSlabSuppliers() {
    return selectableSlabSuppliers().stream()
        .map(supplier -> new SlabSupplierOptionProvider.Option(
            supplier.getId(), supplier.getName(), supplier.getStatus()))
        .toList();
  }

  @Override
  public boolean isSelectableSlabSupplier(Long supplierId) {
    if (supplierId == null) {
      return false;
    }
    return selectableSlabSuppliers().stream()
        .anyMatch(supplier -> Objects.equals(supplier.getId(), supplierId));
  }

  @Transactional
  public Supplier createSupplier(Supplier supplier) {
    CurrentIdentity identity = identityProvider.require();
    SupplierScope scope = SupplierScope.from(identity);
    supplier.setId(null);
    applyScope(supplier, scope);
    List<SupplierSupplyType> types = requireSelectableTypes(supplier.getSupplyTypeIds(), List.of());
    normalizeAndValidateName(supplier, scope, null);
    supplier.setCreatedByName(identity.displayName());
    supplier.setCreatedByAccountId(identity.accountId());
    try {
      save(supplier);
      replaceSupplyTypes(supplier.getId(), types);
    } catch (DuplicateKeyException exception) {
      throw new IllegalArgumentException(DUPLICATE_NAME_MESSAGE, exception);
    }
    return enrichSupplyTypes(supplier);
  }

  @Transactional
  public Supplier updateSupplier(Long id, Supplier payload) {
    CurrentIdentity identity = identityProvider.require();
    SupplierScope scope = SupplierScope.from(identity);
    Supplier existing = requireScopedSupplier(id, identity, scope);
    List<SupplierSupplyType> types = requireSelectableTypes(payload.getSupplyTypeIds(), linkedTypeIds(id));
    payload.setId(id);
    applyScope(payload, scope);
    normalizeAndValidateName(payload, scope, id);
    payload.setStatus(existing.getStatus());
    payload.setCreatedByName(existing.getCreatedByName());
    payload.setCreatedByAccountId(existing.getCreatedByAccountId());
    try {
      updateById(payload);
      replaceSupplyTypes(id, types);
    } catch (DuplicateKeyException exception) {
      throw new IllegalArgumentException(DUPLICATE_NAME_MESSAGE, exception);
    }
    return enrichSupplyTypes(getById(id));
  }

  @Transactional
  public Supplier updateStatus(Long id, String status) {
    CurrentIdentity identity = identityProvider.require();
    SupplierScope scope = SupplierScope.from(identity);
    Supplier existing = requireScopedSupplier(id, identity, scope);
    existing.setStatus(status);
    updateById(existing);
    return enrichSupplyTypes(getById(id));
  }

  @Transactional
  public boolean deleteSupplier(Long id) {
    CurrentIdentity identity = identityProvider.require();
    SupplierScope scope = SupplierScope.from(identity);
    requireScopedSupplier(id, identity, scope);

    Long slabInventoryReferenceCount = jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM slab_inventory WHERE supplier_id = ?",
        Long.class,
        id);
    Long finishedProductReferenceCount = jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM finished_products WHERE supplier_id = ?",
        Long.class,
        id);
    boolean referencedBySlabInventory =
        slabInventoryReferenceCount != null && slabInventoryReferenceCount > 0;
    boolean referencedByFinishedProduct =
        finishedProductReferenceCount != null && finishedProductReferenceCount > 0;
    if (referencedBySlabInventory && referencedByFinishedProduct) {
      throw new IllegalArgumentException(REFERENCED_MESSAGE);
    }
    if (referencedBySlabInventory) {
      throw new IllegalArgumentException(SLAB_REFERENCED_MESSAGE);
    }
    if (referencedByFinishedProduct) {
      throw new IllegalArgumentException(FINISHED_REFERENCED_MESSAGE);
    }

    try {
      return removeById(id);
    } catch (DataIntegrityViolationException exception) {
      throw new IllegalArgumentException(REFERENCED_MESSAGE, exception);
    }
  }

  private Supplier requireScopedSupplier(
      Long id,
      CurrentIdentity identity,
      SupplierScope scope) {
    Supplier supplier = lambdaQuery()
        .eq(Supplier::getId, id)
        .eq(Supplier::getOwnerScope, scope.ownerScope())
        .eq(Supplier::getOwnerId, scope.ownerId())
        .one();
    if (supplier == null) {
      throw new IllegalArgumentException("供应商不存在或无权访问");
    }
    if (!identity.isSuperAdmin()
        && "self".equals(identity.dataPermission())
        && !Objects.equals(supplier.getCreatedByAccountId(), identity.accountId())) {
      throw new AccessDeniedException("当前数据权限不允许访问该供应商");
    }
    return supplier;
  }

  private void applyScope(Supplier supplier, SupplierScope scope) {
    supplier.setOwnerScope(scope.ownerScope());
    supplier.setOwnerId(scope.ownerId());
    supplier.setTenantId(scope.tenantId());
    supplier.setStoreId(scope.storeId());
  }

  private void normalizeAndValidateName(
      Supplier supplier,
      SupplierScope scope,
      Long excludedSupplierId) {
    if (!StringUtils.hasText(supplier.getName())) {
      throw new IllegalArgumentException("请输入供应商名称");
    }
    String supplierName = supplier.getName().trim();
    supplier.setName(supplierName);
    var duplicateQuery = lambdaQuery()
        .eq(Supplier::getOwnerScope, scope.ownerScope())
        .eq(Supplier::getOwnerId, scope.ownerId())
        .eq(Supplier::getName, supplierName);
    if (excludedSupplierId != null) {
      duplicateQuery.ne(Supplier::getId, excludedSupplierId);
    }
    if (duplicateQuery.count() > 0) {
      throw new IllegalArgumentException(DUPLICATE_NAME_MESSAGE);
    }
  }

  private List<SupplierSupplyType> requireSelectableTypes(
      List<Long> requestedIds,
      List<Long> existingIds) {
    List<Long> ids = requestedIds == null
        ? List.of()
        : new ArrayList<>(new LinkedHashSet<>(requestedIds));
    if (ids.isEmpty()) {
      throw new IllegalArgumentException("请至少选择一个供货类型");
    }
    Map<Long, SupplierSupplyType> typesById = new LinkedHashMap<>();
    supplyTypeMapper.selectBatchIds(ids).forEach(type -> typesById.put(type.getId(), type));
    if (typesById.size() != ids.size()) {
      throw new IllegalArgumentException("供货类型不存在");
    }
    List<SupplierSupplyType> result = ids.stream().map(typesById::get).toList();
    boolean containsUnavailable = result.stream().anyMatch(
        type -> !"enabled".equals(type.getStatus()) && !existingIds.contains(type.getId()));
    if (containsUnavailable) {
      throw new IllegalArgumentException("已停用的供货类型不可新增选择");
    }
    return result;
  }

  private void replaceSupplyTypes(Long supplierId, List<SupplierSupplyType> types) {
    jdbcTemplate.update("DELETE FROM supplier_supply_type_links WHERE supplier_id = ?", supplierId);
    types.forEach(type -> jdbcTemplate.update(
        "INSERT INTO supplier_supply_type_links (supplier_id, supply_type_id) VALUES (?, ?)",
        supplierId,
        type.getId()));
  }

  private List<Long> linkedTypeIds(Long supplierId) {
    return jdbcTemplate.queryForList(
        "SELECT supply_type_id FROM supplier_supply_type_links WHERE supplier_id = ? ORDER BY supply_type_id",
        Long.class,
        supplierId);
  }

  private Supplier enrichSupplyTypes(Supplier supplier) {
    enrichSupplyTypes(List.of(supplier));
    return supplier;
  }

  private void enrichSupplyTypes(List<Supplier> suppliers) {
    if (suppliers.isEmpty()) {
      return;
    }
    Map<Long, Supplier> suppliersById = new LinkedHashMap<>();
    suppliers.forEach(supplier -> {
      suppliersById.put(supplier.getId(), supplier);
      supplier.setSupplyTypes(new ArrayList<>());
      supplier.setSupplyTypeIds(new ArrayList<>());
    });
    String placeholders = String.join(",", suppliers.stream().map(item -> "?").toList());
    Object[] ids = suppliers.stream().map(Supplier::getId).toArray();
    String supplyTypeSql = """
        SELECT link.supplier_id, type.id, type.code, type.name, type.status,
               type.created_by_name, type.created_by_account_id, type.created_at, type.updated_at
        FROM supplier_supply_type_links link
        JOIN supplier_supply_types type ON type.id = link.supply_type_id
        WHERE link.supplier_id IN (__PLACEHOLDERS__)
        ORDER BY type.id
        """.replace("__PLACEHOLDERS__", placeholders);
    jdbcTemplate.query(
        supplyTypeSql,
        rs -> {
          Supplier supplier = suppliersById.get(rs.getLong("supplier_id"));
          if (supplier == null) {
            return;
          }
          SupplierSupplyType type = new SupplierSupplyType();
          type.setId(rs.getLong("id"));
          type.setCode(rs.getString("code"));
          type.setName(rs.getString("name"));
          type.setStatus(rs.getString("status"));
          type.setCreatedByName(rs.getString("created_by_name"));
          type.setCreatedByAccountId(rs.getObject("created_by_account_id", Long.class));
          type.setCreatedAt(rs.getTimestamp("created_at").toLocalDateTime());
          type.setUpdatedAt(rs.getTimestamp("updated_at").toLocalDateTime());
          List<SupplierSupplyType> types = new ArrayList<>(supplier.getSupplyTypes());
          types.add(type);
          supplier.setSupplyTypes(types);
          List<Long> typeIds = new ArrayList<>(supplier.getSupplyTypeIds());
          typeIds.add(type.getId());
          supplier.setSupplyTypeIds(typeIds);
        },
        ids);
  }

  private boolean suppliesSlabs(Supplier supplier) {
    return supplier.getSupplyTypes() != null && supplier.getSupplyTypes().stream().anyMatch(
        type -> "enabled".equals(type.getStatus())
            && ("slab".equals(type.getCode())
                || "大板".equals(type.getName() == null ? null : type.getName().trim())));
  }
}
