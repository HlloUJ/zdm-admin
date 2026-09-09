package com.zdm.platform.catalog;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.zdm.platform.security.CurrentIdentity;
import com.zdm.platform.security.CurrentIdentityProvider;
import com.zdm.platform.security.PermissionGuard;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.AccessDeniedException;

class TemplateVersionPermissionTest {
  @Test
  @SuppressWarnings("unchecked")
  void viewPermissionCannotReorderPublishedAttributes() {
    JdbcTemplate jdbc = mock(JdbcTemplate.class);
    ProductCategoryService categories = mock(ProductCategoryService.class);
    ProductCategory category = new ProductCategory();
    category.setId(1L);
    category.setScope("finished");
    when(categories.getById(1L)).thenReturn(category);
    CurrentIdentityProvider identity = mock(CurrentIdentityProvider.class);
    when(identity.require()).thenReturn(new CurrentIdentity(1L, 1L, 1L, 1L, "admin", null, null,
        "测试", "all", List.of(), List.of("admin.product-data-center.category-attribute-template.finished.attributes.view")));
    TemplateVersion version = new TemplateVersion(1L, 1L, 1, "published", 0,
        new ObjectMapper().createArrayNode(), "测试", "测试", "", null, null);
    when(jdbc.query(org.mockito.ArgumentMatchers.anyString(),
        org.mockito.ArgumentMatchers.<org.springframework.jdbc.core.RowMapper<TemplateVersion>>any(),
        org.mockito.ArgumentMatchers.eq(1L))).thenReturn(List.of(version));
    TemplateVersionService service = new TemplateVersionService(jdbc, new ObjectMapper(), new PermissionGuard(identity),
        categories, mock(ProductAttributeService.class), mock(ProductAttributeValueService.class));
    assertThatThrownBy(() -> service.reorder(1L, 0, List.of())).isInstanceOf(AccessDeniedException.class);
    org.mockito.Mockito.verify(jdbc, org.mockito.Mockito.never()).update(
        org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.<Object[]>any());
  }

  @Test
  void scopesAndInnerTabsAreIndependent() {
    JdbcTemplate jdbc = mock(JdbcTemplate.class);
    ProductCategoryService categories = mock(ProductCategoryService.class);
    ProductCategory finished = new ProductCategory();
    finished.setId(1L);
    finished.setScope("finished");
    ProductCategory accessory = new ProductCategory();
    accessory.setId(2L);
    accessory.setScope("accessory");
    when(categories.getById(1L)).thenReturn(finished);
    when(categories.getById(2L)).thenReturn(accessory);
    CurrentIdentityProvider identity = mock(CurrentIdentityProvider.class);
    when(identity.require()).thenReturn(new CurrentIdentity(1L, 1L, 1L, 1L, "admin", null, null,
        "测试", "all", List.of(), List.of("admin.product-data-center.category-attribute-template.finished.attributes.view")));
    TemplateVersionService service = new TemplateVersionService(jdbc, new ObjectMapper(), new PermissionGuard(identity),
        categories, mock(ProductAttributeService.class), mock(ProductAttributeValueService.class));
    assertThatThrownBy(() -> service.list(2L)).isInstanceOf(AccessDeniedException.class);
    assertThatThrownBy(() -> service.create(1L)).isInstanceOf(AccessDeniedException.class);
    verifyNoInteractions(jdbc);
  }

