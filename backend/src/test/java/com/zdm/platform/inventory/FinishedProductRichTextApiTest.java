package com.zdm.platform.inventory;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.zdm.platform.security.TokenAuthenticationFilter;
import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.testcontainers.containers.MySQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@SpringBootTest
@AutoConfigureMockMvc
@Testcontainers(disabledWithoutDocker = true)
class FinishedProductRichTextApiTest {
  @Container
  private static final MySQLContainer<?> MYSQL = new MySQLContainer<>("mysql:8.0")
      .withDatabaseName("zdm_finished_rich_test").withUsername("zdm_admin").withPassword("zdm_admin_pwd");
  @Autowired private MockMvc mvc;
  @Autowired private JdbcTemplate jdbc;
  @Autowired private ObjectMapper json;
  private final String token = "Bearer " + TokenAuthenticationFilter.createAccountToken(1L);

  @DynamicPropertySource
  static void datasource(DynamicPropertyRegistry registry) {
    registry.add("spring.datasource.url", MYSQL::getJdbcUrl);
    registry.add("spring.datasource.username", MYSQL::getUsername);
    registry.add("spring.datasource.password", MYSQL::getPassword);
    registry.add("zdm.media.storage-path", () -> System.getProperty("java.io.tmpdir") + "/zdm-finished-rich-test");
  }

  @Test
  void roundTripsRichTextAndGalleryAndReleasesRemovedReferences() throws Exception {
    jdbc.update("INSERT INTO product_categories (id, scope, name) VALUES (99001, 'finished', '富文本验收分类')");
    jdbc.update("""
        INSERT INTO suppliers (id, owner_scope, owner_id, name)
        VALUES (99001, 'platform', 0, '富文本验收供应商')
        """);
    jdbc.update("INSERT INTO supplier_supply_type_links (supplier_id, supply_type_id) VALUES (99001, 2)");
    jdbc.update("UPDATE store_levels SET status = 'disabled'");
    List<JsonNode> images = new ArrayList<>();
    for (int i = 0; i < 6; i++) images.add(upload("image/png", "image.png"));
    JsonNode video = upload("video/webm", "video.webm");
    ObjectNode payload = (ObjectNode) json.readTree("""
        {"categoryId":99001,"supplierId":99001,"name":"富文本验收","sku":"rich-test",
         "status":"warehouse","attributes":[],
         "variants":[{"variantKey":"one","variantLabel":"规格","displayMode":"single","salesAttributes":{"attribute_99001":"胡桃木","attribute_99002":"大号"},"stock":0}],
         "guidePrices":[{"variantKey":"one","priceCoefficient":1,"costPrice":1,"price":1}]}
        """);
    payload.put("mainImageMediaId", images.getFirst().path("id").asLong());
    payload.set("mainImageMediaIds", json.valueToTree(images.subList(0, 5).stream().map(i -> i.path("id").asLong()).toList()));
    payload.put("videoMediaId", video.path("id").asLong());
    payload.put("detail", """
        <h2><strong>详情标题</strong></h2><p><span style="font-family:Arial;font-size:24px;color:red">材质</span>
        <a href="https://example.com">商品链接</a></p><img src="%s">
        <div data-w-e-type="video" data-w-e-is-void><video controls><source src="%s" type="video/mp4"></video></div>
        <table><tbody><tr><td>规格</td></tr></tbody></table>
        """.formatted(images.get(5).path("url").asText(), video.path("url").asText()));
    payload.put("createdByName", "伪造创建人");
    payload.put("createdByAccountId", 99999);
    payload.put("createdAt", "2000-01-01T00:00:00");
    LocalDateTime beforeCreate = LocalDateTime.now().minusSeconds(1);
    JsonNode created = data(mvc.perform(post("/api/admin/finished-products").header("Authorization", token)
        .contentType("application/json").content(json.writeValueAsBytes(payload))));
    long id = created.path("id").asLong();
    assertThat(id).isPositive();
    assertThat(created.path("createdByAccountId").asLong()).isEqualTo(1L);
    assertThat(created.path("createdByName").asText()).isNotBlank().isNotEqualTo("伪造创建人");
    assertThat(LocalDateTime.parse(created.path("createdAt").asText()))
        .isBetween(beforeCreate, LocalDateTime.now().plusSeconds(1));
    String stored = jdbc.queryForObject("SELECT detail FROM finished_products WHERE id = ?", String.class, id);
    assertThat(stored).contains("media:" + images.get(5).path("id").asLong()).doesNotContain("/api/open/media/");
    JsonNode reloaded = data(mvc.perform(get("/api/admin/finished-products").header("Authorization", token))).get(0);
    assertThat(reloaded.path("variants").get(0).path("salesAttributes").path("attribute_99001").asText()).isEqualTo("胡桃木");
    assertThat(reloaded.path("variants").get(0).path("salesAttributes").path("attribute_99002").asText()).isEqualTo("大号");
    ((ObjectNode) payload.path("variants").get(0).path("salesAttributes")).put("attribute_99001", "橡木");
    assertThat(reloaded.path("mainImageMediaIds").toString()).isEqualTo(payload.path("mainImageMediaIds").toString());
    assertThat(reloaded.path("detail").asText()).contains("font-family:Arial", "font-size:24px", "<strong>",
        "https://example.com", "<table>", images.get(5).path("url").asText(), video.path("url").asText());
    assertThat(referenceCount(id, "detailMedia%")).isEqualTo(2);
    payload.put("detail", "<p><em>更新后的详情</em></p>");
    payload.put("status", "recycle");
    JsonNode updated = data(mvc.perform(put("/api/admin/finished-products/{id}", id).header("Authorization", token)
        .contentType("application/json").content(json.writeValueAsBytes(payload))));
    assertThat(updated.path("createdByName")).isEqualTo(created.path("createdByName"));
    assertThat(updated.path("createdByAccountId")).isEqualTo(created.path("createdByAccountId"));
    assertThat(updated.path("createdAt")).isEqualTo(created.path("createdAt"));
    assertThat(updated.path("variants").get(0).path("salesAttributes").path("attribute_99001").asText()).isEqualTo("橡木");
    assertThat(updated.path("detail").asText()).contains("<em>更新后的详情</em>").doesNotContain("<img", "<video");
    assertThat(referenceCount(id, "detailMedia%")).isZero();
    assertThat(referenceCount(id, "%")).isEqualTo(6);
    data(mvc.perform(delete("/api/admin/finished-products/{id}", id).header("Authorization", token)));
    assertThat(referenceCount(id, "%")).isZero();
  }

  private long referenceCount(long id, String field) {
    return jdbc.queryForObject("""
        SELECT COUNT(*) FROM media_references
        WHERE business_domain = 'FINISHED_PRODUCT' AND business_id = ? AND field_key LIKE ?
        """, Long.class, id, field);
  }

  private JsonNode upload(String type, String name) throws Exception {
    return data(mvc.perform(multipart("/api/admin/finished-products/media")
        .file(new MockMultipartFile("file", name, type, "fixture-content".getBytes(StandardCharsets.UTF_8)))
        .header("Authorization", token)));
  }

  private JsonNode data(ResultActions result) throws Exception {
    JsonNode response = json.readTree(result.andExpect(status().isOk()).andReturn().getResponse().getContentAsByteArray());
    assertThat(response.path("code").asInt()).as(response.toString()).isZero();
    return response.path("data");
  }
}
