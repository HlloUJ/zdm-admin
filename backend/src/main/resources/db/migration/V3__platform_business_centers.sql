CREATE TABLE suppliers (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(120) NOT NULL,
  type VARCHAR(30) NOT NULL,
  contact_name VARCHAR(50),
  contact_phone VARCHAR(20),
  region VARCHAR(120),
  address VARCHAR(255),
  qualification_status VARCHAR(30) DEFAULT 'pending',
  status VARCHAR(20) NOT NULL DEFAULT 'enabled',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_suppliers_name (name)
);

CREATE TABLE product_categories (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  tenant_id BIGINT,
  parent_id BIGINT,
  scope VARCHAR(30) NOT NULL,
  name VARCHAR(100) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  product_count INT NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'enabled',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_product_categories_parent_id (parent_id),
  KEY idx_product_categories_scope (scope),
  CONSTRAINT fk_product_categories_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id),
  CONSTRAINT fk_product_categories_parent FOREIGN KEY (parent_id) REFERENCES product_categories (id)
);

CREATE TABLE product_attributes (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  scope VARCHAR(30) NOT NULL,
  name VARCHAR(100) NOT NULL,
  value_type VARCHAR(30) NOT NULL,
  attribute_role VARCHAR(30),
  status VARCHAR(20) NOT NULL DEFAULT 'enabled',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_product_attributes_scope_name (scope, name)
);

CREATE TABLE product_attribute_values (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  attribute_id BIGINT NOT NULL,
  scope VARCHAR(30) NOT NULL,
  value VARCHAR(100) NOT NULL,
  code VARCHAR(80) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'enabled',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_product_attribute_values_code (attribute_id, code),
  CONSTRAINT fk_product_attribute_values_attribute FOREIGN KEY (attribute_id)
    REFERENCES product_attributes (id)
);

CREATE TABLE master_data (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  data_type VARCHAR(40) NOT NULL,
  name VARCHAR(100) NOT NULL,
  code VARCHAR(80) NOT NULL,
  extra VARCHAR(255),
  status VARCHAR(20) NOT NULL DEFAULT 'enabled',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_master_data_type_code (data_type, code)
);

CREATE TABLE slab_varieties (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  code VARCHAR(80) NOT NULL,
  origin VARCHAR(120),
  color VARCHAR(80),
  status VARCHAR(20) NOT NULL DEFAULT 'enabled',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_slab_varieties_code (code)
);

CREATE TABLE slab_inventory (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  supplier_id BIGINT,
  variety_id BIGINT,
  name VARCHAR(120) NOT NULL,
  serial_no VARCHAR(100) NOT NULL,
  warehouse VARCHAR(100),
  publisher_type VARCHAR(30),
  length_mm INT,
  width_mm INT,
  thickness_mm INT,
  area_square_meter DECIMAL(12, 2),
  cost_price DECIMAL(12, 2),
  guide_price DECIMAL(12, 2),
  status VARCHAR(20) NOT NULL DEFAULT 'warehouse',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_slab_inventory_serial_no (serial_no),
  CONSTRAINT fk_slab_inventory_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers (id),
  CONSTRAINT fk_slab_inventory_variety FOREIGN KEY (variety_id) REFERENCES slab_varieties (id)
);

CREATE TABLE finished_products (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  category_id BIGINT,
  supplier_id BIGINT,
  name VARCHAR(120) NOT NULL,
  sku VARCHAR(100) NOT NULL,
  cover_image VARCHAR(500),
  publisher_type VARCHAR(30),
  total_stock INT NOT NULL DEFAULT 0,
  guide_price DECIMAL(12, 2),
  status VARCHAR(20) NOT NULL DEFAULT 'warehouse',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_finished_products_sku (sku),
  CONSTRAINT fk_finished_products_category FOREIGN KEY (category_id) REFERENCES product_categories (id),
  CONSTRAINT fk_finished_products_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers (id)
);

CREATE TABLE crafts (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(120) NOT NULL,
  type VARCHAR(40) NOT NULL,
  description VARCHAR(500),
  image_url VARCHAR(500),
  pricing_method VARCHAR(40),
  status VARCHAR(20) NOT NULL DEFAULT 'enabled',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_crafts_name (name)
);

