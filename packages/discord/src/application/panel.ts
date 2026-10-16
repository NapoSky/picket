/** V2 components, independent of Discord API types and numeric constants. */
export interface PanelButton {
  readonly kind: 'button';
  readonly customId: string;
  readonly label: string;
  /** Unicode emoji displayed beside the label. */
  readonly emoji?: string;
  readonly style?: 'primary' | 'secondary' | 'success' | 'danger';
  readonly disabled?: boolean;
}

export interface PanelChoice {
  readonly label: string;
  readonly value: string;
  readonly selected?: boolean;
}

export type PanelSelect =
  | { readonly kind: 'stringSelect'; readonly customId: string; readonly placeholder: string; readonly options: readonly PanelChoice[] }
  | { readonly kind: 'roleSelect'; readonly customId: string; readonly placeholder: string; readonly maxValues?: number }
  | { readonly kind: 'channelSelect'; readonly customId: string; readonly placeholder: string; readonly maxValues?: number; readonly channelKinds?: readonly ('text' | 'announcement' | 'voice' | 'stage' | 'category')[] };

export type PanelContent =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'separator' }
  | { readonly kind: 'section'; readonly text: string; readonly button: PanelButton }
  | { readonly kind: 'buttons'; readonly buttons: readonly PanelButton[] }
  | PanelSelect;

export interface PanelView {
  readonly components: readonly PanelContent[];
  readonly accentColor?: number;
}
