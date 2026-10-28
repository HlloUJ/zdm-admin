package com.zdm.platform.inventory;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.zdm.platform.media.MediaAssetService;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;

/** Loads the data required by the accessory-stock list in batches, preserving detail response fields. */
final class AccessoryProductListDetails {
  private final AccessoryLifecycleService lifecycle;
  private final AccessoryProductPriceService priceService;
  private final AccessoryProductGuidePriceService guidePriceService;
  private final AccessoryProductVariantMapper variantMapper;
  private final AccessoryProductAttributeEntryMapper attributeEntryMapper;
  private final JdbcTemplate jdbcTemplate;
  private final MediaAssetService mediaAssetService;
  private final AccessoryProductDetailContent detailContent;

  AccessoryProductListDetails(AccessoryLifecycleService lifecycle, AccessoryProductPriceService priceService,
      AccessoryProductGuidePriceService guidePriceService, AccessoryProductVariantMapper variantMapper,
      AccessoryProductAttributeEntryMapper attributeEntryMapper, JdbcTemplate jdbcTemplate,
      MediaAssetService mediaAssetService) {
    this.lifecycle = lifecycle;
    this.priceService = priceService;
    this.guidePriceService = guidePriceService;
    this.variantMapper = variantMapper;
    this.attributeEntryMapper = attributeEntryMapper;
    this.jdbcTemplate = jdbcTemplate;
    this.mediaAssetService = mediaAssetService;
    this.detailContent = new AccessoryProductDetailContent(mediaAssetService);
  }

  List<AccessoryProduct> attach(List<AccessoryProduct> products) {
    if (products.isEmpty()) {
      return products;
    }
    List<Long> productIds = products.stream().map(AccessoryProduct::getId).toList();
    String placeholders = String.join(",", Collections.nCopies(productIds.size(), "?"));
    Map<Long, List<Long>> imageIdsByProduct = new HashMap<>();
    jdbcTemplate.query("""
        SELECT business_id, media_id FROM media_references
        WHERE business_domain = 'ACCESSORY_PRODUCT' AND business_id IN (%s)
          AND field_key IN ('mainImage', 'mainImage2', 'mainImage3', 'mainImage4', 'mainImage5')
        ORDER BY business_id, field_key
        """.replace("%s", placeholders), (RowCallbackHandler) row -> imageIdsByProduct
            .computeIfAbsent(row.getLong("business_id"), ignored -> new ArrayList<>())
            .add(row.getLong("media_id")), productIds.toArray());

    Map<Long, String> offShelfOperators = listOffShelfOperators(products);
    Map<Long, List<AccessoryProductPrice>> markupPrices = priceService.listPricesByProductIds(productIds);
    Map<Long, List<AccessoryProductGuidePrice>> guidePrices = guidePriceService.listPricesByProductIds(productIds);
    Map<Long, List<AccessoryProductVariant>> variants = variantMapper.selectList(
        Wrappers.lambdaQuery(AccessoryProductVariant.class)
            .in(AccessoryProductVariant::getAccessoryProductId, productIds)
            .orderByAsc(AccessoryProductVariant::getAccessoryProductId)
            .orderByAsc(AccessoryProductVariant::getId)).stream()
        .collect(Collectors.groupingBy(AccessoryProductVariant::getAccessoryProductId));
    Map<Long, List<AccessoryProductAttributeEntry>> attributes = attributeEntryMapper.selectList(
        Wrappers.lambdaQuery(AccessoryProductAttributeEntry.class)
            .in(AccessoryProductAttributeEntry::getAccessoryProductId, productIds)
            .orderByAsc(AccessoryProductAttributeEntry::getAccessoryProductId)
            .orderByAsc(AccessoryProductAttributeEntry::getId)).stream()
        .collect(Collectors.groupingBy(AccessoryProductAttributeEntry::getAccessoryProductId));

    Set<Long> mediaIds = new HashSet<>();
    products.forEach(product -> {
      mediaIds.addAll(imageIdsByProduct.getOrDefault(product.getId(), List.of()));
      if (product.getMainImageMediaId() != null) {
        mediaIds.add(product.getMainImageMediaId());
      }
      if (product.getVideoMediaId() != null) {
        mediaIds.add(product.getVideoMediaId());
      }
      mediaIds.addAll(detailContent.references(product.getDetail()).values());
    });
    Map<Long, String> mediaUrls = mediaAssetService.publicUrls(mediaIds);

    products.forEach(product -> {
      product.setOffShelfByName(offShelfOperators.get(product.getId()));
      List<Long> imageIds = imageIdsByProduct.getOrDefault(product.getId(), List.of());
      if (imageIds.isEmpty() && product.getMainImageMediaId() != null) {
        imageIds = List.of(product.getMainImageMediaId());
      }
      product.setMainImageMediaIds(imageIds);
      product.setMainImageUrls(imageIds.stream().map(mediaUrls::get).toList());
      product.setMainImageUrl(product.getMainImageMediaId() == null ? null
          : mediaUrls.get(product.getMainImageMediaId()));
      product.setVideoUrl(product.getVideoMediaId() == null ? null
          : mediaUrls.get(product.getVideoMediaId()));
      product.setDetail(detailContent.render(product.getDetail(), mediaUrls::get));
      product.setMarkupPrices(markupPrices.getOrDefault(product.getId(), List.of()));
      product.setGuidePrices(guidePrices.getOrDefault(product.getId(), List.of()));
      product.setVariants(variants.getOrDefault(product.getId(), List.of()));
      product.setAttributes(attributes.getOrDefault(product.getId(), List.of()));
    });
    return products;
  }

  private Map<Long, String> listOffShelfOperators(List<AccessoryProduct> products) {
    List<Long> offShelfIds = products.stream()
        .filter(product -> "warehouse".equals(lifecycle.isSupplyChain()
            ? product.getSourceStatus() : product.getStatus()))
        .map(AccessoryProduct::getId).toList();
    if (offShelfIds.isEmpty()) {
      return Map.of();
    }
    Object[] parameters = new Object[offShelfIds.size() + 1];
    parameters[0] = lifecycle.isSupplyChain() ? "supply-chain" : "admin";
    for (int index = 0; index < offShelfIds.size(); index++) {
      parameters[index + 1] = offShelfIds.get(index);
    }
    Map<Long, String> operators = new HashMap<>();
    jdbcTemplate.query("""
        SELECT product_id, operator_name FROM (
          SELECT product_id, operator_name,
            ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY operated_at DESC, id DESC) AS sequence_number
          FROM accessory_operation_logs
          WHERE business_client_code = ? AND operation_type = 'OFF_SHELF' AND product_id IN (%s)
        ) latest WHERE sequence_number = 1
        """.replace("%s", String.join(",", Collections.nCopies(offShelfIds.size(), "?"))),
        (RowCallbackHandler) row -> operators.put(row.getLong("product_id"), row.getString("operator_name")), parameters);
    return operators;
  }

}
