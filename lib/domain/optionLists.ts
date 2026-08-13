/**
 * Every value list in `option_lists`, in one place.
 *
 * These are the lists behind the "+ เพิ่มตัวเลือกใหม่..." pickers. The registry
 * is shared because the server action that writes them is shared: each module
 * used to own its own idea of which keys were legitimate, and three of the four
 * modules never wrote to the table at all (see updateOptionListAction).
 */
export const OPTION_LIST_KEYS = [
  // Book งาน
  'booking_channels',
  'service_types',
  'car_types',
  'car_brands',
  'time_slots',
  'film_positions',
  'wrap_positions',
  'extra_options',
  'slide_types',
  'technicians',
  'product_categories',
  'service_items',
  'payment_methods',
  // บัญชี/ค่าใช้จ่าย
  'expense_categories',
  'payment_sources',
] as const;

export type OptionListKey = (typeof OPTION_LIST_KEYS)[number];

export function isOptionListKey(key: string): key is OptionListKey {
  return (OPTION_LIST_KEYS as readonly string[]).includes(key);
}

/**
 * Routes that render an option list. A list is global, so extending one from
 * สต็อกสินค้า has to reach Book งาน too — otherwise the new ชนิดสินค้า is in the
 * table but missing from the ticket form until something else revalidates.
 */
export const OPTION_LIST_PATHS = ['/tickets', '/stock', '/accounting', '/wholesale'] as const;
