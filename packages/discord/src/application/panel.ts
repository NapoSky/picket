/** Composants V2, indépendants des types et des valeurs numériques de l'API Discord. */
export interface PanelButton {
  readonly kind: 'button';
  readonly customId: string;
  readonly label: string;
  /** Emoji Unicode affiché à côté du libellé. */
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
  | { readonly kind: 'roleSelect' | 'channelSelect'; readonly customId: string; readonly placeholder: string };

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
