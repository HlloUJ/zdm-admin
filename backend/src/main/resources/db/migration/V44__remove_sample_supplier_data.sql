-- Remove the original supplier demo records only while they and their seeded
-- inventory records are still untouched. User-edited suppliers or records with
-- any additional business references are preserved.
DELETE si
FROM slab_inventory si
JOIN suppliers s ON s.id = si.supplier_id
WHERE si.id = 1
  AND si.supplier_id = 1
  AND si.variety_id = 1
  AND si.name = '潘多拉精选大板 A001'
  AND si.serial_no = 'SLAB-A001'
  AND si.warehouse = '云浮仓'
  AND si.publisher_type = '平台发布'
  AND si.length_mm = 3200
  AND si.width_mm = 1800
  AND si.thickness_mm = 18
  AND si.area_square_meter = 5.76
  AND si.cost_price = 6800.00
  AND si.guide_price = 9800.00
  AND si.status = 'warehouse'
  AND s.name = '云浮优选大板供应商'
  AND s.type = 'slab'
  AND s.contact_name = '供应商经理'
  AND s.contact_phone = '13900000001'
  AND s.region = '广东省云浮市'
  AND s.address IS NULL
  AND s.qualification_status = 'pending'
  AND s.remark = '系统内置供应商'
  AND s.status = 'enabled';

DELETE fp
FROM finished_products fp
JOIN suppliers s ON s.id = fp.supplier_id
WHERE fp.id = 1
  AND fp.category_id = 3
  AND fp.supplier_id = 2
  AND fp.name = '潘多拉奢石餐桌 1.8m'
  AND fp.sku = 'FP-PANDORA-TABLE-1800'
  AND fp.cover_image IS NULL
  AND fp.publisher_type = '平台发布'
  AND fp.total_stock = 8
  AND fp.guide_price = 26800.00
  AND fp.status = 'warehouse'
  AND s.name = '装点猫成品协作工厂'
  AND s.type = 'finished'
  AND s.contact_name = '工厂经理'
  AND s.contact_phone = '13900000002'
  AND s.region = '湖北省襄阳市'
  AND s.address IS NULL
  AND s.qualification_status = 'pending'
  AND s.remark = '系统内置供应商'
  AND s.status = 'enabled';

DELETE s
FROM suppliers s
LEFT JOIN slab_inventory si ON si.supplier_id = s.id
LEFT JOIN finished_products fp ON fp.supplier_id = s.id
WHERE si.id IS NULL
  AND fp.id IS NULL
  AND s.address IS NULL
  AND s.qualification_status = 'pending'
  AND s.remark = '系统内置供应商'
  AND s.status = 'enabled'
  AND (
    (
      s.id = 1
      AND s.name = '云浮优选大板供应商'
      AND s.type = 'slab'
      AND s.contact_name = '供应商经理'
      AND s.contact_phone = '13900000001'
      AND s.region = '广东省云浮市'
    )
    OR (
      s.id = 2
      AND s.name = '装点猫成品协作工厂'
      AND s.type = 'finished'
      AND s.contact_name = '工厂经理'
      AND s.contact_phone = '13900000002'
      AND s.region = '湖北省襄阳市'
    )
  );
