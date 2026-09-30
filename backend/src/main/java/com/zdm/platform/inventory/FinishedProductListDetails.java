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

/** Loads the data required by the finished-stock list in batches, preserving detail response fields. */
final class FinishedProductListDetails {
  private final ProductLifecycleService lifecycle;
  private final FinishedProductPriceService priceService;
  private final FinishedProductGuidePriceService guidePriceService;
  private final FinishedProductVariantMapper variantMapper;
  private final FinishedProductAttributeEntryMapper attributeEntryMapper;
  private final JdbcTemplate jdbcTemplate;
  private final MediaAssetService mediaAssetService;
  private final FinishedProductDetailContent detailContent;

  FinishedProductListDetails(ProductLifecycleService lifecycle, FinishedProductPriceService priceService,
      FinishedProductGuidePriceService guidePriceService, FinishedProductVariantMapper variantMapper,
      FinishedProductAttributeEntryMapper attributeEntryMapper, JdbcTemplate jdbcTemplate,
      MediaAssetService mediaAssetService) {
    this.lifecycle = lifecycle;
    this.priceService = priceService;
    this.guidePriceService = guidePriceService;
    this.variantMapper = variantMapper;
    this.attributeEntryMapper = attributeEntryMapper;
    this.jdbcTemplate = jdbcTemplate;
    this.mediaAssetService = mediaAssetService;
    this.detailContent = new FinishedProductDetailContent(mediaAssetService);
  }

  List<FinishedProduct> attach(List<FinishedProduct> products) {
    if (products.isEmpty()) {
      return products;
    }
    List<Long> productIds = products.stream().map(FinishedProduct::getId).toList();
    String placeholders = String.join(",", Collections.nCopies(productIds.size(), "?"));
    Map<Long, List<Long>> imageIdsByProduct = new HashMap<>();
    jdbcTemplate.query("""
        SELECT business_id, media_id FROM media_references
        WHERE business_domain = 'FINISHED_PRODUCT' AND business_id IN (%s)
          AND field_key IN ('mainImage', 'mainImage2', 'mainImage3', 'mainImage4', 'mainImage5')
        ORDER BY business_id, field_key
        """.replace("%s", placeholders), (RowCallbackHandler) row -> imageIdsByProduct
            .computeIfAbsent(row.getLong("business_id"), ignored -> new ArrayList<>())
            .add(row.getLong("media_id")), productIds.toArray());

    Map<Long, String> offShelfOperators = listOffShelfOperators(products);
    Map<Long, List<FinishedProductPrice>> markupPrices = priceService.listPricesByProductIds(productIds);
    Map<Long, List<FinishedProductGuidePrice>> guidePrices = guidePriceService.listPricesByProductIds(productIds);
    Map<Long, List<FinishedProductVariant>> variants = variantMapper.selectList(
        Wrappers.lambdaQuery(FinishedProductVariant.class)
            .in(FinishedProductVariant::getFinishedProductId, productIds)
            .orderByAsc(FinishedProductVariant::getFinishedProductId)
            .orderByAsc(FinishedProductVariant::getId)).stream()
        .collect(Collectors.groupingBy(FinishedProductVariant::getFinishedProductId));
    Map<Long, List<FinishedProductAttributeEntry>> attributes = attributeEntryMapper.selectList(
        Wrappers.lambdaQuery(FinishedProductAttributeEntry.class)
            .in(FinishedProductAttributeEntry::getFinishedProductId, productIds)
            .orderByAsc(FinishedProductAttributeEntry::getFinishedProductId)
            .orderByAsc(FinishedProductAttributeEntry::getId)).stream()
        .collect(Collectors.groupingBy(FinishedProductAttributeEntry::getFinishedProductId));

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

  private Map<Long, String> listOffShelfOperators(List<FinishedProduct> products) {
    List<Long> offShelfIds = products.stream()
        .filter(product -> "offShelf".equals(lifecycle.isSupplyChain()
            ? product.getSourceStatus() : product.getStatus()))
        .map(FinishedProduct::getId).toList();
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
          FROM finished_operation_logs
          WHERE business_client_code = ? AND operation_type = 'OFF_SHELF' AND product_id IN (%s)
        ) latest WHERE sequence_number = 1
        """.replace("%s", String.join(",", Collections.nCopies(offShelfIds.size(), "?"))),
        (RowCallbackHandler) row -> operators.put(row.getLong("product_id"), row.getString("operator_name")), parameters);
    return operators;
  }

}
