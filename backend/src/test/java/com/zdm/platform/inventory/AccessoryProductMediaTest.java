package com.zdm.platform.inventory;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.zdm.platform.media.MediaAsset;
import com.zdm.platform.media.MediaAssetService;
import com.zdm.platform.media.MediaReferenceService;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

class AccessoryProductMediaTest {
  private final MediaAssetService assets = mock(MediaAssetService.class);
  private final MediaReferenceService references = mock(MediaReferenceService.class);
  private final AccessoryProductService service = new AccessoryProductService(
      null, null, null, null, null, assets, null, references, null, mock(AccessoryOperationLogService.class), mock(AccessoryLifecycleService.class));
  private final AccessoryProductWriteValidator validator = new AccessoryProductWriteValidator(
      null, assets, null, null, null);

  @Test
  void savesFiveImagesAndUsesFirstAsCover() {
    AccessoryProduct product = product(List.of(11L, 12L, 13L, 14L, 15L));
    validator.validateMedia(product);
    ReflectionTestUtils.invokeMethod(service, "syncMediaReferences", product);
    assertThat(product.getMainImageMediaId()).isEqualTo(11L);
    verify(references).replace("ACCESSORY_PRODUCT", 1L,
        Map.of("mainImage", 11L, "mainImage2", 12L, "mainImage3", 13L,
            "mainImage4", 14L, "mainImage5", 15L, "video", 20L));
  }

  @Test
  void rejectsSixImagesEmptyImagesAndDuplicates() {
    for (List<Long> ids : List.of(List.<Long>of(), List.of(11L, 11L),
        List.of(11L, 12L, 13L, 14L, 15L, 16L))) {
      AccessoryProduct product = product(ids);
      assertThatThrownBy(() -> validator.validateMedia(product))
          .isInstanceOf(IllegalArgumentException.class);
    }
  }

  @Test
  void acceptsLegacySingleImageAndRejectsVideoAsImage() {
    AccessoryProduct product = product(null);
    product.setMainImageMediaId(11L);
    validator.validateMedia(product);
    assertThat(product.getMainImageMediaIds()).containsExactly(11L);
    product.setMainImageMediaIds(List.of(20L));
    assertThatThrownBy(() -> validator.validateMedia(product))
        .isInstanceOf(IllegalArgumentException.class).hasMessage("请上传商品主图");
  }

  @Test
  void replacementSendsOnlyRemainingImagesToReferenceLifecycle() {
    AccessoryProduct product = product(List.of(15L, 12L));
    validator.validateMedia(product);
    ReflectionTestUtils.invokeMethod(service, "syncMediaReferences", product);
    verify(references).replace("ACCESSORY_PRODUCT", 1L,
        Map.of("mainImage", 15L, "mainImage2", 12L, "video", 20L));
  }

  private AccessoryProduct product(List<Long> imageIds) {
    MediaAsset image = new MediaAsset();
    image.setMediaType("image");
    for (long id = 11; id <= 16; id++) {
      when(assets.requireAvailable(id)).thenReturn(image);
    }
    MediaAsset video = new MediaAsset();
    video.setMediaType("video");
    when(assets.requireAvailable(20L)).thenReturn(video);
    AccessoryProduct product = new AccessoryProduct();
    product.setId(1L);
    product.setMainImageMediaIds(imageIds);
    product.setVideoMediaId(20L);
    return product;
  }
}
