package com.zdm.platform.customer;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import com.zdm.platform.media.MediaAssetService;
import com.zdm.platform.media.MediaStorageService;
import com.zdm.platform.security.CurrentIdentityProvider;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.access.AccessDeniedException;

class CustomerUploadIdentityTest {
  @Test void unauthenticatedUploadsNeverWriteFiles() {
    var identity=mock(CurrentIdentityProvider.class);
    var storage=mock(MediaStorageService.class);
    when(identity.require()).thenThrow(new AccessDeniedException("未登录"));
    var service=new MediaAssetService(identity,storage);
    var file=new MockMultipartFile("file","note.bin","application/octet-stream",new byte[] { 1 });
    assertThatThrownBy(() -> service.uploadAttachment(file,CustomerService.FILE_LIMIT)).isInstanceOf(AccessDeniedException.class);
    assertThatThrownBy(() -> service.upload(file,CustomerService.FILE_LIMIT)).isInstanceOf(AccessDeniedException.class);
    verifyNoInteractions(storage);
  }
}
