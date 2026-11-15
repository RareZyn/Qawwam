# Qawwam

> Draft for review. Converted from `Qawwam.docx`; functional requirements and database design completed.

| Document | Contents |
|---|---|
| [README.md](README.md) | Overview, objectives, tech stack, theme, assumptions and open questions |
| [requirements.md](requirements.md) | Functional requirements (FR-001 to FR-070) and non-functional requirements |
| [database.md](database.md) | Firestore data model, ER diagram, seed data |

---

## 1. Project Overview

Qawwam is an all-rounder mobile app (PWA) for personal daily use. It tracks what Razin needs day to day, and uses a score system to encourage consistency and productivity.

Modules:

1. Personal good and bad habit tracker
2. Money management
3. Password saver
4. To-do list
5. Book reading tracker
6. Notifications

## 2. Project Objectives

### 2.1 Personal Good and Bad Habit Tracker

- Good and bad habits can be added.
- Each habit has a recurrence chosen by the user: daily, certain days, weekly or monthly.
- Good habits carry **positive** score points; bad habits carry **negative** score points. The user decides the points.
- A dashboard shows the final score per day, week and month.
- The dashboard includes a GitHub-style contribution heatmap (the "repo" look: a calendar grid where a darker or brighter cell means a higher score for that day).

### 2.2 Money Management

**Principle:** quick and efficient. If tracking feels complicated, the user will lose interest.

- Wallets can be created with: title, amount, bank, type (`saving`, `investment`, `cash`).
- Three fixed groups, each holding a list of items that can be added and removed:

  | # | Group | Behaviour |
  |---|---|---|
  | i | Savings and Investment | Reminder every **25th** of the month to deduct. Items are a simple checkbox. |
  | ii | Subscription and Fixed | Reminder depends on each item. Items are a simple checkbox. |
  | iii | Spent and Cash | Tracks how much was spent per item (food, clothes, etc.). Needs a placeholder to track. |

- Each item is mapped to a wallet and auto-deducts from that wallet.
- Quick track: deduct directly from a wallet with no category, then categorise later.
- Each group shows a **total**.
- Spent and Cash uses **one big cash wallet**, because sometimes no category fits. Spending in any sub-category (and uncategorised spending) reduces this wallet, so total spending cannot exceed the cash in hand.
- Everything can be edited later.
- Sample data is pre-saved in the database (see [database.md](database.md#9-seed-data)).

### 2.3 Password Saver

- Stores a list of accounts, usernames and passwords.
- A **pattern lock** (like a phone screen lock) must be passed before any password can be seen.
- Password suggestion based on rules: minimum length, special characters, capital and small letters, etc.
- A dashboard shows categories and which accounts share the same password.

### 2.4 To-Do List

- Groups and lists of things to do.
- Each task has a due date and can be marked urgent.

### 2.5 Book Reading Tracker

- Records the book title and the page the user is on.
- Should be available as a widget on the homepage, so it is the quickest module to update.

### 2.6 Notifications

- Available for all modules.
- The user can set when to be notified and the recurrence.

## 3. Technology

| Area | Choice |
|---|---|
| Frontend | React, TypeScript |
| App type | Progressive Web App (PWA) |
| Database | Firebase (Cloud Firestore) |
| Authentication | Firebase Authentication |

## 4. Theme

Futuristic.

| Role | Colour | Hex |
|---|---|---|
| Main | Raven Black | `#080402` |
| Secondary | Powder Blue | `#B6DFF5` |
| Highlight | Poppy Red | `#E0091F` |

---

## 5. Assumptions and Open Questions

Please review these. Each one affects the requirements or the data model.

| # | Item | What I assumed | Please confirm |
|---|---|---|---|
| 1 | "Gaji bersih (KWSP, SOCSO, EIS) 472.4" in the sample data | Not seeded as a group item. It is the only row without a clear group, and 472.4 looks too small to be a monthly net salary. | What is this figure: income, a statutory deduction, or something else? |
| 2 | Reminders on a schedule (25th of the month, recurring) | Requires server-side scheduling (Cloud Functions + Cloud Scheduler), which needs the Firebase **Blaze** (pay-as-you-go) plan. Usage at personal scale is normally within the free quota. | OK to use Blaze? Otherwise reminders only work while the app is open. |
| 3 | Push notifications on iPhone | iOS only delivers web push to a PWA that has been **installed to the Home Screen**. | Which phone do you use? |
| 4 | Pattern lock security | A pattern has low entropy, so it is treated as a **screen gate** only. Passwords are encrypted with a key derived from a **master passphrase** set once; the pattern unlocks the cached key on the device. | Accept a master passphrase on first setup? |
| 5 | Money amounts | Single currency (MYR), stored as integer sen to avoid rounding errors. | Is MYR the only currency? |
| 6 | Wallet for Savings and Investment items | Each item is mapped to a wallet. "Paid" for group i and ii is a monthly checkbox that deducts from the mapped wallet. | Should ticking the checkbox always deduct, or only record "paid"? |
| 7 | Spent and Cash overspend | The cash pool and its sub-category budgets are checked. The app **warns** when sub-category budgets exceed the pool, and when spending exceeds the pool. It does not block. | Warn only, or block? |
| 8 | Sample data language | Original Malay item names are kept as written. | Keep Malay, or translate? |
| 9 | Single user | The app is for Razin only. The data model is still per-user (`users/{user_id}/...`) so Firestore rules stay simple. | Any plan for other users? |

---

## 6. Running the App

### Before the first live run (one time, in the Firebase console for project `qawwam`)

1. **Firestore:** Build › Firestore Database › Create database (production mode, region `asia-southeast1`).
2. **Authentication:** Build › Authentication › Get started, then enable **Email/Password** and **Google**.
3. **Rules:** `npx firebase login`, then `npm run deploy:rules` (publishes `firestore.rules`).
4. **Hosting (optional):** `npm run deploy` builds and publishes to `https://qawwam.web.app`.

On the first sign-in the app loads its starting data by itself: your money data from `CashFlow RAZIN.xlsx` and the example data from the design. Settings › Data › *Remove examples* deletes the examples and keeps the money data.

### Commands

| Command | What it does |
|---|---|
| `npm run dev` | Run the app locally against the live Firebase project |
| `npm run emulators` + `npm run dev:emu` | Run the app against local emulators (no live data touched) |
| `npm test` | Unit tests (dates, money, streaks, recurrence, seed totals, vault encryption) |
| `npm run test:db` | Database tests on the emulators (security rules, money transactions, scores, seed) |
| `npm run test:e2e` | Browser tests at phone (390 × 844) and desktop (1440 × 900) sizes, plus PWA speed and offline |
| `npm run build` | Type-check and build the production PWA into `dist/` |

### Where things are

| Path | Contents |
|---|---|
| `src/lib/` | Data layer: Firestore access (`db.ts`), habits, money, actions, vault crypto, seed data |
| `src/pages/` | One file per screen; each screen is loaded on demand |
| `src/Shell.tsx` | Navigation (bottom tabs on phones, sidebar on desktop), reminders, vault auto-lock |
| `firestore.rules` | Owner-only access, whole-sen money, habit point signs |
| `tests/` | `unit/`, `emulator/` and `e2e/` test suites |
