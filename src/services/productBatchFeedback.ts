import { ApiError } from './http';
export function batchRequestError(error: unknown, operation: '上架' | '删除'): string {
  return error instanceof ApiError && error.status >= 400 && error.status < 500
    ? error.message
    : `未能获取完整${operation}结果，请刷新列表核对商品状态。`;
}
