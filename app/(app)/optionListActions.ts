'use server';

import { revalidatePath } from 'next/cache';

import { getSessionContext } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { OPTION_LIST_PATHS, isOptionListKey } from '@/lib/domain/optionLists';

/**
 * Replace one value list in `option_lists`.
 *
 * Shared by every module with a "+ เพิ่มตัวเลือกใหม่..." picker. Only Book งาน
 * ever had one: สต็อกสินค้า, บัญชี and ขายส่ง passed a plain `useState` setter
 * as their `setOptions`, so a category added there lived in React state and was
 * gone on the next load — while the product saved with it kept a category that
 * no longer appeared in any dropdown. That is the "ชนิดสินค้าเป็น จอ แต่ในรายละเอียด
 * ไม่มี" the trial run hit.
 *
 * Every route that renders a list is revalidated, not just the caller's: the
 * lists are global, so a ชนิดสินค้า invented in สต็อกสินค้า has to show up in the
 * ticket form as well.
 */
export async function updateOptionListAction(
  listKey: string,
  values: string[],
): Promise<{ ok: boolean; error?: string }> {
  // Authenticate before mutating. These lists are shared by every shop and every
  // ticket, so extending one is an administrative act, not part of doing a job.
  // The pickers hide their add/remove controls without this capability; this is
  // the actual gate.
  const session = await getSessionContext();
  if (!session.canDo('options.manage')) {
    return { ok: false, error: 'ไม่มีสิทธิ์แก้ไขรายการตัวเลือก (เฉพาะแอดมิน)' };
  }
  if (!isOptionListKey(listKey)) return { ok: false, error: 'invalid list' };

  // Blank and duplicate entries would each cost a row and break the unique
  // (list_key, value, shop_id) index the insert relies on.
  const clean = [...new Set(values.map((v) => v.trim()).filter(Boolean))];

  const supabase = await createClient();
  try {
    await supabase.from('option_lists').delete().eq('list_key', listKey).is('shop_id', null);
    if (clean.length) {
      const { error } = await supabase.from('option_lists').insert(
        clean.map((value, i) => ({
          list_key: listKey,
          value,
          shop_id: null,
          sort_order: i + 1,
        })),
      );
      if (error) throw new Error(error.message);
    }
    for (const path of OPTION_LIST_PATHS) revalidatePath(path);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ' };
  }
}
