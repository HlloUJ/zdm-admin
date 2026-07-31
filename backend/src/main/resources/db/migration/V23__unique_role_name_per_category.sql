ALTER TABLE roles
ADD CONSTRAINT uk_roles_category_name UNIQUE (category, name);
