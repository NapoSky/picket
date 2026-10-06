import {
  ButtonStyle, ChannelType, ComponentType, MessageFlags,
  type APIActionRowComponent, type APIComponentInMessageActionRow, type APIComponentInContainer,
} from 'discord-api-types/v10';
import type { PanelButton, PanelContent, PanelView } from '../application/panel';
import type { ReplyContent } from '../application/messaging';

const clip = (text: string, max: number): string => text.length <= max ? text : `${text.slice(0, max - 1)}…`;

function button(view: PanelButton) {
  return {
    type: ComponentType.Button as const,
    custom_id: view.customId,
    label: clip(view.label, 80),
    ...(view.emoji === undefined ? {} : { emoji: { name: view.emoji } }),
    style: ({ primary: ButtonStyle.Primary, secondary: ButtonStyle.Secondary, success: ButtonStyle.Success, danger: ButtonStyle.Danger } as const)[view.style ?? 'secondary'],
    ...(view.disabled === undefined ? {} : { disabled: view.disabled }),
  };
}

function row(component: APIComponentInMessageActionRow): APIActionRowComponent<APIComponentInMessageActionRow> {
  return { type: ComponentType.ActionRow, components: [component] };
}

function component(view: PanelContent): APIComponentInContainer {
  switch (view.kind) {
    case 'text': return { type: ComponentType.TextDisplay, content: clip(view.text, 4000) };
    case 'separator': return { type: ComponentType.Separator, divider: true, spacing: 1 };
    case 'section': return {
      type: ComponentType.Section,
      components: [{ type: ComponentType.TextDisplay, content: clip(view.text, 4000) }],
      accessory: button(view.button),
    };
    case 'buttons':
      if (view.buttons.length < 1 || view.buttons.length > 5) throw new Error('Invalid panel button row');
      return { type: ComponentType.ActionRow, components: view.buttons.map(button) };
    case 'stringSelect':
      if (view.options.length < 1 || view.options.length > 25) throw new Error('Invalid panel select choices');
      return row({
        type: ComponentType.StringSelect, custom_id: view.customId, placeholder: clip(view.placeholder, 150),
        min_values: 1, max_values: 1,
        options: view.options.map((choice) => ({ label: clip(choice.label, 100), value: choice.value, default: choice.selected ?? false })),
      });
    case 'roleSelect': return row({ type: ComponentType.RoleSelect, custom_id: view.customId, placeholder: clip(view.placeholder, 150), min_values: 1, max_values: 1 });
    case 'channelSelect': return row({ type: ComponentType.ChannelSelect, custom_id: view.customId, placeholder: clip(view.placeholder, 150), min_values: 1, max_values: 1, channel_types: [ChannelType.GuildText, ChannelType.GuildAnnouncement] });
  }
}

export function toWirePanel(panel: PanelView) {
  const customIds = new Set<string>();
  for (const item of panel.components) {
    const ids = item.kind === 'section' ? [item.button.customId]
      : item.kind === 'buttons' ? item.buttons.map((button) => button.customId)
      : 'customId' in item ? [item.customId] : [];
    for (const id of ids) {
      if (id.length < 1 || id.length > 100) throw new Error('Invalid panel component custom ID');
      if (customIds.has(id)) throw new Error('Duplicate panel component custom ID');
      customIds.add(id);
    }
  }
  const count = 1 + panel.components.reduce((total, item) => total + (
    item.kind === 'section' ? 3 : item.kind === 'buttons' ? 1 + item.buttons.length : item.kind.endsWith('Select') ? 2 : 1
  ), 0);
  if (count > 40) throw new Error('Panel exceeds Discord component limit');
  const textLength = panel.components.reduce((total, item) => total + (item.kind === 'text' || item.kind === 'section' ? Math.min(item.text.length, 4000) : 0), 0);
  if (textLength > 4000) throw new Error('Panel exceeds Discord text limit');
  return {
    flags: MessageFlags.IsComponentsV2,
    allowed_mentions: { parse: [] as never[] },
    components: [{ type: ComponentType.Container as const, accent_color: panel.accentColor ?? 0x435768, components: panel.components.map(component) }],
  };
}

export function toWireReplyContent(content: ReplyContent) {
  return typeof content === 'string' ? { content, allowed_mentions: { parse: [] as never[] } } : toWirePanel(content);
}
