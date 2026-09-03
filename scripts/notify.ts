import type { Activity } from '../shared/types';
import type { Alert, AlertKind } from './diff';

const AMC_ORIGIN = 'https://activities.outdoors.org';

/** Discord caps a message at 10 embeds and an embed title at 256 characters. */
const MAX_EMBEDS_PER_MESSAGE = 10;
const TITLE_MAX = 200;
/**
 * Far below Discord's 2048 footer limit, because the binding constraint is the
 * 6000-character total across all embeds in one message. At 10 embeds, a title
 * of 200 and a footer of 100 leaves comfortable headroom.
 *
 * Untruncated, a single long watch name makes Discord reject the entire batch
 * with a 400 - which fails the poll and suppresses every alert, not just that one.
 */
const FOOTER_MAX = 100;

const COLORS: Record<AlertKind, number> = {
  new: 0x2d5bd1,
  reopened: 0x14713f,
};

export interface DiscordEmbed {
  title: string;
  url: string;
  color: number;
  fields: Array<{ name: string; value: string; inline: boolean }>;
  footer: { text: string };
}

export interface DiscordMessage {
  embeds: DiscordEmbed[];
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 3)}...`;
}

function dateRange(a: Activity): string {
  return a.startDate === a.endDate ? a.startDate : `${a.startDate} - ${a.endDate}`;
}

export function buildEmbed(alert: Alert, chapterName: (id: string) => string): DiscordEmbed {
  const a = alert.activity;
  const prefix = alert.kind === 'reopened' ? 'Reopened - spot available' : 'New';

  const fields = [
    { name: 'Dates', value: dateRange(a), inline: true },
    { name: 'Chapter', value: chapterName(a.chapterId), inline: true },
    { name: 'Type', value: a.type, inline: true },
    { name: 'Difficulty', value: a.difficultyLabel, inline: true },
    { name: 'Status', value: a.status, inline: true },
  ];
  const leader = a.leaders[0];
  if (leader !== undefined) fields.push({ name: 'Leader', value: leader, inline: true });

  return {
    title: truncate(`${prefix}: ${a.name}`, TITLE_MAX),
    url: `${AMC_ORIGIN}${a.url}`,
    color: COLORS[alert.kind],
    fields,
    footer: { text: truncate(`Watch: ${alert.watchName}`, FOOTER_MAX) },
  };
}

/**
 * Reopened alerts lead. A spot opening on a full trip is time-sensitive in a way
 * a new listing is not, and it must not be buried under a batch of new ones.
 */
export function buildMessages(
  alerts: Alert[],
  chapterName: (id: string) => string,
): DiscordMessage[] {
  const ordered = [...alerts].sort((x, y) => {
    if (x.kind !== y.kind) return x.kind === 'reopened' ? -1 : 1;
    return x.activity.startDate < y.activity.startDate ? -1 : 1;
  });

  const messages: DiscordMessage[] = [];
  for (let i = 0; i < ordered.length; i += MAX_EMBEDS_PER_MESSAGE) {
    messages.push({
      embeds: ordered.slice(i, i + MAX_EMBEDS_PER_MESSAGE).map((a) => buildEmbed(a, chapterName)),
    });
  }
  return messages;
}

/**
 * Splits alerts by destination, then batches each group independently so the
 * ten-embed cap applies per channel rather than across all of them.
 *
 * Keyed by environment variable name, not by URL: this key reaches log output.
 */
export function buildRoutedMessages(
  alerts: Alert[],
  chapterName: (id: string) => string,
  route: (watchId: string) => string,
): Map<string, DiscordMessage[]> {
  const byChannel = new Map<string, Alert[]>();
  for (const alert of alerts) {
    const env = route(alert.watchId);
    const bucket = byChannel.get(env);
    if (bucket === undefined) byChannel.set(env, [alert]);
    else bucket.push(alert);
  }

  const routed = new Map<string, DiscordMessage[]>();
  for (const [env, group] of byChannel) {
    routed.set(env, buildMessages(group, chapterName));
  }
  return routed;
}

async function postOne(webhookUrl: string, message: DiscordMessage): Promise<void> {
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(message),
  });

  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('retry-after') ?? '5');
    console.warn(`[notify] rate limited, retrying in ${retryAfter}s`);
    await new Promise((r) => setTimeout(r, retryAfter * 1000));
    return postOne(webhookUrl, message);
  }
  if (!res.ok) {
    throw new Error(`[notify] Discord returned HTTP ${res.status}`);
  }
}

/** No alerts means no request at all - never post an empty batch. */
export async function postAlerts(webhookUrl: string, messages: DiscordMessage[]): Promise<void> {
  for (const message of messages) {
    await postOne(webhookUrl, message);
  }
}
