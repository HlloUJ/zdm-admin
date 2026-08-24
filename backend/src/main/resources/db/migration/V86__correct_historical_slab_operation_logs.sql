UPDATE slab_operation_logs
SET operation_summary = CASE operation_type
      WHEN 'DELETE_TO_RECYCLE' THEN '删除至回收站'
      WHEN 'PHYSICAL_DELETE' THEN '物理删除外部大板'
      WHEN 'PURGE' THEN '彻底删除大板'
      ELSE operation_summary
    END,
    before_status = CASE operation_type WHEN 'PURGE' THEN 'recycle' ELSE before_status END,
    after_status = CASE operation_type
      WHEN 'DELETE_TO_RECYCLE' THEN 'recycle'
      ELSE after_status
    END
WHERE operation_type IN ('DELETE_TO_RECYCLE', 'PHYSICAL_DELETE', 'PURGE');
