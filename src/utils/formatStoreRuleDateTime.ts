/** Store rule APIs return MySQL DATETIME values in Asia/Shanghai, without a zone suffix. */
export const formatStoreRuleDateTime = (value?: string) => {
  if (!value) return '-';
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(value);
  if (!match) return '-';
  return `${match[1]}/${match[2]}/${match[3]} ${match[4]}:${match[5]}`;
};
