package com.zdm.platform.storeexit;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.HexFormat;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/** Dedicated retained ledger service: its volume is outside SQL/media backups and Git worktrees. */
@Component
public final class StoreExitRemoteLedger {
  private final String url;
  private final String namespace;
  private final String token;
  private final ObjectMapper json;
  private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build();

  public StoreExitRemoteLedger(@Value("${zdm.store-exit.ledger-service-url:}") String url,
      @Value("${spring.datasource.url}") String databaseUrl, @Value("${spring.datasource.password}") String password,
      ObjectMapper json) {
    this.json = json;
    String base = databaseUrl.split("\\?", 2)[0];
    String database = base.substring(base.lastIndexOf('/') + 1);
    namespace = database;
    this.url = url.replace("SCOPE", StoreExitCoverage.hash(namespace).substring(0,16)).replaceAll("/+$", "");
    try {
      Mac mac = Mac.getInstance("HmacSHA256");
      mac.init(new SecretKeySpec(password.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
      token = HexFormat.of().formatHex(mac.doFinal(("zdm-store-exit:" + namespace).getBytes(StandardCharsets.UTF_8)));
    } catch (java.security.GeneralSecurityException exception) { throw new IllegalStateException("独立记录认证初始化失败", exception); }
  }

  public boolean configured() { return !url.isBlank(); }
  public void requireReady() {
    JsonNode result = request("GET", "/health", null);
    boolean snapshots = false;
    for (JsonNode capability : result.path("capabilities")) { snapshots |= "actor-snapshots-v1".equals(capability.asText()); }
    if (!result.path("ready").asBoolean() || !namespace.equals(result.path("namespace").asText()) || !snapshots) {
      throw new IllegalStateException("独立退出记录服务作用域或持久性未确认");
    }
  }
  public JsonNode entries() { return request("GET", "/entries", null); }
  public void persist(JsonNode record) {
    JsonNode acknowledged = request("PUT", "/entries/" + record.path("operationId").asText() + "-" + record.path("stage").asText() + ".json", record);
    if (!acknowledged.path("persisted").asBoolean()) { throw new IllegalStateException("独立退出记录未确认持久化成功"); }
  }
  private JsonNode request(String method, String path, JsonNode record) {
    if (!configured() || !url.matches("https?://[^\\s]+") || !namespace.matches("[A-Za-z0-9_]{1,64}")) {
      throw new IllegalStateException("独立退出记录服务未配置");
    }
    try {
      var request = HttpRequest.newBuilder(URI.create(url + path)).timeout(Duration.ofSeconds(5))
          .header("Authorization", "Bearer " + token).header("x-zdm-ledger-scope", namespace)
          .header("Content-Type", "application/json")
          .method(method, record == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(json.writeValueAsString(record))).build();
      var response = client.send(request, HttpResponse.BodyHandlers.ofString());
      if (response.statusCode() < 200 || response.statusCode() >= 300) {
        throw new IllegalStateException("独立退出记录服务未确认成功，状态码：" + response.statusCode());
      }
      JsonNode decoded = json.readTree(response.body());
      if (decoded == null) { throw new IllegalStateException("独立退出记录服务响应缺失"); }
      return decoded;
    } catch (InterruptedException exception) {
      Thread.currentThread().interrupt(); throw new IllegalStateException("独立退出记录请求中断", exception);
    } catch (java.io.IOException exception) { throw new IllegalStateException("独立退出记录服务不可用", exception); }
  }
}
