import { adminFeedback } from '@/components/foundation';
import { getLoginUser } from '@/services/auth';

export const CREATOR_OWNERSHIP_MESSAGE = '不可操作其他用户添加的数据';

export interface CreatorOwnedRecord {
  createdByAccountId?: number | null;
  createdByName?: string | null;
}

function isCreatorOwned(record: CreatorOwnedRecord) {
  const currentUser = getLoginUser();
  return record.createdByAccountId == null
    ? record.createdByName?.trim() === currentUser.name.trim()
    : Number(record.createdByAccountId) === currentUser.id;
}

export function requireCreatorOwnership(...records: CreatorOwnedRecord[]) {
  const ownsAllRecords = records.every(isCreatorOwned);
  if (!ownsAllRecords) adminFeedback.warning(CREATOR_OWNERSHIP_MESSAGE);
  return ownsAllRecords;
}
