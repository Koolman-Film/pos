// tests/rls/identity.test.ts
import { describe, it, expect } from 'vitest';
import { adminClient } from './_helpers';

// Read-only against seed data; no fixtures to clean up.
const supabase = adminClient();

describe('identity schema seed data', () => {
  it('has all 5 shops', async () => {
    const { data, error } = await supabase.from('shops').select('id').order('sort_order');
    expect(error).toBeNull();
    expect(data?.map(s => s.id)).toEqual(['cm', 'lp', 'py', 'lpg', 'ca']);
  });

  it('has all 4 default roles', async () => {
    const { data } = await supabase.from('roles').select('id');
    expect(data?.map(r => r.id).sort()).toEqual(['admin', 'exec', 'sales', 'tech']);
  });

  it('grants sales role the list.createNew module capability but not stock.editDelete', async () => {
    const { data } = await supabase
      .from('role_permissions')
      .select('permission_key, allowed')
      .eq('role_id', 'sales')
      .eq('permission_type', 'module_capability')
      .in('permission_key', ['list.createNew', 'stock.editDelete']);
    const byKey = Object.fromEntries(data!.map(r => [r.permission_key, r.allowed]));
    expect(byKey['list.createNew']).toBe(true);
    expect(byKey['stock.editDelete']).toBe(false);
  });
});
