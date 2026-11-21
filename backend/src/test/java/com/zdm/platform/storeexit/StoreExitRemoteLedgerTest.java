package com.zdm.platform.storeexit;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.Test;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.wait.strategy.Wait;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.MountableFile;

/** Actual Java client + deployed Node protocol, with an isolated container and no retained-preview writes. */
@Testcontainers(disabledWithoutDocker = true)
class StoreExitRemoteLedgerTest {
  private static final String DATABASE = "isolated_ledger_contract";
  private static final String PASSWORD = "isolated_contract_password";
  private static String token() {
    try {
      Mac mac = Mac.getInstance("HmacSHA256");
      mac.init(new SecretKeySpec(PASSWORD.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
      return HexFormat.of().formatHex(mac.doFinal(("zdm-store-exit:" + DATABASE).getBytes(StandardCharsets.UTF_8)));
    } catch (Exception e) { throw new IllegalStateException(e); }
  }
  @Container static final GenericContainer<?> LEDGER = new GenericContainer<>("node:24-alpine")
      .withCopyFileToContainer(MountableFile.forHostPath(Path.of("../infrastructure/store-exit-ledger/server.mjs").toAbsolutePath()), "/app/server.mjs")
      .withEnv("ZDM_LEDGER_NAMESPACE", DATABASE).withEnv("ZDM_LEDGER_AUTH_TOKEN", token())
      .withEnv("ZDM_LEDGER_DIR", "/tmp/isolated-ledger")
      .withExposedPorts(8090).withCommand("node", "/app/server.mjs")
      .waitingFor(Wait.forListeningPort());

  @Test void anOldLedgerCannotAuthorizeDeletionBeforeItCanPreserveNames() throws Exception {
    var server=com.sun.net.httpserver.HttpServer.create(new java.net.InetSocketAddress("127.0.0.1",0),0);
    server.createContext("/health", exchange->{
      byte[] body=("{\"ready\":true,\"namespace\":\""+DATABASE+"\"}").getBytes(StandardCharsets.UTF_8);
      exchange.sendResponseHeaders(200,body.length);try(var output=exchange.getResponseBody()){output.write(body);}
    });
    server.start();
    try {
      var remote=new StoreExitRemoteLedger("http://127.0.0.1:"+server.getAddress().getPort(),"jdbc:mysql://host/"+DATABASE,PASSWORD,new ObjectMapper());
      assertThrows(IllegalStateException.class,remote::requireReady);
    } finally { server.stop(0); }
  }

  @Test void actualProtocolPreservesIntentAndImmutableCommittedReceipt() {
    ObjectMapper json = new ObjectMapper();
    String url = "http://" + LEDGER.getHost() + ":" + LEDGER.getMappedPort(8090);
    var remote = new StoreExitRemoteLedger(url, "jdbc:mysql://host/" + DATABASE + "?serverTimezone=Asia/Shanghai", PASSWORD, json);
    var journal = new StoreExitJournal("", json, remote);
    journal.requireReady();
    String operation = UUID.randomUUID().toString();
    long store = 9007199254740993L;
    journal.intent(operation, store, 1L, java.util.List.of(9007199254740995L),
        new com.zdm.platform.security.CurrentIdentity(null, 1L, 1L, null, "admin", null, null, "测试运营", "all", java.util.List.of(), java.util.List.of()));
    Map<String, Object> receipt = new LinkedHashMap<>();
    receipt.put("operation_id", operation); receipt.put("store_id", store); receipt.put("tenant_id", 1L);
    receipt.put("store_name", "隔离测试门店"); receipt.put("tenant_name", "隔离测试租户");
    receipt.put("store_created_by_account_id", 1L); receipt.put("operator_account_id", 1L);
    receipt.put("operator_name", "测试操作人"); receipt.put("operator_identity", "admin:1");
    receipt.put("rule_version", "V1.3"); receipt.put("plan_hash", "a".repeat(64));
    receipt.put("created_at", "2026-11-06 12:00:00");
    receipt.put("result_json", "{\"counts\":{},\"retained\":[],\"verified\":true,\"mediaRelease\":{},\"accountIds\":[]}");
    journal.committed(receipt); journal.committed(receipt);
    assertEquals(2, journal.entries().size());
    assertTrue(journal.entries().stream().allMatch(e -> e.storeId() == store));
    receipt.put("store_name", "不允许覆盖原凭证");
    assertThrows(IllegalStateException.class, () -> journal.committed(receipt));
    assertThrows(IllegalStateException.class, () -> new StoreExitRemoteLedger(url,
        "jdbc:mysql://host/another_database", PASSWORD, json).requireReady());
    assertThrows(IllegalStateException.class, () -> new StoreExitRemoteLedger(url,
        "jdbc:mysql://host/" + DATABASE, "wrong_password", json).requireReady());
  }
  @Test void actorSnapshotsAreDurableAndCannotIncludeUnrelatedAccounts() throws Exception {
    try(var isolated=new GenericContainer<>("node:24-alpine")
        .withCopyFileToContainer(MountableFile.forHostPath(Path.of("../infrastructure/store-exit-ledger/server.mjs").toAbsolutePath()), "/app/server.mjs")
        .withEnv("ZDM_LEDGER_NAMESPACE",DATABASE).withEnv("ZDM_LEDGER_AUTH_TOKEN",token())
        .withEnv("ZDM_LEDGER_DIR","/tmp/actor-ledger").withExposedPorts(8090)
        .withCommand("node","/app/server.mjs").waitingFor(Wait.forListeningPort())) {
    isolated.start();
    ObjectMapper json=new ObjectMapper();
    var remote=new StoreExitRemoteLedger("http://"+isolated.getHost()+":"+isolated.getMappedPort(8090),"jdbc:mysql://host/"+DATABASE,PASSWORD,json);
    var journal=new StoreExitJournal("",json,remote);journal.requireReady();
    Map<String,Object> receipt=new LinkedHashMap<>();String operation=UUID.randomUUID().toString();
    receipt.put("operation_id",operation);receipt.put("store_id",12L);receipt.put("tenant_id",1L);
    receipt.put("store_name","测试门店");receipt.put("tenant_name","测试租户");receipt.put("store_created_by_account_id",1L);
    receipt.put("operator_account_id",1L);receipt.put("operator_name","测试运营");receipt.put("operator_identity","admin:1");
    receipt.put("rule_version","V1.3");receipt.put("plan_hash","b".repeat(64));receipt.put("created_at","2026-11-11 12:00:00");
    receipt.put("result_json",json.writeValueAsString(Map.of("counts",Map.of(),"retained",java.util.List.of(),"verified",true,"mediaRelease",Map.of(),"accountIds",java.util.List.of("25"),"actorSnapshots",Map.of("25","必要历史姓名"))));
    journal.committed(receipt);
    var entry=journal.entries().stream().filter(e->e.operationId().equals(operation)).findFirst().orElseThrow();
    assertEquals("必要历史姓名",json.readTree(String.valueOf(entry.receipt().get("result_json"))).path("actorSnapshots").path("25").asText());
    receipt.put("operation_id",UUID.randomUUID().toString());
    receipt.put("result_json",json.writeValueAsString(Map.of("counts",Map.of(),"retained",java.util.List.of(),"verified",true,"mediaRelease",Map.of(),"accountIds",java.util.List.of("25"),"actorSnapshots",Map.of("26","不属于本次删除"))));
    assertThrows(IllegalStateException.class,()->journal.committed(receipt));
    assertTrue(journal.entries().stream().noneMatch(e->e.operationId().equals(receipt.get("operation_id"))));
    }
  }

  @Test void aSuccessfulHttpStatusWithoutDurableAcknowledgementIsRejected() throws Exception {
    var server=com.sun.net.httpserver.HttpServer.create(new java.net.InetSocketAddress("127.0.0.1",0),0);
    server.createContext("/",exchange -> {
      exchange.getRequestBody().readAllBytes();
      byte[] body="{\"persisted\":false}".getBytes(java.nio.charset.StandardCharsets.UTF_8);
      exchange.sendResponseHeaders(200,body.length);
      try(var output=exchange.getResponseBody()){output.write(body);}
    });
    server.start();
    try {
      ObjectMapper json=new ObjectMapper();
      var remote=new StoreExitRemoteLedger("http://127.0.0.1:"+server.getAddress().getPort(),"jdbc:mysql://host/"+DATABASE,PASSWORD,json);
      var record=json.createObjectNode().put("operationId",UUID.randomUUID().toString()).put("stage","INTENT");
      assertThrows(IllegalStateException.class,()->remote.persist(record));
    } finally {server.stop(0);}
  }

}
