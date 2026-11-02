package com.zdm.platform.support;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;

/** Explicit published definitions for pre-existing product tests; never used by production code. */
public final class ProductAttributeVersionFixtures {
  private ProductAttributeVersionFixtures() {}
  public static ObjectNode bind(JdbcTemplate jdbc, ObjectMapper json, ObjectNode payload) { return bind(jdbc,json,payload,java.util.List.of()); }
  public static ObjectNode bind(JdbcTemplate jdbc, ObjectMapper json, ObjectNode payload, java.util.List<Long> extraFields) {
    if (payload.hasNonNull("templateVersionId")) { return payload; }
    Map<Long, ObjectNode> fields = new LinkedHashMap<>();
    for (JsonNode entry : payload.path("attributes")) {
      long id=entry.path("attributeId").asLong();
      var field=json.createObjectNode().put("attributeId",id).put("name",entry.path("attributeName").asText("历史属性"+id)).put("attributeRole","product").put("valueType","text").put("requiredFlag",false).put("skuFlag",false).put("sortOrder",fields.size()+1);
      field.putArray("options");fields.put(id,field);
    }
    for (JsonNode variant : payload.path("variants")) {
      variant.path("salesAttributes").fieldNames().forEachRemaining(key -> {
        if (!key.matches("attribute_[0-9]+")) { return; }
        long id=Long.parseLong(key.substring(10));
        if (fields.containsKey(id)) { return; }
        var names=jdbc.queryForList("SELECT name FROM product_attributes WHERE id=?",String.class,id);
        String name=names.isEmpty()?"历史销售属性"+id:names.getFirst();
        for(JsonNode dimension:payload.path("specDimensions")) { if(key.equals(dimension.path("key").asText())) { name=dimension.path("name").asText(); } }
        var field=json.createObjectNode().put("attributeId",id).put("name",name).put("attributeRole","sales").put("valueType","text").put("requiredFlag",false).put("skuFlag",true).put("sortOrder",fields.size()+1);
        field.putArray("options");fields.put(id,field);
      });
    }
    for(Long id:extraFields) {
      var definition=jdbc.queryForMap("SELECT name,attribute_role FROM product_attributes WHERE id=?",id);
      String name=(String)definition.get("name");
      String role="sales".equals(definition.get("attribute_role"))?"sales":"product";
      var field=json.createObjectNode().put("attributeId",id).put("name",name).put("attributeRole",role).put("valueType","text").put("requiredFlag",false).put("skuFlag","sales".equals(role)).put("sortOrder",fields.size()+1);
      field.putArray("options");fields.put(id,field);
    }
    var content=json.createArrayNode();fields.values().forEach(content::add);
    long category=payload.path("categoryId").asLong();
    int version=jdbc.queryForObject("SELECT COALESCE(MAX(version_no),0)+1 FROM category_template_versions WHERE category_id=?",Integer.class,category);
    jdbc.update("INSERT INTO category_template_versions(category_id,version_no,state,content,created_by_account_id) VALUES(?,?,'published',?,1)",category,version,content.toString());
    long id=jdbc.queryForObject("SELECT id FROM category_template_versions WHERE category_id=? AND version_no=?",Long.class,category,version);
    payload.put("templateVersionId",id).put("templateRevision",0);
    return payload;
  }
}
