package com.zdm.platform.storeexit;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.server.ResponseStatusException;

class StoreCacheExitControllerTest {
  private final ObjectMapper json=new ObjectMapper();
  private final StoreExitJournal journal=mock(StoreExitJournal.class);
  private final StoreCacheExitController controller=new StoreCacheExitController(journal,json);
  private MockHttpServletRequest request(List<String> fingerprints) throws Exception {
    var request=new MockHttpServletRequest();request.setContent(json.writeValueAsBytes(Map.of("fingerprints",fingerprints)));return request;
  }
  private StoreExitJournal.Entry entry(String operation,long store,String stage) {
    return new StoreExitJournal.Entry(operation,store,1,stage,Map.of());
  }
  @Test void onlyRequestedPermanentFingerprintsAreReturned() throws Exception {
    when(journal.entries()).thenReturn(List.of(entry("committed",2,"COMMITTED"),entry("pending",3,"INTENT"),entry("rollback",4,"ROLLED_BACK"),entry("other",5,"COMMITTED")));
    String target=StoreExitCoverage.hash("zdm-store-cache-v1:1:2");
    assertEquals(List.of(target),controller.check(request(List.of(target,StoreExitCoverage.hash("zdm-store-cache-v1:1:3"),StoreExitCoverage.hash("zdm-store-cache-v1:1:4")))).data());
    verify(journal).requireReady();
  }
  @Test void conflictingReceiptsNeverAuthorizeCacheDeletion() throws Exception {
    when(journal.entries()).thenReturn(List.of(entry("same",2,"COMMITTED"),entry("same",2,"ROLLED_BACK")));
    assertTrue(controller.check(request(List.of(StoreExitCoverage.hash("zdm-store-cache-v1:1:2")))).data().isEmpty());
  }
  @Test void unreadableIndependentHistoryIsNotAnEmptySuccessfulResult() throws Exception {
    doThrow(new IllegalStateException("unavailable")).when(journal).requireReady();
    assertThrows(IllegalStateException.class,()->controller.check(request(List.of("a".repeat(64)))));
  }
  @Test void limitsBodyAndBatchSizeBeforeReadingTheLedger() throws Exception {
    assertThrows(IllegalArgumentException.class,()->controller.check(request(java.util.Collections.nCopies(101,"a".repeat(64)))));
    var oversized=new MockHttpServletRequest();oversized.setContent(new byte[8193]);assertThrows(IllegalArgumentException.class,()->controller.check(oversized));
    assertThrows(IllegalArgumentException.class,()->controller.check(request(List.of("not-a-fingerprint"))));
    var malformed=new MockHttpServletRequest();malformed.setContent("{".getBytes(java.nio.charset.StandardCharsets.UTF_8));
    assertThrows(IllegalArgumentException.class,()->controller.check(malformed));
    verifyNoInteractions(journal);
  }
  @Test void limitsAnonymousRequestsWithoutRetainingClientIdentities() throws Exception {
    when(journal.entries()).thenReturn(List.of());
    for(int i=0;i<60;i++)controller.check(request(List.of("a".repeat(64))));
    var error=assertThrows(ResponseStatusException.class,()->controller.check(request(List.of("a".repeat(64)))));
    assertEquals(429,error.getStatusCode().value());
  }
}
