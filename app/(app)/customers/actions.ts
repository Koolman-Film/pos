'use server';

import { revalidatePath } from 'next/cache';

import { getSessionContext } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';

/**
 * Writes for ทะเบียนลูกค้า. Per correction C2 every action authenticates through
 * `getSessionContext()` first and then re-checks `customers.edit` — the UI hides
 * these controls without it, but a client can POST an action it never rendered.
 */

export type CustomerResult = { ok: boolean; error?: string; id?: number };

export async function saveCustomer(input: {
  id?: number;
  name: string;
  phone: string;
}): Promise<CustomerResult> {
  const session = await getSessionContext();
  if (!session.canDo('customers.edit'))
    return { ok: false, error: 'ไม่มีสิทธิ์แก้ไขทะเบียนลูกค้า' };

  const name = input.name.trim();
  const phone = input.phone.trim();
  if (!name) return { ok: false, error: 'กรุณากรอกชื่อลูกค้า' };

  const supabase = await createClient();
  if (input.id) {
    const { error } = await supabase
      .from('retail_customers')
      .update({ name, phone })
      .eq('id', input.id);
    if (error) return { ok: false, error: error.message };
    revalidatePath('/customers');
    return { ok: true, id: input.id };
  }

  // The ticket form's `resolveRetailCustomerId` treats name+phone as the
  // identity of a customer, so adding a duplicate here would create a second row
  // that the next ticket would never pick. Reuse the existing one instead.
  const { data: existing } = await supabase
    .from('retail_customers')
    .select('id')
    .eq('name', name)
    .eq('phone', phone)
    .limit(1)
    .maybeSingle();
  if (existing?.id) return { ok: false, error: 'มีลูกค้าชื่อและเบอร์นี้อยู่แล้วในทะเบียน' };

  const { data, error } = await supabase
    .from('retail_customers')
    .insert({ name, phone })
    .select('id')
    .single();
  if (error) return { ok: false, error: error.message };
  revalidatePath('/customers');
  return { ok: true, id: data?.id };
}

/**
 * Removing a customer is only allowed while nothing points at them: `tickets`
 * references `retail_customers(id)` without a cascade, so the database would
 * reject it anyway — this turns that into a sentence a user can act on.
 */
export async function deleteCustomer(id: number): Promise<CustomerResult> {
  const session = await getSessionContext();
  if (!session.canDo('customers.edit'))
    return { ok: false, error: 'ไม่มีสิทธิ์แก้ไขทะเบียนลูกค้า' };

  const supabase = await createClient();
  const { count } = await supabase
    .from('tickets')
    .select('id', { count: 'exact', head: true })
    .eq('retail_customer_id', id);
  if ((count ?? 0) > 0) {
    return {
      ok: false,
      error: `ลบไม่ได้ — ลูกค้ารายนี้มีใบงานอยู่ ${count} ใบ กรุณาแก้ไขข้อมูลแทนการลบ`,
    };
  }

  const { error } = await supabase.from('retail_customers').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/customers');
  return { ok: true, id };
}
