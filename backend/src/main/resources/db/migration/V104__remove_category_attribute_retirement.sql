UPDATE category_attributes SET publish_status = 'unpublished' WHERE retired_flag = TRUE;
ALTER TABLE category_attributes DROP COLUMN retired_flag;
