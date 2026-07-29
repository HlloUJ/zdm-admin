package com.zdm.platform;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.greaterThanOrEqualTo;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.zdm.platform.security.TokenAuthenticationFilter;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.testcontainers.containers.MySQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@SpringBootTest
@AutoConfigureMockMvc
@Testcontainers(disabledWithoutDocker = true)
class PlatformApiSmokeTest {
  @Container
  private static final MySQLContainer<?> MYSQL = new MySQLContainer<>("mysql:8.0")
      .withDatabaseName("zdm_admin_test")
      .withUsername("zdm_admin")
      .withPassword("zdm_admin_pwd");

  @Autowired
  private MockMvc mockMvc;

  @Autowired
  private JdbcTemplate jdbcTemplate;

  @DynamicPropertySource
  static void registerDatasource(DynamicPropertyRegistry registry) {
    registry.add("spring.datasource.url", MYSQL::getJdbcUrl);
    registry.add("spring.datasource.username", MYSQL::getUsername);
    registry.add("spring.datasource.password", MYSQL::getPassword);
  }

  @Test
  void flywayMigrationsSeedSuperAdmin() {
    Integer migrationCount = jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM flyway_schema_history WHERE success = 1",
        Integer.class);
    Integer superAdminCount = jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM accounts WHERE phone = '15926626945' AND status = 'enabled'",
        Integer.class);

    assertThat(migrationCount).isGreaterThanOrEqualTo(18);
    assertThat(superAdminCount).isEqualTo(1);
  }

  @Test
  void protectedAdminApiRequiresAuthentication() throws Exception {
    mockMvc.perform(get("/api/admin/tenants"))
        .andExpect(status().isUnauthorized());
  }

  @Test
  void superAdminCanLoginAndAccessTenantApi() throws Exception {
    mockMvc.perform(post("/api/admin/auth/login")
            .contentType("application/json")
            .content("""
                {
                  "phone": "15926626945",
                  "verifyCode": "888888"
                }
                """))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.code").value(0))
        .andExpect(jsonPath("$.data.token").value(TokenAuthenticationFilter.createAccountToken(1L)))
        .andExpect(jsonPath("$.data.user.phone").value("15926626945"));

    mockMvc.perform(get("/api/admin/tenants")
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.code").value(0))
        .andExpect(jsonPath("$.data.length()", greaterThanOrEqualTo(1)));
  }

  @Test
  void employeeInviteRegistrationRequiresAdminActivation() throws Exception {
    MvcResult inviteResult = mockMvc.perform(post("/api/admin/employee-invites")
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.code").value(0))
        .andExpect(jsonPath("$.data.token").isString())
        .andReturn();

    String token = com.jayway.jsonpath.JsonPath.read(
        inviteResult.getResponse().getContentAsString(),
        "$.data.token");

    mockMvc.perform(post("/api/open/employee-invites/{token}/verify-code", token)
            .contentType("application/json")
            .content("""
                {
                  "phone": "15926629999",
                  "verifyCode": "123456"
                }
                """))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("验证码错误"));

    MvcResult registerResult = mockMvc.perform(post("/api/open/employee-invites/{token}/register", token)
            .contentType("application/json")
            .content("""
                {
                  "phone": "15926629999",
                  "verifyCode": "888888",
                  "name": "待审核员工",
                  "gender": "male"
                }
                """))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.status").value("disabled"))
        .andReturn();

    String employeeId = com.jayway.jsonpath.JsonPath.read(
        registerResult.getResponse().getContentAsString(),
        "$.data.employeeId")
        .toString();

    mockMvc.perform(get("/api/admin/employees")
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data[?(@.phone == '15926629999')][0].inviterName").value("韩健"));

    String inviterName = jdbcTemplate.queryForObject(
        "SELECT inviter_name FROM employees WHERE id = ?",
        String.class,
        Long.valueOf(employeeId));
    assertThat(inviterName).isEqualTo("韩健");

    mockMvc.perform(get("/api/open/employee-invites/{token}", token))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("邀请链接已使用"));

    mockMvc.perform(post("/api/admin/auth/login")
            .contentType("application/json")
            .content("""
                {
                  "phone": "15926629999",
                  "verifyCode": "888888"
                }
                """))
        .andExpect(status().isBadRequest());

    mockMvc.perform(put("/api/admin/employees/{id}", employeeId)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
            .contentType("application/json")
            .content("""
                {
                  "name": "待审核员工",
                  "gender": "male",
                  "phone": "15926629999",
                  "status": "enabled",
                  "roleIds": "",
                  "dataPermission": "",
                  "remark": ""
                }
                """))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("请先为员工配置角色后再启用"));

    mockMvc.perform(put("/api/admin/employees/{id}", employeeId)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
            .contentType("application/json")
            .content("""
                {
                  "name": "待审核员工",
                  "gender": "male",
                  "phone": "15926629999",
                  "status": "enabled",
                  "roleIds": "1",
                  "dataPermission": "all",
                  "remark": ""
                }
                """))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.status").value("enabled"));

    mockMvc.perform(post("/api/admin/auth/login")
            .contentType("application/json")
            .content("""
                {
                  "phone": "15926629999",
                  "verifyCode": "888888"
                }
                """))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.user.phone").value("15926629999"));
  }

  @Test
  void tenantCrudPersistsThroughApi() throws Exception {
    MvcResult createResult = mockMvc.perform(post("/api/admin/tenants")
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
            .contentType("application/json")
            .content("""
                {
                  "name": "集成测试租户",
                  "contactName": "测试联系人",
                  "contactPhone": "15926626946",
                  "status": "enabled",
                  "businessTypes": "cityPartner",
                  "remark": "API smoke"
                }
                """))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.code").value(0))
        .andExpect(jsonPath("$.data.id").isNumber())
        .andReturn();

    String tenantId = com.jayway.jsonpath.JsonPath.read(
        createResult.getResponse().getContentAsString(),
        "$.data.id")
        .toString();

    mockMvc.perform(put("/api/admin/tenants/{id}", tenantId)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
            .contentType("application/json")
            .content("""
                {
                  "name": "集成测试租户-已更新",
                  "contactName": "测试联系人",
                  "contactPhone": "15926626946",
                  "status": "enabled",
                  "businessTypes": "cityPartner",
                  "remark": "API smoke updated"
                }
                """))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.name").value("集成测试租户-已更新"));
  }

  @Test
  void tenantValidationReturnsBadRequest() throws Exception {
    mockMvc.perform(post("/api/admin/tenants")
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
            .contentType("application/json")
            .content("""
                {
                  "name": "",
                  "contactName": "测试联系人",
                  "contactPhone": "123",
                  "status": "enabled"
                }
                """))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value(400));
  }
}
