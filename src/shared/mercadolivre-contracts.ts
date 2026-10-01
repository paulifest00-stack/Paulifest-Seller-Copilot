export interface MlAttribute { id: string; value_name?: string; value_id?: string }
export interface MlListingDraft {
  sheetId: string; title: string; familyName: string; categoryId: string;
  price: number; quantity: number; listingType: 'gold_special' | 'gold_pro';
  condition: 'new' | 'used'; sku: string; description: string;
  attributes: MlAttribute[]; pictureIds: string[];
  shippingMode: 'me2' | 'custom'; freeShipping: boolean; localPickup: boolean;
}
export interface MlPreparedListing {
  id: string; hash: string; payload: Record<string, unknown>; description: string;
  account: { id: string; nickname: string }; warnings: string[]; expiresAt: string;
}
export type MlAction = 'status' | 'start' | 'disconnect' | 'category' | 'quote' | 'picture' | 'prepare' | 'publish' | 'item' | 'sync' | 'pricing-context' | 'pricing-quote' | 'pricing-categories';
export const ML_ACTIONS: MlAction[] = ['status', 'start', 'disconnect', 'category', 'quote', 'picture', 'prepare', 'publish', 'item', 'sync', 'pricing-context', 'pricing-quote', 'pricing-categories'];

export type MlConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface MlConnectionInfo {
  connected: boolean;
  status: MlConnectionStatus;
  sellerId?: string;
  nickname?: string;
  siteId?: string;
  authType?: 'oauth' | 'direct_token';
  lastValidatedAt?: string;
  error?: string;
}
