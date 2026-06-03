export interface PendingAction {
  action: string;
  params: Record<string, unknown>;
  description: string;
  /** Slot currently being collected in a multi-turn flow */
  awaitingSlot?: string;
}
