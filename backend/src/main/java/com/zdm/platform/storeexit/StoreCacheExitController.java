package com.zdm.platform.storeexit;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.zdm.platform.common.ApiResponse;
import jakarta.servlet.http.HttpServletRequest;
import java.util.ArrayDeque;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/** Anonymous cache invalidation only: never grants identity or exposes business/receipt details. */
@RestController
public class StoreCacheExitController {
  private final StoreExitJournal journal;
  private final ObjectMapper json;
  private final ArrayDeque<Long> requests = new ArrayDeque<>();
  public StoreCacheExitController(StoreExitJournal journal, ObjectMapper json) { this.journal=journal; this.json=json; }

  private synchronized void limit() {
    long now=System.nanoTime();
    while(!requests.isEmpty() && now-requests.getFirst()>=60_000_000_000L) { requests.removeFirst(); }
    if(requests.size()>=60) { throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS); }
    requests.addLast(now);
  }

  @PostMapping("/api/open/store-cache-exits")
  public ApiResponse<List<String>> check(HttpServletRequest request) throws java.io.IOException {
    limit();
    byte[] body=request.getInputStream().readNBytes(8193);
    if(body.length>8192) { throw new IllegalArgumentException("缓存范围请求过大"); }
    com.fasterxml.jackson.databind.JsonNode input;
    try { input=json.readTree(body); }
    catch(com.fasterxml.jackson.core.JsonProcessingException exception) { throw new IllegalArgumentException("缓存范围请求无效",exception); }
    if(input==null || !input.isObject() || input.size()!=1 || !input.path("fingerprints").isArray()
        || input.path("fingerprints").isEmpty() || input.path("fingerprints").size()>100) { throw new IllegalArgumentException("缓存范围请求无效"); }
    Set<String> wanted=new HashSet<>();
    for(var value:input.path("fingerprints")) {
      if(!value.isTextual() || !value.asText().matches("[a-f0-9]{64}")) { throw new IllegalArgumentException("缓存范围指纹无效"); }
      wanted.add(value.asText());
    }
    journal.requireReady();
    var entries=journal.entries();
    Set<String> rolledBack=new HashSet<>();
    entries.stream().filter(e->"ROLLED_BACK".equals(e.stage())).forEach(e->rolledBack.add(e.operationId()));
    Set<Long> conflicts=new HashSet<>();
    entries.stream().filter(e->"COMMITTED".equals(e.stage())&&rolledBack.contains(e.operationId())).forEach(e->conflicts.add(e.storeId()));
    return ApiResponse.ok(entries.stream().filter(e->"COMMITTED".equals(e.stage())&&!conflicts.contains(e.storeId()))
        .map(e->StoreExitCoverage.hash("zdm-store-cache-v1:"+e.tenantId()+":"+e.storeId()))
        .filter(wanted::contains).distinct().sorted().toList());
  }
}
