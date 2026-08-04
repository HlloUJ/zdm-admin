ALTER TABLE category_attributes
  ADD COLUMN publish_status VARCHAR(20) NOT NULL DEFAULT 'unpublished' AFTER sort_order;
