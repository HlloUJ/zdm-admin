package com.zdm.platform.inventory;

import com.zdm.platform.media.MediaAsset;
import com.zdm.platform.media.MediaAssetService;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.jsoup.safety.Cleaner;
import org.jsoup.safety.Safelist;

/** Finished-stock rich text stores media IDs; response URLs are generated from registered assets. */
final class FinishedProductDetailContent {
  private static final String PUBLIC_PREFIX = "/api/open/media/";
  private static final String STORED_PREFIX = "media:";
  private static final Set<String> STYLE_PROPERTIES = Set.of(
      "color", "background-color", "font-family", "font-size", "font-weight", "font-style",
      "text-decoration", "text-align", "line-height", "width", "height", "margin-left");
  private final MediaAssetService assets;

  FinishedProductDetailContent(MediaAssetService assets) {
    this.assets = assets;
  }

  String normalize(String html) {
    Document document = clean(html);
    for (Element element : document.select("img, video")) {
      String source = element.attr("src");
      MediaAsset asset;
      if (source.matches("media:[0-9]+")) {
        asset = assets.requireAvailable(Long.valueOf(source.substring(STORED_PREFIX.length())));
      } else if (source.matches("/api/open/media/[a-zA-Z0-9-]+")) {
        MediaAsset found = assets.findPublic(source.substring(PUBLIC_PREFIX.length()));
        asset = found == null ? null : assets.requireAvailable(found.getId());
      } else {
        throw new IllegalArgumentException("详情图片和视频请通过上传添加");
      }
      String expectedType = "img".equals(element.tagName()) ? "image" : "video";
      if (asset == null || !expectedType.equals(asset.getMediaType())) {
        throw new IllegalArgumentException("详情媒体不存在或类型不正确");
      }
      element.attr("src", STORED_PREFIX + asset.getId());
      if ("video".equals(element.tagName())) {
        element.attr("controls", "");
      }
    }
    if (document.text().replace('\u00a0', ' ').replace("\u200b", "").isBlank()
        && document.select("img, video").isEmpty()) {
      throw new IllegalArgumentException("请输入宝贝详情");
    }
    return document.body().html();
  }

  Map<String, Long> references(String html) {
    Map<String, Long> references = new LinkedHashMap<>();
    for (Element media : clean(html).select("img, video")) {
      String source = media.attr("src");
      if (source.matches("media:[0-9]+")) {
        Long id = Long.valueOf(source.substring(STORED_PREFIX.length()));
        references.put("detailMedia" + id, id);
      }
    }
    return references;
  }

  String render(String html) {
    Document document = clean(html);
    for (Element media : document.select("img, video")) {
      String source = media.attr("src");
      if (source.matches("media:[0-9]+")) {
        String url = assets.publicUrl(Long.valueOf(source.substring(STORED_PREFIX.length())));
        if (url == null) {
          media.remove();
        } else {
          media.attr("src", url);
        }
      } else if (!source.matches("/api/open/media/[a-zA-Z0-9-]+")) {
        media.remove();
      }
    }
    return document.body().html();
  }

  private Document clean(String html) {
    Safelist allowed = Safelist.relaxed()
        .addTags("video", "hr", "s")
        .addAttributes(":all", "style", "data-w-e-type", "data-w-e-is-void", "data-w-e-is-inline")
        .addAttributes("video", "src", "controls", "width", "height")
        .removeProtocols("img", "src", "http", "https")
        .addEnforcedAttribute("a", "rel", "noopener noreferrer");
    Document input = Jsoup.parseBodyFragment(html == null ? "" : html);
    for (Element video : input.select("video")) {
      Element source = video.selectFirst("source[src]");
      if (video.attr("src").isEmpty() && source != null) {
        video.attr("src", source.attr("src"));
      }
      video.select("source").remove();
    }
    Document document = new Cleaner(allowed).clean(input);
    document.outputSettings().prettyPrint(false);
    for (Element element : document.select("[style]")) {
      StringBuilder safeStyle = new StringBuilder();
      for (String declaration : element.attr("style").split(";")) {
        String[] parts = declaration.split(":", 2);
        if (parts.length != 2) {
          continue;
        }
        String property = parts[0].trim().toLowerCase(java.util.Locale.ROOT);
        String value = parts[1].trim();
        if (STYLE_PROPERTIES.contains(property)
            && (value.matches("[\\p{L}\\p{N}#%.,'\" -]+")
                || value.matches("rgba?\\([0-9.,% ]+\\)"))) {
          safeStyle.append(property).append(':').append(value).append(';');
        }
      }
      if (safeStyle.isEmpty()) {
        element.removeAttr("style");
      } else {
        element.attr("style", safeStyle.toString());
      }
    }
    return document;
  }
}
