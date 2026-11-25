/** Shared types, one per Firestore collection (see database.md). `id` is the document ID and is not stored as a field. */

export type Frequency = 'once' | 'daily' | 'weekly' | 'monthly';

export interface Recurrence {
  frequency: Frequency;
  interval: number;
  /** weekly: 0 = Sunday .. 6 = Saturday. More than one value means "certain days". */
  days_of_week?: number[];
  /** monthly: 1..31, clamped to the last day of shorter months. */
  day_of_month?: number;
  /** once: the date it happens on. */
  date?: string;
  /** HH:mm, used by reminders. */
  time?: string;
}

export interface Habit {
  id: string;
  name: string;
  type: 'good' | 'bad';
  points: number;
  note: string | null;
  recurrence: Recurrence;
  start_date: string;
  status: 'active' | 'paused' | 'archived';
  /** Bad habits only: count clean days in a row and show the streak card on Home. */
  track_streak: boolean;
  show_on_home: boolean;
  /** First clean day of the current streak. */
  streak_start: string | null;
  prev_streak_start: string | null;
  best_streak: number;
  sort_order: number;
  sample?: boolean;
}

export interface HabitLog {
  id: string;
  habit_id: string;
  log_date: string;
  /** Times it happened that day. 0 on a streak habit means "checked in clean". */
  count: number;
  points: number;
  score: number;
  sample?: boolean;
}

export interface Summary {
  id: string;
  period_type: 'day' | 'week' | 'month';
  period_key: string;
  period_start: string;
  period_end: string;
  score: number;
  good_count: number;
  bad_count: number;
  sample?: boolean;
}

export type WalletType = 'saving' | 'investment' | 'cash';

export interface Wallet {
  id: string;
  title: string;
  /** sen */
  balance: number;
  bank: string | null;
  type: WalletType;
  is_cash_pool: boolean;
  status: 'active' | 'archived';
  sort_order: number;
}

export interface WalletSnapshot {
  id: string;
  wallet_id: string;
  month: string;
  balance: number;
}

export type GroupCode = 'savings_investment' | 'subscription_fixed' | 'spent_cash';

export interface MoneyItem {
  id: string;
  group_id: GroupCode;
  wallet_id: string | null;
  name: string;
  /** sen: planned amount, or the monthly budget for Spent & Cash. */
  amount: number;
  due_day: number | null;
  remind_days_before: number;
  sort_order: number;
  status: 'active' | 'removed';
}

export interface ItemPayment {
  id: string;
  item_id: string;
  month: string;
  amount: number;
  is_paid: boolean;
  paid_at: number | null;
  transaction_id: string | null;
  /** Wallet and signed amount of the linked transaction, kept so unticking can reverse it without a lookup. */
  wallet_id: string | null;
  txn_amount: number | null;
}

export type TxnSource = 'quick' | 'item_spend' | 'item_payment' | 'adjustment';

export interface Txn {
  id: string;
  wallet_id: string;
  group_id: GroupCode | null;
  item_id: string | null;
  payment_id: string | null;
  /** signed sen: negative leaves the wallet, positive enters it. */
  amount: number;
  source: TxnSource;
  note: string | null;
  txn_date: string;
  created_ms: number;
}

export interface GenRules {
  length: number;
  upper: boolean;
  lower: boolean;
  digits: boolean;
  symbols: boolean;
}

export interface PwCategory {
  id: string;
  name: string;
  gen_rules: GenRules | null;
  sort_order: number;
}

export interface PwEntry {
  id: string;
  category_id: string;
  account_name: string;
  url: string | null;
  /** AES-256-GCM ciphertext of {username, password, note}, base64. */
  data_enc: string;
  iv: string;
  password_fingerprint: string;
  sample?: boolean;
}

export interface PwSecret {
  username: string;
  password: string;
  note: string;
}

export interface TodoGroup {
  id: string;
  name: string;
  sort_order: number;
  sample?: boolean;
}

export interface TodoItem {
  id: string;
  group_id: string;
  title: string;
  note: string | null;
  due_date: string | null;
  is_urgent: boolean;
  status: 'open' | 'done';
  completed_ms: number | null;
  created_ms: number;
  sample?: boolean;
}

export interface Book {
  id: string;
  title: string;
  author: string | null;
  total_pages: number | null;
  current_page: number;
  status: 'reading' | 'finished' | 'on_hold';
  show_on_home: boolean;
  started_at: string | null;
  finished_at: string | null;
  created_ms: number;
  sample?: boolean;
}

export interface ReadingLog {
  id: string;
  book_id: string;
  log_date: string;
  page: number;
  pages_read: number;
  sample?: boolean;
}

export type ReminderModule = 'habit' | 'money_group' | 'money_item' | 'todo' | 'book' | 'custom';

export interface Reminder {
  id: string;
  module: ReminderModule;
  ref_id: string | null;
  title: string;
  body: string | null;
  recurrence: Recurrence;
  remind_days_before: number;
  is_enabled: boolean;
  is_system: boolean;
  /** epoch ms */
  next_fire_at: number | null;
  last_fired_at: number | null;
  sample?: boolean;
}

export interface Notif {
  id: string;
  reminder_id: string;
  module: ReminderModule;
  title: string;
  body: string | null;
  sent_at: number;
  read_at: number | null;
}

export interface Settings {
  currency: string;
  cash_wallet_id: string | null;
  /** sen */
  monthly_income: number;
  savings_reminder_day: number;
  /** Day the money month starts (payday), 1..28. Missing means 1, the calendar month. */
  money_cycle_day?: number;
  lock_timeout_seconds: number;
  notifications_enabled: Record<string, boolean>;
  vault_kdf_salt: string | null;
  vault_key_wrapped: string | null;
  vault_key_iv: string | null;
  seed_version: number | null;
  seeded_ms: number | null;
  sample_removed_ms: number | null;
}
