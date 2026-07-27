package com.zdm.admin.config;

import com.zdm.admin.security.TokenAuthenticationFilter;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpStatus;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.HttpStatusEntryPoint;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;

@Configuration
public class SecurityConfig {
  @Bean
  SecurityFilterChain securityFilterChain(HttpSecurity http, TokenAuthenticationFilter tokenFilter) throws Exception {
    return http.csrf(AbstractHttpConfigurer::disable)
        .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
        .authorizeHttpRequests(auth -> auth
            .requestMatchers("/api/auth/**", "/actuator/health", "/v3/api-docs/**", "/swagger-ui/**", "/swagger-ui.html")
            .permitAll()
            .anyRequest()
            .authenticated())
        .exceptionHandling(handler -> handler.authenticationEntryPoint(new HttpStatusEntryPoint(HttpStatus.UNAUTHORIZED)))
        .addFilterBefore(tokenFilter, UsernamePasswordAuthenticationFilter.class)
        .build();
  }
}
