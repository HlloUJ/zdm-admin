CREATE TABLE slab_textures (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(120) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'enabled',
  created_by_name VARCHAR(80) NOT NULL DEFAULT '韩健',
  remark VARCHAR(255),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_slab_textures_name (name)
);

CREATE TABLE slab_texture_aliases (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  texture_id BIGINT NOT NULL,
  name VARCHAR(120) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'enabled',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_slab_texture_aliases_name (name),
  KEY idx_slab_texture_aliases_texture_id (texture_id),
  CONSTRAINT fk_slab_texture_aliases_texture
    FOREIGN KEY (texture_id) REFERENCES slab_textures (id) ON DELETE CASCADE
);

INSERT INTO slab_textures (name, status, created_by_name)
VALUES
  ('细纹', 'enabled', '韩健'),
  ('直纹', 'enabled', '韩健'),
  ('乱纹', 'enabled', '韩健'),
  ('山水纹', 'enabled', '韩健'),
  ('晶体纹', 'enabled', '韩健');
