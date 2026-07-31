package com.zdm.platform.config;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Component
@ConfigurationProperties(prefix = "zdm.security")
public class SecurityProperties {
  private boolean devTokensEnabled;
  private String verificationCode = "";
  private Duration sessionDuration = Duration.ofHours(12);

  public boolean isDevTokensEnabled() {
    return devTokensEnabled;
  }

  public void setDevTokensEnabled(boolean devTokensEnabled) {
    this.devTokensEnabled = devTokensEnabled;
  }

  public String getVerificationCode() {
    return verificationCode;
  }

  public void setVerificationCode(String verificationCode) {
    this.verificationCode = verificationCode;
  }

  public Duration getSessionDuration() {
    return sessionDuration;
  }

  public void setSessionDuration(Duration sessionDuration) {
    this.sessionDuration = sessionDuration;
  }
}
