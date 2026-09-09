package com.zdm.platform.inventory;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.zdm.platform.media.MediaAsset;
import com.zdm.platform.media.MediaAssetService;
import java.util.Map;
import org.junit.jupiter.api.Test;

class FinishedProductDetailContentTest {
  private final MediaAssetService assets = mock(MediaAssetService.class);
  private final FinishedProductDetailContent content = new FinishedProductDetailContent(assets);

  @Test
  void storesMediaIdsAndRendersCurrentUrlsWithFormatting() {
    register(1L, "photo", "image");
    register(2L, "clip", "video");
    String stored = content.normalize("""
        <h2><strong>商品介绍</strong></h2><p><span style="font-family:宋体;font-size:24px;color:rgb(255, 0, 0)">材质</span></p>
        <img src="/api/open/media/photo"><video data-w-e-type="video" src="/api/open/media/clip" controls></video>
        """);
    assertThat(stored).contains("src=\"media:1\"", "src=\"media:2\"", "font-family:宋体", "<strong>");
    assertThat(content.references(stored)).isEqualTo(Map.of("detailMedia1", 1L, "detailMedia2", 2L));
    String rendered = content.render(stored);
    assertThat(rendered).contains("/api/open/media/photo", "/api/open/media/clip");
    assertThat(content.normalize(rendered)).isEqualTo(stored);
    assertThat(content.references(content.normalize("<p>移除媒体</p>"))).isEmpty();
  }

  @Test
  void removesExecutableHtmlAndUnsafeStylesButKeepsLinksAndTables() {
    String stored = content.normalize("""
        <p onclick="alert(1)" style="color:red;position:fixed;background-image:url(https://evil.test)">正文</p>
        <script>alert(1)</script><iframe src="https://evil.test"></iframe>
        <a href="javascript:alert(1)">危险链接</a><a href="https://example.com">链接</a>
        <table><tbody><tr><td>规格</td></tr></tbody></table>
        """);
    assertThat(stored).doesNotContain("onclick", "<script", "<iframe", "javascript:", "position", "background-image");
    assertThat(stored).contains("color:red", "https://example.com", "<table>", "规格");
  }

  @Test
  void rejectsEmptyAndUnregisteredOrWrongTypeMedia() {
    for (String html : new String[] {"", "<p><br></p>", "<p>&nbsp;</p>",
        "<img src='data:image/png;base64,abc'>", "<img src='https://example.com/a.png'>",
        "<img src='/api/open/media/missing'>"}) {
      assertThatThrownBy(() -> content.normalize(html)).isInstanceOf(IllegalArgumentException.class);
    }
    register(2L, "clip", "video");
    assertThatThrownBy(() -> content.normalize("<img src='/api/open/media/clip'>"))
        .isInstanceOf(IllegalArgumentException.class);
  }

  private void register(Long id, String publicId, String type) {
    MediaAsset asset = new MediaAsset();
    asset.setId(id);
    asset.setMediaType(type);
    when(assets.findPublic(publicId)).thenReturn(asset);
    when(assets.requireAvailable(id)).thenReturn(asset);
    when(assets.publicUrl(id)).thenReturn("/api/open/media/" + publicId);
  }
}
