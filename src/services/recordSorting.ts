interface CreatedRecord {
  id: number;
  createdAt?: string;
}

const createdAtTimestamp = (record: CreatedRecord) => {
  const timestamp = new Date(record.createdAt ?? '').getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
};

export const sortByCreatedAtDesc = <T extends CreatedRecord>(records: readonly T[]) =>
  [...records].sort((first, second) => createdAtTimestamp(second) - createdAtTimestamp(first) || second.id - first.id);
