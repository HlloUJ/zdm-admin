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

  public SupplyChainAdminService(JdbcTemplate jdbc, AccountLifecycleService accounts) {
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
    var account = existing.orElseGet(() -> accounts.findOrCreate(request.phone(), request.name().trim()));
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
    invite.setAcceptedAccountId(account.id());
    return new EmployeeInviteRegisterResponse(null, "enabled", !account.created(), false, true, "supply_chain_admin");
  }

  public List<Employee> openingRecords() {
    return jdbc.query("""
        SELECT ai.id, a.id AS account_id, a.display_name, a.phone, ai.status,
               i.created_by_name, i.created_by_account_id, MIN(ac.accepted_at) AS created_at
        FROM account_identities ai
        JOIN accounts a ON a.id=ai.account_id
        JOIN employee_invite_acceptances ac ON ac.account_id=ai.account_id
        JOIN employee_invites i ON i.id=ac.invite_id AND i.target_identity_type='supply_chain_admin'
        AND ac.id=(SELECT MIN(first_ac.id) FROM employee_invite_acceptances first_ac
          JOIN employee_invites first_i ON first_i.id=first_ac.invite_id
          WHERE first_ac.account_id=ai.account_id AND first_i.target_identity_type='supply_chain_admin')
        WHERE ai.client_code='supply-chain' AND ai.identity_type='supply_chain_admin'
        GROUP BY ai.id, a.id, a.display_name, a.phone, ai.status, i.created_by_name, i.created_by_account_id
        """, (rs, row) -> {
          Employee record = new Employee();
          record.setId(rs.getLong("id"));
          record.setAccountId(rs.getLong("account_id"));
          record.setClientCode("supply-chain");
          record.setIdentityType("supply_chain_admin");
          record.setName(rs.getString("display_name"));
          record.setPhone(rs.getString("phone"));
          record.setStatus(rs.getString("status"));
          record.setCreatedByName(rs.getString("created_by_name"));
          record.setCreatedByAccountId(rs.getObject("created_by_account_id", Long.class));
          record.setCreatedAt(rs.getTimestamp("created_at").toLocalDateTime());
          return record;
        });
  }
}