CREATE TABLE platform_orders (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  order_no VARCHAR(80) NOT NULL,
  order_type VARCHAR(30) NOT NULL,
  source_client VARCHAR(40) NOT NULL,
  tenant_id BIGINT,
  store_id BIGINT,
  customer_name VARCHAR(80),
  customer_phone VARCHAR(20),
  total_amount DECIMAL(12, 2) DEFAULT 0,
  paid_amount DECIMAL(12, 2) DEFAULT 0,
  remark VARCHAR(500),
  status VARCHAR(30) NOT NULL DEFAULT 'draft',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_platform_orders_order_no (order_no),
  KEY idx_platform_orders_tenant_id (tenant_id),
  KEY idx_platform_orders_store_id (store_id),
  CONSTRAINT fk_platform_orders_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id),
  CONSTRAINT fk_platform_orders_store FOREIGN KEY (store_id) REFERENCES stores (id)
);

INSERT INTO suppliers (id, name, type, contact_name, contact_phone, region, status)
VALUES
  (1, '云浮优选大板供应商', 'slab', '供应商经理', '13900000001', '广东省云浮市', 'enabled'),
  (2, '装点猫成品协作工厂', 'finished', '工厂经理', '13900000002', '湖北省襄阳市', 'enabled');

INSERT INTO product_categories (id, tenant_id, parent_id, scope, name, sort_order, product_count, status)
VALUES
  (1, NULL, NULL, 'finished', '家具', 10, 0, 'enabled'),
  (2, NULL, 1, 'finished', '餐桌', 10, 0, 'enabled'),
  (3, NULL, 2, 'finished', '奢石餐桌', 10, 1, 'enabled'),
  (4, NULL, NULL, 'accessory', '配件', 20, 0, 'enabled');

INSERT INTO product_attributes (id, scope, name, value_type, attribute_role, status)
VALUES
  (1, 'shared', '材质', 'select', 'basic', 'enabled'),
  (2, 'finished', '尺寸', 'text', 'sales', 'enabled'),
  (3, 'accessory', '颜色', 'select', 'sales', 'enabled');

INSERT INTO product_attribute_values (attribute_id, scope, value, code, status)
VALUES
  (1, 'shared', '天然石材', 'natural-stone', 'enabled'),
  (1, 'shared', '岩板', 'sintered-stone', 'enabled'),
  (3, 'accessory', '黑色', 'black', 'enabled');

INSERT INTO master_data (data_type, name, code, extra, status)
VALUES
  ('unit', '平方米', 'sqm', '面积单位', 'enabled'),
  ('unit', '片', 'piece', '石材片数单位', 'enabled');

INSERT INTO slab_varieties (id, name, code, origin, color, status)
VALUES (1, '潘多拉', 'pandora', '巴西', '灰白', 'enabled');

INSERT INTO slab_inventory (
  supplier_id, variety_id, name, serial_no, warehouse, publisher_type,
  length_mm, width_mm, thickness_mm, area_square_meter, cost_price, guide_price, status
) VALUES (
  1, 1, '潘多拉精选大板 A001', 'SLAB-A001', '云浮仓', '平台发布',
  3200, 1800, 18, 5.76, 6800.00, 9800.00, 'warehouse'
);

INSERT INTO finished_products (
  category_id, supplier_id, name, sku, publisher_type, total_stock, guide_price, status
) VALUES (
  3, 2, '潘多拉奢石餐桌 1.8m', 'FP-PANDORA-TABLE-1800', '平台发布', 8, 26800.00, 'warehouse'
);

INSERT INTO crafts (name, type, description, pricing_method, status)
VALUES ('圆角磨边', 'edge', '成品台面标准圆角磨边工艺', 'meter', 'enabled');

INSERT INTO platform_orders (
  order_no, order_type, source_client, tenant_id, store_id, customer_name,
  customer_phone, total_amount, paid_amount, status, remark
) VALUES (
  'SO202607270001', 'sales', 'admin', 1, 1, '样例客户',
  '13800000001', 26800.00, 0.00, 'draft', '订单中心最小样例数据'
);

INSERT INTO permissions (code, client_code, name, module, status)
VALUES
  ('admin:catalog:manage', 'admin', '商品中心管理', 'catalog', 'enabled'),
  ('admin:inventory:manage', 'admin', '库存中心管理', 'inventory', 'enabled'),
  ('admin:supplier:manage', 'admin', '供应商管理', 'supplier', 'enabled'),
  ('admin:craft:manage', 'admin', '工艺中心管理', 'craft', 'enabled'),
  ('admin:order:manage', 'admin', '订单中心管理', 'order', 'enabled');

INSERT INTO role_permissions (role_id, permission_code)
VALUES
  (1, 'admin:catalog:manage'),
  (1, 'admin:inventory:manage'),
  (1, 'admin:supplier:manage'),
  (1, 'admin:craft:manage'),
  (1, 'admin:order:manage');