  @Test
  void evenBroadPermissionsCannotWritePublicTemplatesAsAnOrganization() {
    JdbcTemplate jdbc = mock(JdbcTemplate.class);
    ProductCategoryService categories = mock(ProductCategoryService.class);
    ProductCategory category = new ProductCategory();
    category.setId(1L);
    category.setScope("finished");
    when(categories.getById(1L)).thenReturn(category);
    CurrentIdentityProvider identity = mock(CurrentIdentityProvider.class);
    when(identity.require()).thenReturn(new CurrentIdentity(1L, 1L, 1L, 1L, "supplier", 10L, 20L,
        "测试", "all", List.of(), List.of("all")));
    TemplateVersionService service = new TemplateVersionService(jdbc, new ObjectMapper(), new PermissionGuard(identity),
        categories, mock(ProductAttributeService.class), mock(ProductAttributeValueService.class));
    assertThatThrownBy(() -> service.create(1L)).isInstanceOf(AccessDeniedException.class);
    category.setTenantId(10L);
    assertThatThrownBy(() -> service.list(1L)).isInstanceOf(AccessDeniedException.class);
    verifyNoInteractions(jdbc);
  }
  @Test
  @SuppressWarnings("unchecked")
  void createPermissionIncludesAllDraftWritesButNotHistory() {
    JdbcTemplate jdbc = mock(JdbcTemplate.class);
    ProductCategoryService categories = mock(ProductCategoryService.class);
    ProductCategory category = new ProductCategory();
    category.setId(1L);
    category.setScope("finished");
    category.setStatus("enabled");
    when(categories.getById(1L)).thenReturn(category);
    CurrentIdentityProvider identity = mock(CurrentIdentityProvider.class);
    String prefix = "admin.product-data-center.category-attribute-template.finished.attributes.";
    when(identity.require()).thenReturn(new CurrentIdentity(1L, 1L, 1L, 1L, "admin", null, null,
        "测试", "all", List.of(), List.of(prefix + "view", prefix + "create")));
    ObjectMapper json = new ObjectMapper();
    TemplateVersion draft = new TemplateVersion(3L, 1L, null, "draft", 0,
        json.createArrayNode(), "测试", null, "", null, null);
    TemplateVersion old = new TemplateVersion(1L, 1L, 1, "published", 0,
        json.createArrayNode(), "测试", "测试", "", null, null);
    TemplateVersion latest = new TemplateVersion(2L, 1L, 2, "published", 0,
        json.createArrayNode(), "测试", "测试", "", null, null);
    when(jdbc.query(org.mockito.ArgumentMatchers.anyString(),
        org.mockito.ArgumentMatchers.<org.springframework.jdbc.core.RowMapper<TemplateVersion>>any(),
        org.mockito.ArgumentMatchers.eq(3L))).thenReturn(List.of(draft));
    when(jdbc.query(org.mockito.ArgumentMatchers.anyString(),
        org.mockito.ArgumentMatchers.<org.springframework.jdbc.core.RowMapper<TemplateVersion>>any(),
        org.mockito.ArgumentMatchers.eq(1L))).thenReturn(List.of(old, latest, draft));
    TemplateVersionService service = new TemplateVersionService(jdbc, json, new PermissionGuard(identity),
        categories, mock(ProductAttributeService.class), mock(ProductAttributeValueService.class));
    org.assertj.core.api.Assertions.assertThat(service.list(1L)).containsExactly(latest, draft);
    when(jdbc.queryForObject(org.mockito.ArgumentMatchers.anyString(),
        org.mockito.ArgumentMatchers.eq(Integer.class), org.mockito.ArgumentMatchers.eq(1L))).thenReturn(2);
    assertThatThrownBy(() -> service.get(1L)).isInstanceOf(AccessDeniedException.class);
    service.save(3L, new TemplateVersionRequest(0, json.createArrayNode(), ""));
    assertThatThrownBy(() -> service.publish(3L, 0)).isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("请先绑定属性");
    service.discard(3L, 0);
    when(identity.require()).thenReturn(new CurrentIdentity(1L, 1L, 1L, 1L, "admin", null, null,
        "测试", "all", List.of(), List.of(prefix + "view", prefix + "history")));
    org.assertj.core.api.Assertions.assertThat(service.list(1L)).containsExactly(old, latest);
    org.assertj.core.api.Assertions.assertThat(service.get(1L)).isEqualTo(old);
    assertThatThrownBy(() -> service.get(3L)).isInstanceOf(AccessDeniedException.class);
    assertThatThrownBy(() -> service.save(3L, new TemplateVersionRequest(0, json.createArrayNode(), "")))
        .isInstanceOf(AccessDeniedException.class);
  }

}
