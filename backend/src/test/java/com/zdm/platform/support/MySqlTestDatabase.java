package com.zdm.platform.support;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.UUID;
import org.testcontainers.containers.MySQLContainer;

/** Disposable test infrastructure only. Each class keeps fresh data and a database-scoped account. */
public final class MySqlTestDatabase {
  private static MySQLContainer<?> worker;

  private MySqlTestDatabase() {}

  public static MySQLContainer<?> create() {
    String mode = System.getProperty("zdm.test.mysql.mode", "schema");
    return switch (mode) {
      case "container" -> new MySQLContainer<>("mysql:8.0");
      case "schema" -> new SchemaContainer();
      default -> throw new IllegalArgumentException("Unknown test MySQL mode: " + mode);
    };
  }

  private static synchronized MySQLContainer<?> worker() {
    if (worker == null) {
      var database = new MySQLContainer<>("mysql:8.0")
          .withDatabaseName("worker_bootstrap").withUsername("worker_bootstrap")
          .withPassword(UUID.randomUUID().toString());
      database.start();
      worker = database;
      Runtime.getRuntime().addShutdownHook(new Thread(database::stop, "test-mysql-worker-stop"));
    }
    return worker;
  }

  private static void rootSql(String... statements) throws SQLException {
    var database = worker();
    try (Connection connection = DriverManager.getConnection(database.getJdbcUrl(), "root", database.getPassword());
        var statement = connection.createStatement()) {
      for (String sql : statements) { statement.execute(sql); }
    }
  }

  private static String literal(String value) {
    return "'" + value.replace("\\", "\\\\").replace("'", "''") + "'";
  }

  private static final class SchemaContainer extends MySQLContainer<SchemaContainer> {
    private String originalDatabase;
    private String originalUsername;
    private boolean running;

    private SchemaContainer() { super("mysql:8.0"); }

    @Override public SchemaContainer withEnv(String key, String value) {
      throw new UnsupportedOperationException("Use container mode for custom server environment");
    }
    @Override public SchemaContainer withCommand(String command) {
      throw new UnsupportedOperationException("Use container mode for custom server commands");
    }
    @Override public SchemaContainer withCommand(String... command) {
      throw new UnsupportedOperationException("Use container mode for custom server commands");
    }
    @Override public SchemaContainer withInitScript(String script) {
      throw new UnsupportedOperationException("Use container mode for custom initialization");
    }
    @Override public synchronized void start() {
      if (running) { return; }
      worker();
      originalDatabase = super.getDatabaseName();
      originalUsername = super.getUsername();
      String suffix = UUID.randomUUID().toString().replace("-", "").substring(0, 12);
      String prefix = originalDatabase.replaceAll("[^a-zA-Z0-9_]", "_");
      String schema = prefix.substring(0, Math.min(40, prefix.length())) + "_" + suffix;
      String account = "test_" + suffix;
      try {
        rootSql("CREATE DATABASE `" + schema + "`",
            "CREATE USER " + literal(account) + "@'%' IDENTIFIED BY " + literal(getPassword()),
            "GRANT ALL PRIVILEGES ON `" + schema + "`.* TO " + literal(account) + "@'%'");
        super.withDatabaseName(schema);
        super.withUsername(account);
        running = true;
      } catch (SQLException exception) { throw new IllegalStateException("Cannot create isolated test database", exception); }
    }

    @Override public synchronized void stop() {
      if (!running) { return; }
      try {
        rootSql("DROP DATABASE `" + getDatabaseName() + "`", "DROP USER " + literal(getUsername()) + "@'%'");
        running = false;
        super.withDatabaseName(originalDatabase);
        super.withUsername(originalUsername);
      } catch (SQLException exception) { throw new IllegalStateException("Cannot release isolated test database", exception); }
    }

    @Override public boolean isRunning() { return running && worker != null && worker.isRunning(); }
    @Override public String getHost() { return worker().getHost(); }
    @Override public Integer getMappedPort(int port) { return worker().getMappedPort(port); }
    @Override public String getContainerId() { return worker == null ? null : worker.getContainerId(); }
  }
}
