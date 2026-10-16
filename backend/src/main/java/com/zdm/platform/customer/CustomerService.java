package com.zdm.platform.customer;

import com.zdm.platform.media.MediaAsset;
import com.zdm.platform.media.MediaAssetService;
import com.zdm.platform.media.MediaCleanupService;
import com.zdm.platform.media.MediaReferenceService;
import com.zdm.platform.security.CurrentIdentity;
import com.zdm.platform.security.DataScope;
import com.zdm.platform.security.PermissionGuard;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class CustomerService {
  public static final String PREFIX = "store.customer-management";
  public static final String DOMAIN = "STORE_CUSTOMER_FOLLOWUP";
  public static final long FILE_LIMIT = 5L * 1024 * 1024;
  private final JdbcTemplate jdbc;
  private final PermissionGuard guard;
  private final MediaAssetService media;
  private final MediaReferenceService references;
  private final MediaCleanupService cleanup;
  private final CustomerContactRegions contactRegions;

  public CustomerService(JdbcTemplate jdbc, PermissionGuard guard, MediaAssetService media,
      MediaReferenceService references, MediaCleanupService cleanup, CustomerContactRegions contactRegions) {
    this.jdbc = jdbc; this.guard = guard; this.media = media;
    this.references = references; this.cleanup = cleanup; this.contactRegions = contactRegions;
  }
  public record Customer(Long id, Long tenantId, Long storeId, String name, String phone,
      String nationality, String phoneRegion, String callingCode,
      String wechat, String requirement, String remark, Long ownerAccountId, String ownerName,
      Long createdByAccountId, String createdByName, String status, LocalDateTime archivedAt,
      LocalDateTime createdAt, LocalDateTime lastFollowedAt, LocalDateTime nextFollowAt) {}
  public record Attachment(Long mediaId, String name, String mediaType, String mimeType, long size) {}
  public record Followup(Long id, LocalDateTime followedAt, String content, LocalDateTime nextFollowAt,
      String nextFollowTask, Long createdByAccountId, String createdByName,
      LocalDateTime createdAt, List<Attachment> attachments) {
    public Followup { attachments=List.copyOf(attachments); }
  }
  public record Detail(Customer customer, List<Followup> followups) {
    public Detail { followups=List.copyOf(followups); }
  }
  public record Owner(Long accountId, String name, boolean active) {}

  private CurrentIdentity identity() {
    CurrentIdentity i = guard.identity();
    if (!"admin".equals(i.clientCode()) || i.storeId() == null || i.tenantId() == null
        || !Boolean.TRUE.equals(jdbc.queryForObject(
            "SELECT COUNT(*)=1 FROM stores WHERE id=? AND tenant_id=? AND type='cityPartner' AND status='enabled'",
            Boolean.class, i.storeId(), i.tenantId()))) {
      throw new AccessDeniedException("无权访问当前功能");
    }
    DataScope.requireConfigured(i);
    return i;
  }
  private void permission(String status, String action) {
    identity();
    if (!List.of("daily", "archived").contains(status)) { throw new IllegalArgumentException("客户状态不正确"); }
    guard.requirePermission(PREFIX + "." + status + ".view");
    if (!"view".equals(action)) { guard.requirePermission(PREFIX + "." + status + "." + action); }
  }
  private static String text(String value) { return value == null ? "" : value.trim(); }
  private static LocalDateTime date(ResultSet rs, String key) throws SQLException {
    return rs.getObject(key, LocalDateTime.class);
  }
  private static Long number(ResultSet rs, String key) throws SQLException {
    return rs.getObject(key, Long.class);
  }
  private static final String SELECT = """
      SELECT c.*, a.display_name owner_name, b.display_name creator_name,
      (SELECT MAX(f.followed_at) FROM store_customer_followups f WHERE f.customer_id=c.id) last_followed_at,
      (SELECT f.next_follow_at FROM store_customer_followups f WHERE f.customer_id=c.id
       ORDER BY f.followed_at DESC,f.id DESC LIMIT 1) next_follow_at
      FROM store_customers c LEFT JOIN accounts a ON a.id=c.owner_account_id
      LEFT JOIN accounts b ON b.id=c.created_by_account_id
      """;
  private Customer row(ResultSet rs, int index) throws SQLException {
    return new Customer(number(rs,"id"), number(rs,"tenant_id"), number(rs,"store_id"),
        rs.getString("name"),rs.getString("phone"),rs.getString("nationality"),rs.getString("phone_region"),
        rs.getString("calling_code"),rs.getString("wechat"),rs.getString("requirement"),
        rs.getString("remark"),number(rs,"owner_account_id"),rs.getString("owner_name"),
        number(rs,"created_by_account_id"),rs.getString("creator_name"),rs.getString("status"),
        date(rs,"archived_at"),date(rs,"created_at"),date(rs,"last_followed_at"),date(rs,"next_follow_at"));
  }
  public List<Customer> list(String status, String name, String phone, Long owner) {
    permission(status,"view"); CurrentIdentity i = identity();
    StringBuilder sql = new StringBuilder(SELECT + " WHERE c.tenant_id=? AND c.store_id=? AND c.status=?");
    List<Object> args = new ArrayList<>(List.of(i.tenantId(),i.storeId(),status));
    if (!DataScope.isAll(i)) { sql.append(" AND c.owner_account_id=?"); args.add(i.accountId()); }
    if (owner != null) { sql.append(" AND c.owner_account_id=?"); args.add(owner); }
    if (!text(name).isEmpty()) { sql.append(" AND LOCATE(?,c.name)>0"); args.add(text(name)); }
    if (!text(phone).isEmpty()) { sql.append(" AND LOCATE(?,c.phone)>0"); args.add(text(phone)); }
    sql.append(" ORDER BY c.created_at DESC,c.id DESC");
    return jdbc.query(sql.toString(),this::row,args.toArray());
  }
  private Customer accessible(Long id, boolean lock) {
    CurrentIdentity i = identity();
    var rows = jdbc.query(SELECT + " WHERE c.id=? AND c.tenant_id=? AND c.store_id=?" + (lock ? " FOR UPDATE" : ""),
        this::row,id,i.tenantId(),i.storeId());
    if (rows.isEmpty() || !DataScope.canAccess(i,rows.get(0).ownerAccountId())) {
      throw new AccessDeniedException("无权访问该客户档案");
    }
    return rows.get(0);
  }
  public Detail detail(Long id) {
    Customer c = accessible(id,false); permission(c.status(),"detail");
    return new Detail(c,followups(id));
  }
  private List<Followup> followups(Long id) {
    return jdbc.query("""
        SELECT f.*,a.display_name creator_name FROM store_customer_followups f
        LEFT JOIN accounts a ON a.id=f.created_by_account_id WHERE f.customer_id=?
        ORDER BY f.followed_at DESC,f.id DESC
        """, (rs,n) -> new Followup(number(rs,"id"),date(rs,"followed_at"),rs.getString("content"),
        date(rs,"next_follow_at"),rs.getString("next_follow_task"),number(rs,"created_by_account_id"),
        rs.getString("creator_name"),date(rs,"created_at"),attachments(number(rs,"id"))),id);
  }
  private List<Attachment> attachments(Long followupId) {
    return jdbc.query("""
        SELECT a.* FROM media_references r JOIN media_assets a ON a.id=r.media_id
        WHERE r.business_domain=? AND r.business_id=? AND a.status<>'deleted' ORDER BY r.field_key
        """,(rs,n) -> new Attachment(number(rs,"id"),rs.getString("original_name"),rs.getString("media_type"),
        rs.getString("mime_type"),rs.getLong("file_size")),DOMAIN,followupId);
  }
  @Transactional
  public Customer create(CustomerRequests.Profile p) {
    permission("daily","create"); CurrentIdentity i = identity();
    if (validOwnerCandidates(i).stream().noneMatch(o -> Objects.equals(o.accountId(),p.ownerAccountId()))) {
      throw new IllegalArgumentException("请选择当前门店有效的归属人");
    }
    String callingCode=validateContact(p,null);
    long id = insert("INSERT INTO store_customers(tenant_id,store_id,name,phone,wechat,requirement,remark,owner_account_id,created_by_account_id,nationality,phone_region,calling_code) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        i.tenantId(),i.storeId(),text(p.name()),phoneText(p.phone()),text(p.wechat()),text(p.requirement()),text(p.remark()),p.ownerAccountId(),i.accountId(),text(p.nationality()),text(p.phoneRegion()),callingCode);
    // Creation may explicitly select another owner; later reads still enforce the configured data scope.
    return jdbc.query(SELECT + " WHERE c.id=? AND c.tenant_id=? AND c.store_id=?",
        this::row,id,i.tenantId(),i.storeId()).getFirst();
  }
  @Transactional
  public Customer update(Long id, CustomerRequests.Profile p) {
    Customer c=accessible(id,true); permission(c.status(),"edit");
    if (validOwnerCandidates(identity()).stream().noneMatch(o -> Objects.equals(o.accountId(),p.ownerAccountId()))) {
      throw new IllegalArgumentException("请选择当前门店有效的归属人");
    }
    String callingCode=validateContact(p,c);
    jdbc.update("UPDATE store_customers SET name=?,phone=?,wechat=?,requirement=?,remark=?,owner_account_id=?,nationality=?,phone_region=?,calling_code=? WHERE id=?",
        text(p.name()),phoneText(p.phone()),text(p.wechat()),text(p.requirement()),text(p.remark()),p.ownerAccountId(),text(p.nationality()),text(p.phoneRegion()),callingCode,id);
    // The pre-update owner is authorized above; later requests use the newly persisted owner.
    CurrentIdentity i=identity();
    return jdbc.query(SELECT + " WHERE c.id=? AND c.tenant_id=? AND c.store_id=?",
        this::row,id,i.tenantId(),i.storeId()).getFirst();
  }
  public CustomerContactRegions.Catalogue contactCatalogue(String status) {
    permission(status,"view"); return contactRegions.catalogue();
  }
  private static String phoneText(String value) { return value == null ? "" : value; }
  private String validateContact(CustomerRequests.Profile p, Customer previous) {
    contactRegions.nationality(text(p.nationality()));
    String region=text(p.phoneRegion());
    String callingCode=contactRegions.callingCode(region);
    String phone=phoneText(p.phone());
    boolean unchangedLegacy=previous!=null && text(previous.phoneRegion()).isEmpty()
        && region.isEmpty() && Objects.equals(phone,previous.phone());
    if (!phone.isEmpty() && !unchangedLegacy) {
      if (!phone.matches("[0-9]+")) { throw new IllegalArgumentException("联系电话仅允许输入数字"); }
      if (region.isEmpty()) { throw new IllegalArgumentException("请选择号码归属地"); }
    }
    return callingCode;
  }
  private long insert(String sql, Object... args) {
    GeneratedKeyHolder key = new GeneratedKeyHolder();
    jdbc.update(connection -> {
      var statement = connection.prepareStatement(sql,java.sql.Statement.RETURN_GENERATED_KEYS);
      try {
        for (int n=0;n<args.length;n++) { statement.setObject(n+1,args[n]); }
        return statement;
      } catch (SQLException exception) {
        try { statement.close(); } catch (SQLException closeException) { exception.addSuppressed(closeException); }
        throw exception;
      }
    },key);
    return Objects.requireNonNull(key.getKey()).longValue();
  }
  public List<Owner> ownerCandidates(Long customerId) {
    if (customerId == null) { permission("daily","create"); }
    else {
      Customer c=accessible(customerId,false);
      permission(c.status(),"edit");
    }
    return validOwnerCandidates(identity());
  }
  private List<Owner> validOwnerCandidates(CurrentIdentity i) {
    return jdbc.query("""
        SELECT DISTINCT a.id,a.display_name FROM accounts a
        JOIN account_identities ai ON ai.account_id=a.id
        LEFT JOIN employees e ON ai.identity_type='employee' AND ai.subject_id=e.id
        WHERE a.status='enabled' AND ai.client_code='admin' AND ai.status='enabled'
          AND ai.tenant_id=? AND ai.store_id=?
          AND (ai.identity_type='store_admin'
            OR (ai.identity_type='employee' AND e.status='enabled' AND e.account_id=a.id
              AND e.tenant_id=ai.tenant_id AND e.store_id=ai.store_id AND e.client_code=ai.client_code))
        ORDER BY a.display_name,a.id
        """, (rs,n) -> new Owner(number(rs,"id"),rs.getString("display_name"),true),
        i.tenantId(),i.storeId());
  }
  public List<Owner> owners(String status) {
    permission(status,"view"); CurrentIdentity i=identity();
    return jdbc.query("""
        SELECT DISTINCT a.id,a.display_name,
        EXISTS(SELECT 1 FROM account_identities ai LEFT JOIN employees e ON ai.identity_type='employee' AND ai.subject_id=e.id
          WHERE a.status='enabled' AND ai.account_id=a.id AND ai.store_id=? AND ai.tenant_id=? AND ai.status='enabled'
          AND ai.client_code='admin' AND (ai.identity_type='store_admin' OR (ai.identity_type='employee' AND e.status='enabled' AND e.account_id=a.id AND e.store_id=ai.store_id AND e.tenant_id=ai.tenant_id AND e.client_code=ai.client_code))) active
        FROM accounts a WHERE a.id IN (
          SELECT account_id FROM account_identities WHERE store_id=? AND tenant_id=? AND client_code='admin'
          UNION SELECT owner_account_id FROM store_customers WHERE store_id=? AND tenant_id=?)
        ORDER BY a.display_name,a.id
        """,(rs,n) -> new Owner(number(rs,"id"),rs.getString("display_name"),rs.getBoolean("active")),
        i.storeId(),i.tenantId(),i.storeId(),i.tenantId(),i.storeId(),i.tenantId());
  }
  @Transactional
  public void action(CustomerRequests.Action request, boolean batch) {
    if (!batch && "assign".equals(request.action())) {
      throw new IllegalArgumentException("请通过编辑客户修改归属人");
    }
    String operation = (batch ? "batch-" : "") + request.action();
    permission(request.status(),operation);
    List<Long> ids=request.ids().stream().distinct().sorted().toList();
    if (ids.isEmpty() || (!batch && ids.size()!=1) || ids.size()!=request.ids().size()) {
      throw new IllegalArgumentException("请选择有效的客户档案");
    }
    List<Customer> records=new ArrayList<>();
    for (Long id:ids) {
      Customer c=accessible(id,true);
      if (!request.status().equals(c.status())) { throw new IllegalArgumentException("客户状态已变化，请刷新后重试"); }
      records.add(c);
    }
    if ("assign".equals(request.action()) && owners(request.status()).stream()
        .noneMatch(o -> o.active() && Objects.equals(o.accountId(),request.ownerAccountId()))) {
      throw new IllegalArgumentException("请选择本门店有效的归属人");
    }
    if ("archive".equals(request.action()) && !"daily".equals(request.status())
        || List.of("restore","purge").contains(request.action()) && !"archived".equals(request.status())) {
      throw new IllegalArgumentException("当前客户状态不允许此操作");
    }
    for (Customer c:records) {
      switch(request.action()) {
        case "assign" -> jdbc.update("UPDATE store_customers SET owner_account_id=?,status='daily',archived_at=NULL WHERE id=?",request.ownerAccountId(),c.id());
        case "archive" -> jdbc.update("UPDATE store_customers SET status='archived',archived_at=NOW() WHERE id=?",c.id());
        case "restore" -> jdbc.update("UPDATE store_customers SET status='daily',archived_at=NULL WHERE id=?",c.id());
        case "purge" -> {
          for (Long f:jdbc.queryForList("SELECT id FROM store_customer_followups WHERE customer_id=? ORDER BY id",Long.class,c.id())) {
            references.removeBusiness(DOMAIN,f,"客户档案彻底删除");
          }
          jdbc.update("DELETE FROM store_customer_followups WHERE customer_id=?",c.id());
          jdbc.update("DELETE FROM store_customers WHERE id=?",c.id());
        }
        default -> throw new IllegalArgumentException("操作不正确");
      }
    }
  }
  @Transactional
  public void saveFollowup(Long customerId, Long id, CustomerRequests.Followup p) {
    Customer c=accessible(customerId,true); permission(c.status(),"detail");
    if (p.mediaIds().stream().distinct().count()!=p.mediaIds().size()) { throw new IllegalArgumentException("附件不能重复"); }
    for (Long mediaId:p.mediaIds()) {
      MediaAsset a=media.requireAvailableForUpdate(mediaId);
      if (!"private".equals(a.getAccessLevel()) || a.getFileSize()>FILE_LIMIT
          || !Objects.equals(a.getStoreId(),c.storeId()) || !Objects.equals(a.getTenantId(),c.tenantId())) {
        throw new IllegalArgumentException("附件不可用");
      }
      boolean linked= id!=null && attachments(id).stream().anyMatch(x -> x.mediaId().equals(mediaId));
      if (!linked && (!Objects.equals(a.getCreatedByAccountId(),identity().accountId()) || !"temporary".equals(a.getStatus()))) {
        throw new IllegalArgumentException("附件不可用");
      }
    }
    if (id==null) {
      id=insert("INSERT INTO store_customer_followups(customer_id,followed_at,content,next_follow_at,next_follow_task,created_by_account_id) VALUES (?,?,?,?,?,?)",
          customerId,p.followedAt(),text(p.content()),p.nextFollowAt(),text(p.nextFollowTask()),identity().accountId());
    } else {
      requireFollowup(customerId,id);
      jdbc.update("UPDATE store_customer_followups SET followed_at=?,content=?,next_follow_at=?,next_follow_task=? WHERE id=?",
          p.followedAt(),text(p.content()),p.nextFollowAt(),text(p.nextFollowTask()),id);
    }
    Map<String,Long> fields=new LinkedHashMap<>();
    for (int n=0;n<p.mediaIds().size();n++) { fields.put("attachment"+n,p.mediaIds().get(n)); }
    references.replace(DOMAIN,id,fields);
  }
  private void requireFollowup(Long customerId, Long id) {
    if (!Boolean.TRUE.equals(jdbc.queryForObject("SELECT COUNT(*)=1 FROM store_customer_followups WHERE id=? AND customer_id=?",Boolean.class,id,customerId))) {
      throw new IllegalArgumentException("跟进记录不存在");
    }
  }
  @Transactional
  public void deleteFollowup(Long customerId, Long id) {
    Customer c=accessible(customerId,true); permission(c.status(),"detail"); requireFollowup(customerId,id);
    references.removeBusiness(DOMAIN,id,"跟进记录删除");
    jdbc.update("DELETE FROM store_customer_followups WHERE id=?",id);
  }
  public void requireUpload(Long customerId) {
    Customer c=accessible(customerId,false); permission(c.status(),"detail");
  }
  @Transactional
  public void releaseUpload(Long customerId,Long mediaId) {
    requireUpload(customerId); MediaAsset a=media.requireAvailableForUpdate(mediaId);
    if (!Objects.equals(a.getCreatedByAccountId(),identity().accountId()) || !"private".equals(a.getAccessLevel()) || !"temporary".equals(a.getStatus())) {
      throw new AccessDeniedException("无权释放该附件");
    }
    cleanup.enqueueAfterCommit(List.of(mediaId),"取消客户跟进附件上传");
  }
  public MediaAsset readAttachment(Long customerId,Long followupId,Long mediaId) {
    Customer c=accessible(customerId,false); permission(c.status(),"detail"); requireFollowup(customerId,followupId);
    if (attachments(followupId).stream().noneMatch(a -> a.mediaId().equals(mediaId))) { throw new AccessDeniedException("附件不可用"); }
    return media.requireAvailable(mediaId);
  }
}
