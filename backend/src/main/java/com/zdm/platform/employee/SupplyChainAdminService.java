package com.zdm.platform.employee;

import com.zdm.platform.account.AccountLifecycleService;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

/** Platform enrollment only; supply-chain employee and role data never form this view. */
@Service
public class SupplyChainAdminService {
  private final JdbcTemplate jdbc;
  private final AccountLifecycleService accounts;
  private final com.zdm.platform.security.CurrentIdentityProvider identities;
  private final com.zdm.platform.security.PermissionGuard permissions;

  public SupplyChainAdminService(JdbcTemplate jdbc, AccountLifecycleService accounts,
      com.zdm.platform.security.CurrentIdentityProvider identities,
      com.zdm.platform.security.PermissionGuard permissions) {
    this.identities = identities;
    this.permissions = permissions;
    this.jdbc = jdbc;
    this.accounts = accounts;
  }

  @org.springframework.transaction.annotation.Transactional
  public EmployeeInviteRegisterResponse accept(EmployeeInvite invite, EmployeeInviteRegisterRequest request) {
    // Serialize administrator enrollment to avoid concurrent account/identity insert gap locks.
    // This lock does not limit how many administrators can be invited or created.
    jdbc.queryForObject("SELECT code FROM platform_clients WHERE code='supply-chain' FOR UPDATE", String.class);
    var existing = accounts.findByPhoneForUpdate(request.phone());
    if (existing.isEmpty() && (!StringUtils.hasText(request.name())
        || !List.of("male", "female").contains(request.gender() == null ? "" : request.gender()))) {
      throw new IllegalArgumentException("请填写姓名并选择性别");
    }
    var account = existing.orElseGet(() -> accounts.findOrCreate(request.phone(), request.name().trim(), request.gender()));
    if (!"enabled".equals(account.status())) {
      throw new IllegalArgumentException("该账号已停用，不能建立管理员身份");
    }
    if (!jdbc.queryForList("SELECT id FROM account_identities WHERE account_id=? AND client_code='supply-chain' FOR UPDATE",
        Long.class, account.id()).isEmpty()) {
      throw new IllegalArgumentException("该账号已有供应链身份，不能通过邀请升级或重新启用");
    }
    jdbc.update("""
        INSERT INTO account_identities
          (account_id, client_code, identity_type, subject_id, tenant_id, store_id, status)
        VALUES (?, 'supply-chain', 'supply_chain_admin', ?, NULL, NULL, 'enabled')
        """, account.id(), account.id());
    Long identityId = jdbc.queryForObject("SELECT id FROM account_identities WHERE account_id=? AND client_code='supply-chain' AND identity_type='supply_chain_admin'", Long.class, account.id());
    jdbc.update("INSERT INTO supply_chain_admin_profiles(identity_id,remark) VALUES (?, '')", identityId);
    invite.setAcceptedAccountId(account.id());
    return new EmployeeInviteRegisterResponse(null, "enabled", !account.created(), false, true, "supply_chain_admin");
  }

  public List<Employee> openingRecords() {
    return jdbc.query("""
        SELECT ai.id, a.id AS account_id, a.display_name, a.gender, p.remark, a.phone, ai.status,
               i.created_by_name, i.created_by_account_id, MIN(ac.accepted_at) AS created_at
        FROM account_identities ai
        JOIN accounts a ON a.id=ai.account_id
        LEFT JOIN supply_chain_admin_profiles p ON p.identity_id=ai.id
        JOIN employee_invite_acceptances ac ON ac.account_id=ai.account_id
        JOIN employee_invites i ON i.id=ac.invite_id AND i.target_identity_type='supply_chain_admin'
        AND ac.id=(SELECT MIN(first_ac.id) FROM employee_invite_acceptances first_ac
          JOIN employee_invites first_i ON first_i.id=first_ac.invite_id
          WHERE first_ac.account_id=ai.account_id AND first_i.target_identity_type='supply_chain_admin')
        WHERE ai.client_code='supply-chain' AND ai.identity_type='supply_chain_admin'
        GROUP BY ai.id, a.id, a.display_name, a.gender, p.remark, a.phone, ai.status, i.created_by_name, i.created_by_account_id
        """, (rs, row) -> {
          Employee record = new Employee();
          record.setId(rs.getLong("id"));
          record.setAccountId(rs.getLong("account_id"));
          record.setClientCode("supply-chain");
          record.setIdentityType("supply_chain_admin");
          record.setName(rs.getString("display_name"));
          record.setPhone(rs.getString("phone"));
          record.setGender(rs.getString("gender"));
          record.setRemark(rs.getString("remark"));
          record.setDataPermission("all");
          record.setStatus(rs.getString("status"));
          record.setCreatedByName(rs.getString("created_by_name"));
          record.setCreatedByAccountId(rs.getObject("created_by_account_id", Long.class));
          record.setCreatedAt(rs.getTimestamp("created_at").toLocalDateTime());
          return record;
        });
  }
  @org.springframework.transaction.annotation.Transactional
  public Employee updateProfile(Long id, SupplyChainAdminController.ProfileRequest request) {
    Employee record = requireAdministrator(id, "edit");
    accounts.updatePersonalProfile(record.getAccountId(), request.name(), request.gender());
    jdbc.update("""
        INSERT INTO supply_chain_admin_profiles(identity_id,remark) VALUES (?,?)
        ON DUPLICATE KEY UPDATE remark=VALUES(remark)
        """, id, request.remark() == null ? "" : request.remark().trim());
    return openingRecords().stream().filter(row -> row.getId().equals(id)).findFirst().orElseThrow();
  }

  @org.springframework.transaction.annotation.Transactional
  public Employee updateStatus(Long id, String status) {
    requireAdministrator(id, "toggle-status");
    jdbc.update("UPDATE account_identities SET status=? WHERE id=?", status, id);
    if ("disabled".equals(status)) {
      jdbc.update("UPDATE auth_sessions SET revoked_at=NOW() WHERE identity_id=? AND revoked_at IS NULL", id);
    }
    return openingRecords().stream().filter(row -> row.getId().equals(id)).findFirst().orElseThrow();
  }

  @org.springframework.transaction.annotation.Transactional
  public boolean deleteAdministrator(Long id) {
    Employee record = requireAdministrator(id, "delete");
    jdbc.update("DELETE FROM auth_sessions WHERE identity_id=?", id);
    jdbc.update("DELETE FROM account_identities WHERE id=?", id);
    accounts.releaseIfUnbound(record.getAccountId());
    return true;
  }

  private Employee requireAdministrator(Long id, String action) {
    var actor = identities.require();
    if (!"admin".equals(actor.clientCode()) || actor.tenantId() != null || actor.storeId() != null) {
      throw new org.springframework.security.access.AccessDeniedException("仅运营管理平台可管理供应链管理员账号");
    }
    permissions.requirePermission(EmployeeService.permissionPrefix("supply-chain") + "." + action);
    Employee record = openingRecords().stream().filter(row -> row.getId().equals(id)).findFirst()
        .orElseThrow(() -> new IllegalArgumentException("供应链管理员不存在"));
    com.zdm.platform.security.DataScope.requireAccess(actor, record.getCreatedByAccountId());
    accounts.lockAccount(record.getAccountId());
    if (jdbc.queryForList("""
        SELECT id FROM account_identities WHERE id=? AND client_code='supply-chain'
          AND identity_type='supply_chain_admin' AND tenant_id IS NULL AND store_id IS NULL FOR UPDATE
        """, Long.class, id).isEmpty()) {
      throw new IllegalArgumentException("供应链管理员不存在");
    }
    return record;
  }

}
