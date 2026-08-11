import type { MessageInfoOptions } from 'tdesign-vue-next';
import { MessagePlugin } from 'tdesign-vue-next';

type FeedbackTheme = 'success' | 'error' | 'warning' | 'info';
type FeedbackInput = string | MessageInfoOptions;

interface ActiveFeedback {
  content: string;
  handle: ReturnType<(typeof MessagePlugin)['success']>;
  theme: FeedbackTheme;
  timer: ReturnType<typeof setTimeout>;
}

interface ActionFeedbackOptions {
  action: string;
  error?: unknown;
  fallback?: string;
  target?: string;
}

const DEFAULT_DURATION: Record<FeedbackTheme, number> = {
  success: 2500,
  info: 2500,
  warning: 4000,
  error: 4000,
};

const MAX_VISIBLE_MESSAGES = 3;
const DEDUPE_WINDOW = 800;
const activeFeedback: ActiveFeedback[] = [];
let lastFeedback: {
  content: string;
  createdAt: number;
  handle: ActiveFeedback['handle'];
  theme: FeedbackTheme;
} | null = null;

function getContent(input: FeedbackInput): string {
  if (typeof input === 'string') return input.trim();
  return typeof input.content === 'string' ? input.content.trim() : '';
}

function removeActiveFeedback(entry: ActiveFeedback) {
  const index = activeFeedback.indexOf(entry);
  if (index >= 0) activeFeedback.splice(index, 1);
}

function showFeedback(theme: FeedbackTheme, input: FeedbackInput) {
  const content = getContent(input);
  const createdAt = Date.now();

  if (
    content &&
    lastFeedback?.theme === theme &&
    lastFeedback.content === content &&
    createdAt - lastFeedback.createdAt < DEDUPE_WINDOW
  ) {
    return lastFeedback.handle;
  }

  while (activeFeedback.length >= MAX_VISIBLE_MESSAGES) {
    const oldest = activeFeedback.shift();
    if (!oldest) break;
    clearTimeout(oldest.timer);
    void oldest.handle.then((instance) => instance.close());
  }

  const sourceOptions = typeof input === 'string' ? {} : input;
  const duration = DEFAULT_DURATION[theme];
  const handle = MessagePlugin[theme]({
    ...sourceOptions,
    className: ['zdm-admin-feedback', sourceOptions.className].filter(Boolean).join(' '),
    content,
    duration,
    offset: [0, -8],
    placement: 'top',
  });
  const entry: ActiveFeedback = {
    content,
    handle,
    theme,
    timer: setTimeout(() => removeActiveFeedback(entry), duration + 300),
  };

  activeFeedback.push(entry);
  lastFeedback = { content, createdAt, handle, theme };
  return handle;
}

export function buildActionSuccessText(action: string, target?: string) {
  return target ? `已${action}“${target}”` : `${action}已完成`;
}

export function getSafeErrorMessage(error: unknown, fallback = '请稍后重试') {
  const message = error instanceof Error ? error.message.trim() : '';
  if (!message) return fallback;

  const looksLikeInternalDetail =
    /\b(sql|jdbc|stack\s*trace|exception|select|insert|constraint)\b/i.test(message) || /delete\s+from/i.test(message);
  return looksLikeInternalDetail ? fallback : message;
}

export const adminFeedback = {
  success: (input: FeedbackInput) => showFeedback('success', input),
  error: (input: FeedbackInput) => showFeedback('error', input),
  warning: (input: FeedbackInput) => showFeedback('warning', input),
  info: (input: FeedbackInput) => showFeedback('info', input),
  deleted: (target: string) => showFeedback('success', buildActionSuccessText('删除', target)),
  actionSuccess: ({ action, target }: ActionFeedbackOptions) =>
    showFeedback('success', buildActionSuccessText(action, target)),
  actionError: ({ action, error, fallback, target }: ActionFeedbackOptions) => {
    const subject = target ? `${action}“${target}”` : action;
    return showFeedback('error', `${subject}失败：${getSafeErrorMessage(error, fallback)}`);
  },
};
