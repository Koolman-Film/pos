/**
 * การแจ้งเตือน — shapes shared by the server that works them out and the bell
 * that shows them.
 *
 * An alert is never stored. It is the answer, right now, to a question about the
 * live data ("is any price waiting for approval?"), so it disappears the moment
 * the thing it points at is dealt with. See docs/DESIGN-notifications.md.
 */

/**
 * ด่วน — money is already late or at risk (a cheque past its date, a bill past
 * due). ต้องทำ — somebody has to act. แจ้งให้ทราบ — worth knowing, never pops up
 * and never counts on the bell.
 */
export type AlertLevel = 'urgent' | 'todo' | 'info';

export type AlertItem = {
  /** Stable per kind of alert, e.g. `po.priceApproval`. */
  key: string;
  level: AlertLevel;
  /** A plain sentence — the shop asked for messages, not day counts. */
  title: string;
  count: number;
  /** The list it opens, already filtered to exactly these records. */
  href: string;
  /**
   * One id per record behind the count. Stored when somebody acknowledges the
   * day, so an urgent record that turns up later can be told apart from the
   * ones they already saw.
   */
  itemIds: string[];
  /** Up to three document numbers to show under the title. */
  examples: string[];
};

export type AlertSnapshot = {
  /** The shop's calendar day the snapshot was taken on (`YYYY-MM-DD`). */
  today: string;
  alerts: AlertItem[];
  /** "รับทราบ · ซ่อนถึงพรุ่งนี้" was pressed today. */
  ackedToday: boolean;
  /** The urgent item ids on screen when it was. */
  ackedKeys: string[];
};

export const LEVEL_LABEL: Record<AlertLevel, string> = {
  urgent: 'ด่วน',
  todo: 'ต้องทำ',
  info: 'แจ้งให้ทราบ',
};

export const LEVEL_ORDER: AlertLevel[] = ['urgent', 'todo', 'info'];

/** What the bell counts and the daily window lists — everything but แจ้งให้ทราบ. */
export const actionableAlerts = (alerts: AlertItem[]) => alerts.filter((a) => a.level !== 'info');

/** The ids acknowledged by pressing รับทราบ: every urgent record on screen. */
export const urgentItemIds = (alerts: AlertItem[]) =>
  alerts.filter((a) => a.level === 'urgent').flatMap((a) => a.itemIds);
