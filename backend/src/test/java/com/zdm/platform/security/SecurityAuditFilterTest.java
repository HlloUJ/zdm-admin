package com.zdm.platform.security;

import static org.mockito.Mockito.*;

import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

class SecurityAuditFilterTest {
  @Test void capturesIdentityBeforeTheRequestCanRemoveItAndPersistsTheSameContext() throws Exception {
    var identities=mock(CurrentIdentityProvider.class);
    var audit=mock(SecurityAuditService.class);
    var chain=mock(jakarta.servlet.FilterChain.class);
    var actor=new CurrentIdentity(null,7L,9L,null,"admin",1L,2L,"原操作人","all",List.of(),List.of());
    var captured=new SecurityAuditService.AuditContext(actor,"employee","原租户","原门店",java.time.LocalDateTime.now());
    when(identities.current()).thenReturn(Optional.of(actor));when(audit.capture(actor)).thenReturn(captured);
    var request=new MockHttpServletRequest("DELETE","/api/admin/example/1");var response=new MockHttpServletResponse();
    doAnswer(call->{when(identities.current()).thenReturn(Optional.empty());response.setStatus(204);return null;}).when(chain).doFilter(request,response);
    new SecurityAuditFilter(identities,audit).doFilter(request,response,chain);
    var order=inOrder(audit,chain);order.verify(audit).capture(actor);order.verify(chain).doFilter(request,response);
    order.verify(audit).recordCaptured(captured,"DELETE","/api/admin/example/1",204);
    verify(identities,times(1)).current();
  }
}
