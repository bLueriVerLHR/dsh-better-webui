/**
 * Client-side remote type augmentation for the better-webui namespace.
 */
import type {
  RemoteResult, TypertRemoteNamespace,
} from '@deepseek-ai/dsh-typert-protocol'
import type { BetterWebMetadata } from '../shared/types.ts'

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
