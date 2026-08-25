ALTER TABLE slab_grades
  ADD COLUMN sort_order INT NOT NULL DEFAULT 0 AFTER name;

CREATE TEMPORARY TABLE slab_grade_order AS
SELECT
  id,
  ROW_NUMBER() OVER (ORDER BY created_at DESC, id DESC) AS order_position
FROM slab_grades;

UPDATE slab_grades grade
JOIN slab_grade_order ordered_grade ON ordered_grade.id = grade.id
SET grade.sort_order = ordered_grade.order_position;

DROP TEMPORARY TABLE slab_grade_order;

ALTER TABLE slab_grades
  ADD CONSTRAINT chk_slab_grades_sort CHECK (sort_order > 0),
  ADD KEY idx_slab_grades_status_sort (status, sort_order, id);
