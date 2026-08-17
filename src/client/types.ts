/**
 * Client-side type augmentation for better-webui.
 * - remote namespace types
 * - locale namespace type
 */
import type {
  RemoteResult, TypertRemoteNamespace,
} from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { BetterWebMetadata } from '../shared/types.ts'
import type { BetterSessionsKey } from './locales.ts'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteMap {
    'betterWebui/trash': (sessionId: string) => Promise<RemoteResult<void>>
    'betterWebui/restore': (sessionId: string) => Promise<RemoteResult<void>>
    'betterWebui/destroy': (sessionId: string) => Promise<RemoteResult<void>>
    'betterWebui/branch': (
      sessionId: string,
      atSeq: number,
      childSessionId?: string,
    ) => Promise<RemoteResult<string>>
    'betterWebui/meta': () => Promise<RemoteResult<BetterWebMetadata>>
  }

  interface TypertRemoteNamespaceMap {
    betterWebui: TypertRemoteNamespace<'betterWebui'>
  }
}

declare module '@deepseek-ai/dsh-client-locale/client' {
  interface LocaleNamespaceMap {
    'better-sessions': BetterSessionsKey
  }
}
