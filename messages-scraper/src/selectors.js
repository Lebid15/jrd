// مرشّحات selectors لـ Google Messages Web. نجرّب بالترتيب حتى ينجح أحدها.
// لو غيّر Google الـ DOM، عدّل هنا فقط.

export const LIST_SHELL_CANDIDATES = [
  'mws-conversations-list',
  'mw-conversations-list',
  'mws-conversation-list',
  'mw-conversation-list',
];

export const LIST_ITEM_CANDIDATES = [
  'mws-conversation-list-item',
  'mw-conversation-list-item',
  'mws-conversation-item',
  'mw-conversation-item',
  'a.list-item',
  '[data-e2e-conversation-list-item]',
];

export const ITEM_NAME_CANDIDATES = [
  '.name',
  '.text-content .name',
  'h3',
  '[data-e2e-conversation-name]',
];

export const MESSAGE_WRAPPER_CANDIDATES = [
  'mws-message-wrapper',
  'mw-message-wrapper',
  'mws-incoming-message',
  '[data-e2e-message-wrapper]',
];

export const MESSAGE_TEXT_CANDIDATES = [
  'mws-text-message-part',
  'mw-text-message-part',
  '.text-msg-content',
  '[data-e2e-message-text]',
];
