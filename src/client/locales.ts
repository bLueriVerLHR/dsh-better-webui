/** Dictionary keys and translations for the better-webui browser plugin. */
export interface BetterSessionsKey {
  'session.new': string
  'session.blank': string
  'session.untitled': string
  'trash.delete': string
  'trash.restore': string
  'trash.destroy': string
  'trash.confirm': string
  'trash.destroy.confirm': string
  'trash.titleOnly': string
  'branch.fromHere': string
}

export const en: BetterSessionsKey = {
  'session.new': 'New session',
  'session.blank': 'New chat',
  'session.untitled': 'Untitled',
  'trash.delete': 'Delete',
  'trash.restore': 'Restore',
  'trash.destroy': 'Delete forever',
  'trash.confirm': 'Move this session to trash? It will stay visible, greyed out.',
  'trash.destroy.confirm': 'Permanently delete this session? This cannot be undone.',
  'trash.titleOnly': 'Session is in trash; content is hidden.',
  'branch.fromHere': 'Branch from here',
}

export const zh: BetterSessionsKey = {
  'session.new': '新会话',
  'session.blank': '新对话',
  'session.untitled': '无标题',
  'trash.delete': '删除',
  'trash.restore': '恢复',
  'trash.destroy': '彻底删除',
  'trash.confirm': '把该会话移入回收站？将置灰显示并排到末尾。',
  'trash.destroy.confirm': '彻底删除该会话？此操作不可撤销。',
  'trash.titleOnly': '该会话已删除，内容不可见。',
  'branch.fromHere': '从这里分支',
}
