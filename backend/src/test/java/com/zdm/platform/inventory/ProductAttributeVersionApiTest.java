package com.zdm.platform.inventory;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.zdm.platform.security.CurrentIdentity;
import com.zdm.platform.support.SpringContainerTestSupport;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;
import org.testcontainers.containers.MySQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@SpringBootTest
@AutoConfigureMockMvc(addFilters = false)
@Testcontainers(disabledWithoutDocker = true)
@Transactional
class ProductAttributeVersionApiTest extends SpringContainerTestSupport {
  @Container private static final MySQLContainer<?> MYSQL = com.zdm.platform.support.MySqlTestDatabase.create()
      .withDatabaseName("product_versions_test").withUsername("test").withPassword("test");
  @DynamicPropertySource static void database(DynamicPropertyRegistry registry) {
    registry.add("spring.datasource.url", MYSQL::getJdbcUrl);
    registry.add("spring.datasource.username", MYSQL::getUsername);
    registry.add("spring.datasource.password", MYSQL::getPassword);
  }
  @Autowired private MockMvc mvc;
  @Autowired private JdbcTemplate jdbc;
  @Autowired private ObjectMapper json;
  @AfterEach void clear() { SecurityContextHolder.clearContext(); }
  private String endpoint(String scope) { return "/api/admin/" + scope + "-products"; }
  private void identity(String client) {
    var user = new CurrentIdentity(1L,1L,1L,1L,client,null,null,"版本测试","all",List.of("OPERATOR"),List.of("all"));
    SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(user,null,List.of()));
  }
  private ObjectNode fixture(String scope) throws Exception {
    identity("supply-chain");
    jdbc.update("INSERT INTO product_categories(id,name,scope,created_by_account_id) VALUES(99010,'版本类目',?,1)",scope);
    jdbc.update("INSERT INTO suppliers(id,name,owner_scope,owner_id,created_by_account_id) VALUES(99010,'版本供应商','platform',0,1)");
    jdbc.update("INSERT INTO supplier_supply_type_links(supplier_id,supply_type_id) VALUES(99010,?)","finished".equals(scope)?2:3);
    jdbc.update("UPDATE stores SET store_level_id=NULL");
    jdbc.update("UPDATE store_levels SET status='disabled'");
    jdbc.update("INSERT INTO product_attributes(id,scope,name,value_type,attribute_role) VALUES(53,'shared','历史数字','number','product'),(57,'shared','历史销售名称','select','sales')");
    jdbc.update("INSERT INTO category_template_versions(id,category_id,version_no,state,revision,content,created_by_account_id) VALUES(99011,99010,1,'published',2,?,1)","""
        [{"attributeId":53,"name":"历史数字","attributeRole":"product","valueType":"number","requiredFlag":true,"sortOrder":1,"options":[]},
         {"attributeId":57,"name":"历史销售名称","attributeRole":"sales","valueType":"select","requiredFlag":true,"sortOrder":2,"options":[{"value":"旧选项"}]}]
        """);
    var p=(ObjectNode)json.readTree("""
        {"categoryId":99010,"supplierId":99010,"name":"版本商品","detail":"<p>版本资料</p>","status":"warehouse",
         "templateVersionId":99011,"templateRevision":2,"attributeDisplayOrder":{"product":["53"],"sales":["attribute_57"]},
         "attributes":[{"attributeId":53,"attributeName":"历史数字","value":"12"}],
         "variants":[{"variantLabel":"规格","displayMode":"single","salesAttributes":{"attribute_57":"旧选项"},"stock":3,"costPrice":10}]}
        """);
    for(String type:List.of("image/png","video/webm")) {
      var result=mvc.perform(multipart(endpoint(scope)+"/media").file(new MockMultipartFile("file","fixture",type,new byte[]{1,2,3}))).andExpect(status().isOk()).andReturn();
      p.put(type.startsWith("image")?"mainImageMediaId":"videoMediaId",json.readTree(result.getResponse().getContentAsByteArray()).path("data").path("id").asLong());
    }
    return p;
  }
  private ObjectNode create(String scope,ObjectNode payload) throws Exception {
    return (ObjectNode)json.readTree(mvc.perform(post(endpoint(scope)).contentType("application/json").content(json.writeValueAsBytes(payload))).andExpect(status().isOk()).andReturn().getResponse().getContentAsByteArray()).path("data");
  }
  @ParameterizedTest @ValueSource(strings={"finished","accessory"})
  void editAndReadKeepV1AfterV2AndPublishedSortingChange(String scope) throws Exception {
    var request=fixture(scope); ((ObjectNode)request.path("attributes").get(0)).put("value"," 12 ");
    var original=create(scope,request); long id=original.path("id").asLong();
    assertThat(original.path("attributes").get(0).path("value").asText()).isEqualTo("12");
    jdbc.update("INSERT INTO category_template_versions(id,category_id,version_no,state,content,created_by_account_id) VALUES(99012,99010,2,'published','[{\"attributeId\":58,\"name\":\"新字段\",\"attributeRole\":\"sales\"}]',1)");
    jdbc.update("UPDATE category_template_versions SET revision=3,content=JSON_ARRAY(JSON_EXTRACT(content,'$[1]'),JSON_EXTRACT(content,'$[0]')) WHERE id=99011");
    jdbc.update("UPDATE product_attributes SET name='当前新名称',status='disabled' WHERE id=53");
    var edited=(ObjectNode)original.deepCopy();edited.put("name","只改名称");edited.set("attributeTemplateSnapshot",json.readTree("[{\"attributeId\":58}]"));
    mvc.perform(put(endpoint(scope)+"/{id}/edit",id).contentType("application/json").content(json.writeValueAsBytes(edited)))
        .andExpect(status().isOk()).andExpect(jsonPath("$.data.templateVersionId").value(99011))
        .andExpect(jsonPath("$.data.templateRevision").value(2))
        .andExpect(jsonPath("$.data.attributeTemplateSnapshot[0].attributeId").value(53))
        .andExpect(jsonPath("$.data.attributes[0].attributeName").value("历史数字"));
    identity("admin");jdbc.update("UPDATE "+scope+"_products SET operations_deleted=FALSE WHERE id=?",id);
    mvc.perform(get(endpoint(scope)+"/{id}",id)).andExpect(status().isOk()).andExpect(jsonPath("$.data.templateVersionId").value(99011));
  }
  @ParameterizedTest @ValueSource(strings={"finished","accessory"})
  void requiresAccessiblePublishedCategoryVersionAndExactRevision(String scope) throws Exception {
    var payload=fixture(scope);payload.put("templateRevision",1);
    mvc.perform(post(endpoint(scope)).contentType("application/json").content(json.writeValueAsBytes(payload))).andExpect(status().isBadRequest());
    payload.put("templateRevision",2).put("templateVersionId",99999);
    mvc.perform(post(endpoint(scope)).contentType("application/json").content(json.writeValueAsBytes(payload))).andExpect(status().isBadRequest());
    jdbc.update("INSERT INTO product_categories(id,name,scope,created_by_account_id) VALUES(99020,'另一类目',?,1)",scope);
    jdbc.update("INSERT INTO category_template_versions(id,category_id,version_no,state,content,created_by_account_id) VALUES(99021,99020,1,'published','[]',1)");
    payload.put("templateVersionId",99021).put("templateRevision",0);
    mvc.perform(post(endpoint(scope)).contentType("application/json").content(json.writeValueAsBytes(payload))).andExpect(status().isBadRequest());
    jdbc.update("UPDATE category_template_versions SET created_by_account_id=2 WHERE id=99011");
    var self = new CurrentIdentity(1L,1L,1L,1L,"supply-chain",null,null,"本人范围","self",List.of("OPERATOR"),List.of("all"));
    SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(self,null,List.of()));
    payload.put("templateVersionId",99011).put("templateRevision",2);
    mvc.perform(post(endpoint(scope)).contentType("application/json").content(json.writeValueAsBytes(payload))).andExpect(status().isBadRequest());
    payload.remove("templateVersionId");
    mvc.perform(post(endpoint(scope)).contentType("application/json").content(json.writeValueAsBytes(payload))).andExpect(status().isBadRequest());
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM "+scope+"_products WHERE category_id=99010",Long.class)).isZero();
  }
  @ParameterizedTest @ValueSource(strings={"finished","accessory"})
  void oldInvalidValuesCanStayButModifiedValuesAndVersionTamperingAreRejected(String scope) throws Exception {
    var original=create(scope,fixture(scope));long id=original.path("id").asLong();
    jdbc.update("UPDATE "+scope+"_product_attribute_entries SET value=' 历史文本 ' WHERE "+scope+"_product_id=?",id);
    ((ObjectNode)original.path("attributes").get(0)).put("value"," 历史文本 ");
    mvc.perform(put(endpoint(scope)+"/{id}/edit",id).contentType("application/json").content(json.writeValueAsBytes(original))).andExpect(status().isOk());
    original.put("templateVersionId",99012);
    mvc.perform(put(endpoint(scope)+"/{id}/edit",id).contentType("application/json").content(json.writeValueAsBytes(original))).andExpect(status().isBadRequest());
    original.put("templateVersionId",99011);((ObjectNode)original.path("attributes").get(0)).put("value","新的文本");
    mvc.perform(put(endpoint(scope)+"/{id}/edit",id).contentType("application/json").content(json.writeValueAsBytes(original))).andExpect(status().isBadRequest());
    assertThat(jdbc.queryForObject("SELECT value FROM "+scope+"_product_attribute_entries WHERE "+scope+"_product_id=?",String.class,id)).isEqualTo(" 历史文本 ");
  }
  @ParameterizedTest @ValueSource(strings={"finished","accessory"})
  void newPrecisionRejectsInvalidWritesWithoutChangingHistoricalValuesOrLogs(String scope) throws Exception {
    var request=fixture(scope);
    ((ObjectNode)request.path("attributes").get(0)).put("value","1.234");
    mvc.perform(post(endpoint(scope)).contentType("application/json").content(json.writeValueAsBytes(request)))
        .andExpect(status().isBadRequest()).andExpect(jsonPath("$.message").value("历史数字最多输入两位小数"));
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM "+scope+"_products",Long.class)).isZero();
    ((ObjectNode)request.path("attributes").get(0)).put("value","12.50");
    var product=create(scope,request);long id=product.path("id").asLong();
    jdbc.update("UPDATE "+scope+"_product_attribute_entries SET value=' 1.2345 ' WHERE "+scope+"_product_id=?",id);
    ((ObjectNode)product.path("attributes").get(0)).put("value"," 1.2345 ");
    mvc.perform(put(endpoint(scope)+"/{id}/edit",id).contentType("application/json").content(json.writeValueAsBytes(product)))
        .andExpect(status().isOk());
    long logs=jdbc.queryForObject("SELECT COUNT(*) FROM "+scope+"_operation_logs WHERE product_id=?",Long.class,id);
    ((ObjectNode)product.path("attributes").get(0)).put("value","2.345");
    mvc.perform(put(endpoint(scope)+"/{id}/edit",id).contentType("application/json").content(json.writeValueAsBytes(product)))
        .andExpect(status().isBadRequest()).andExpect(jsonPath("$.message").value("历史数字最多输入两位小数"));
    assertThat(jdbc.queryForObject("SELECT value FROM "+scope+"_product_attribute_entries WHERE "+scope+"_product_id=?",String.class,id)).isEqualTo(" 1.2345 ");
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM "+scope+"_operation_logs WHERE product_id=?",Long.class,id)).isEqualTo(logs);
  }

}
