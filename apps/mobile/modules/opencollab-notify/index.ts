import { Platform } from 'react-native'
import { requireOptionalNativeModule } from 'expo'

type NotifyModule = {
  enabled(): boolean
  post(
    id: number,
    title: string,
    body: string,
    url: string,
    channelName: string,
    publicText: string
  ): boolean
}

// Android only; null elsewhere and in builds made before the module existed.
export const OpenCollabNotify: NotifyModule | null =
  Platform.OS === 'android' ? requireOptionalNativeModule<NotifyModule>('OpenCollabNotify') : null
