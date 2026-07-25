# Prototype map — `reference/v0.4/finnix-film.html` → production

One row per top-level construct in the prototype, in source order, with where it
ended up. Use this with [UPDATING.md](./UPDATING.md) to classify each hunk of a
new prototype drop.

The list is the prototype's own top-level `function` / `const` declarations:

```bash
grep -nE "^(function|const|let|class) " reference/v0.4/finnix-film.html
```

Line numbers are v0.4. **Not ported** rows are deliberate — check them against
this table before treating a diff there as a missed port.

## Helpers and formatting

| Prototype construct                                | v0.4 | Production location                                                                                                                                                                                                                                                                    |
| -------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useState, useEffect, useRef, useMemo` destructure | 82   | n/a — real React imports                                                                                                                                                                                                                                                               |
| `daysFromNow`                                      | 83   | `lib/domain/format.ts`                                                                                                                                                                                                                                                                 |
| `fmtThaiDate`                                      | 84   | `lib/domain/format.ts`                                                                                                                                                                                                                                                                 |
| `thaiBahtText`                                     | 85   | `lib/domain/format.ts`                                                                                                                                                                                                                                                                 |
| `isWithinDays`                                     | 109  | Inlined at `app/(app)/dashboard/page.tsx` (the 7-day booking window is its only caller)                                                                                                                                                                                                |
| `hashStr`                                          | 110  | **Not ported** — existed only to seed `seededRandom`                                                                                                                                                                                                                                   |
| `seededRandom`                                     | 111  | **Not ported** — existed only to fake trend history                                                                                                                                                                                                                                    |
| `buildTrendSeries`                                 | 112  | **Not ported** — replaced by `buildTrend` in `components/dashboard/receivables.ts`, which aggregates real tickets/expenses. Same `{labels, revenue, expense, profit}` shape, so `LineChart` is unchanged. This is the one intentional "same visual, different data source" in the port |
| `fmt`                                              | 373  | `lib/domain/format.ts`                                                                                                                                                                                                                                                                 |
| `shopName`                                         | 372  | Per-module local helper over the injected `shops` list (`components/*/…`), since shop names now arrive as props rather than a global                                                                                                                                                   |
| `getStatus`                                        | 236  | `components/ui/Badge.tsx`                                                                                                                                                                                                                                                              |
| `colorFromHex`                                     | 237  | `components/permissions/permissionMeta.ts` (+ `app/(app)/permissions/actions.ts`)                                                                                                                                                                                                      |
| `useUnsavedChangesGuard`                           | 374  | `lib/hooks/useUnsavedChangesGuard.ts`                                                                                                                                                                                                                                                  |
| `confirmDiscardIfDirty`                            | 383  | `lib/hooks/useUnsavedChangesGuard.ts` (plus `confirmDiscardIfPendingChanges` for the sidebar nav guard)                                                                                                                                                                                |
| `usePeriodFilter`                                  | 2517 | **Not ported as a hook** — the prototype only used it in `Dashboard` and inlined the same four `useState`s everywhere else. Ports keep it inline; the "today / this month / last 7 days" defaults live in `lib/domain/now.ts`                                                          |

## Domain calculations

| Prototype construct                          | v0.4    | Production location                                                               |
| -------------------------------------------- | ------- | --------------------------------------------------------------------------------- |
| `itemNetPrice`                               | 387     | `lib/domain/tickets.ts`                                                           |
| `ticketTotal`                                | 393     | `lib/domain/tickets.ts`                                                           |
| `ticketPaid`                                 | 394     | `lib/domain/tickets.ts`                                                           |
| `orderTotal`                                 | 331     | `lib/domain/orders.ts`                                                            |
| `orderPaid`                                  | 337     | `lib/domain/orders.ts`                                                            |
| `customerName`                               | 296     | `components/wholesale/types.ts`                                                   |
| `customerPurchasedProducts`                  | 297     | `components/wholesale/types.ts`                                                   |
| Receivables/payables (inline in `Dashboard`) | 666-680 | `computeReceivables` / `computePayables` in `components/dashboard/receivables.ts` |

## Configuration → data

Everything here became rows, editable through the Permissions UI rather than code.

| Prototype construct             | v0.4 | Production location                                                                                                                   |
| ------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `SHOPS`                         | 140  | `shops` table (migration 0001)                                                                                                        |
| `DEFAULT_SHOP_INFO`             | 147  | `shop_info` table (0001)                                                                                                              |
| `DEFAULT_ROLES`                 | 154  | `roles` table (0001)                                                                                                                  |
| `ROLE_ICON_CHOICES`             | 160  | `components/permissions/permissionMeta.ts` (a UI picker list, not data)                                                               |
| `NAV_ITEMS`                     | 167  | `components/layout/navItems.ts` (labels/icons/routes) — which entries a role sees is `role_permissions` where `permission_type='nav'` |
| `DEFAULT_NAV_PERMISSIONS`       | 176  | `role_permissions` rows, `permission_type='nav'` (0002)                                                                               |
| `DASHBOARD_WIDGETS`             | 182  | `components/permissions/permissionMeta.ts` (key list + labels)                                                                        |
| `OTHER_CAPABILITIES`            | 192  | `components/permissions/permissionMeta.ts`                                                                                            |
| `DEFAULT_DASHBOARD_PERMISSIONS` | 196  | `role_permissions`, `permission_type='dashboard_widget'` (0002)                                                                       |
| `BLANK_PERMISSION_SET`          | 202  | `components/permissions/permissionMeta.ts`                                                                                            |
| `BLANK_NAV_PERMISSION_SET`      | 203  | `components/permissions/permissionMeta.ts`                                                                                            |
| `MODULE_CAPABILITIES`           | 204  | `components/permissions/permissionMeta.ts`                                                                                            |
| `DEFAULT_MODULE_PERMISSIONS`    | 221  | `role_permissions`, `permission_type='module_capability'` (0002)                                                                      |
| `BLANK_MODULE_PERMISSION_SET`   | 227  | `components/permissions/permissionMeta.ts`                                                                                            |
| `DEFAULT_STATUSES`              | 228  | `statuses` table (0003)                                                                                                               |
| `DEFAULT_WS_STATUS`             | 303  | `ws_statuses` table (0003)                                                                                                            |
| `DEFAULT_BOOKING_CHANNELS`      | 270  | `option_lists`, `list_key='booking_channels'` (0003)                                                                                  |
| `DEFAULT_SERVICE_TYPES`         | 271  | `option_lists`, `service_types`                                                                                                       |
| `DEFAULT_CAR_TYPES`             | 272  | `option_lists`, `car_types`                                                                                                           |
| `DEFAULT_CAR_BRANDS`            | 273  | `option_lists`, `car_brands`                                                                                                          |
| `DEFAULT_TIME_SLOTS`            | 276  | `option_lists`, `time_slots`                                                                                                          |
| `DEFAULT_FILM_POSITIONS`        | 277  | `option_lists`, `film_positions`                                                                                                      |
| `DEFAULT_WRAP_POSITIONS`        | 278  | `option_lists`, `wrap_positions`                                                                                                      |
| `DEFAULT_EXTRA_OPTIONS`         | 279  | `option_lists`, `extra_options`                                                                                                       |
| `DEFAULT_SLIDE_TYPES`           | 280  | `option_lists`, `slide_types`                                                                                                         |
| `DEFAULT_PRODUCT_CATEGORIES`    | 346  | `option_lists`, `product_categories`                                                                                                  |
| `DEFAULT_SERVICE_ITEMS`         | 347  | `option_lists`, `service_items`                                                                                                       |
| `DEFAULT_EXPENSE_CATEGORIES`    | 360  | `option_lists`, `expense_categories`                                                                                                  |
| `DEFAULT_PAYMENT_SOURCES`       | 361  | `option_lists`, `payment_sources`                                                                                                     |
| `DEFAULT_PAYMENT_METHODS`       | 302  | `option_lists`, `payment_methods`                                                                                                     |
| `BRAND_TH`                      | 274  | `components/tickets/types.ts` (Thai labels for the print sheet / vehicle form)                                                        |
| `MODEL_TH`                      | 275  | `components/tickets/types.ts`                                                                                                         |

## Sample data → seed

| Prototype construct      | v0.4 | Production location                                                                                                  |
| ------------------------ | ---- | -------------------------------------------------------------------------------------------------------------------- |
| `initialUsers`           | 161  | `supabase/seed.ts` (Auth accounts + `app_users` + `user_shop_access`)                                                |
| `initialTickets`         | 238  | `supabase/seed.sql` → `tickets`, `ticket_items`, `ticket_item_positions`, `ticket_payments`, `ticket_status_history` |
| `initialRetailCustomers` | 281  | `supabase/seed.sql` → `retail_customers`                                                                             |
| `initialCustomers`       | 289  | `supabase/seed.sql` → `wholesale_customers`                                                                          |
| `initialOrders`          | 310  | `supabase/seed.sql` → `orders`, `order_items`, `order_returns`, `order_payments`, `order_adjustments`                |
| `initialStock`           | 339  | `supabase/seed.sql` → `stock`                                                                                        |
| `initialWithdrawals`     | 348  | `supabase/seed.sql` → `withdrawals`                                                                                  |
| `initialCommissionRules` | 352  | `supabase/seed.sql` → `commission_rules`, `commission_rule_teams`                                                    |
| `initialExpenses`        | 362  | `supabase/seed.sql` → `expenses`                                                                                     |
| `initialPettyCash`       | 369  | `supabase/seed.sql` → `petty_cash`                                                                                   |
| `BLANK_TICKET`           | 269  | `components/tickets/types.ts` + `blankTicket` in `app/(app)/tickets/data.ts`                                         |
| `BLANK_ORDER`            | 330  | Inlined in `app/(app)/wholesale/data.ts` / the new-order route                                                       |

Empty in the prototype (`useState([])`, :4358-4370) and therefore empty in the
seed too: `price_matrix`, `film_price_matrix`, `corporate_buyers`.

## Components

| Prototype construct      | v0.4 | Production location                                                                                                                                                                                                              |
| ------------------------ | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Badge`                  | 395  | `components/ui/Badge.tsx`                                                                                                                                                                                                        |
| `StatusPill`             | 2470 | `components/ui/StatusPill.tsx`                                                                                                                                                                                                   |
| `PeriodShopFilter`       | 2477 | `components/ui/PeriodShopFilter.tsx`                                                                                                                                                                                             |
| `ManagedDropdown`        | 1150 | `components/ui/ManagedDropdown.tsx`                                                                                                                                                                                              |
| `DateTimeField`          | 1184 | `components/ui/DateTimeField.tsx` (diverges deliberately — timezone fix, correction C4)                                                                                                                                          |
| `ManagedChipPicker`      | 1197 | `components/ui/ManagedChipPicker.tsx`                                                                                                                                                                                            |
| `ManagedMultiChipPicker` | 1238 | `components/ui/ManagedMultiChipPicker.tsx`                                                                                                                                                                                       |
| `Sidebar`                | 402  | `components/layout/Sidebar.tsx` (server, permission gate) + `SidebarNav.tsx` (client)                                                                                                                                            |
| `Header`                 | 453  | `components/layout/Header.tsx`                                                                                                                                                                                                   |
| `DoughnutChart`          | 499  | `components/charts/DoughnutChart.tsx`                                                                                                                                                                                            |
| `BarChart`               | 511  | `components/charts/BarChart.tsx`                                                                                                                                                                                                 |
| `LineChart`              | 524  | `components/charts/LineChart.tsx`                                                                                                                                                                                                |
| `JobCalendar`            | 571  | `components/dashboard/JobCalendar.tsx`                                                                                                                                                                                           |
| `Dashboard`              | 642  | `components/dashboard/Dashboard.tsx` + `DashboardFilter.tsx` + `TicketStatusSelect.tsx`; server aggregation in `app/(app)/dashboard/page.tsx`                                                                                    |
| `TicketList`             | 959  | `components/tickets/TicketList.tsx` + `TicketListClient.tsx`                                                                                                                                                                     |
| `TicketCustomerPicker`   | 1270 | `components/tickets/TicketCustomerPicker.tsx`                                                                                                                                                                                    |
| `TicketDetail`           | 1310 | `components/tickets/TicketDetail.tsx` + `TicketDetailClient.tsx` + `detail/*` (`VehicleInfoSection`, `ItemsSection`, `TechSection`, `PaymentsSection`, `ExtrasSection`) + `PrintJobSheet.tsx`                                    |
| `WholesaleList`          | 2526 | `components/wholesale/WholesaleList.tsx`                                                                                                                                                                                         |
| `CustomerPicker`         | 2649 | `components/wholesale/CustomerPicker.tsx`                                                                                                                                                                                        |
| `WholesaleDetail`        | 2690 | `components/wholesale/WholesaleDetail.tsx`                                                                                                                                                                                       |
| `WholesaleModule`        | 2968 | **Not ported** — was only a list/detail router; the App Router's `/wholesale` and `/wholesale/[id]` routes replace it                                                                                                            |
| `StockModule`            | 2980 | `components/stock/StockModule.tsx`                                                                                                                                                                                               |
| `CommissionModule`       | 3463 | `components/commission/CommissionModule.tsx`                                                                                                                                                                                     |
| `AccountingModule`       | 3528 | `components/accounting/AccountingModule.tsx`                                                                                                                                                                                     |
| `PermissionsModule`      | 3903 | `components/permissions/PermissionsModule.tsx` + `permissionMeta.ts`                                                                                                                                                             |
| `LoginScreen`            | 4285 | `app/login/page.tsx` + `app/login/actions.ts`                                                                                                                                                                                    |
| `App`                    | 4321 | **Not ported as a component** — its `view` state became routes (`app/(app)/*`), its data state became Supabase queries in each `page.tsx`, and its `role`/`canDo` wiring became `lib/auth/session.ts` + `buildSessionContext.ts` |

## Known intentional divergences

Recorded in full under "Corrections discovered during execution" in
`docs/superpowers/plans/2026-07-23-finnix-film-port-EXECUTION.md`. The ones that
change behavior rather than structure:

- **C4** — `DateTimeField` fixes a prototype timezone bug rather than reproducing it.
- **C5** — three prototype defects are reproduced on purpose in the domain layer.
- **C7** — `seesAllShops` includes the role's `seeAllShops` permission; the
  prototype had three clauses and an early port had two, which silently scoped
  every exec user to one shop.
- **C10** — login failures use fixed error codes mapped to Thai copy, never raw
  Supabase error text in a URL.
- **C11** — low stock is a strict `qty < min`, matching the prototype (the plan
  text said `<=`).
