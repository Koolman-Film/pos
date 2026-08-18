import { getSessionContext } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { fmtThaiDate } from '@/lib/domain/format';
import {
  StockModule,
  type StockItem,
  type Withdrawal,
  type FilmPriceEntry,
} from '@/components/stock/StockModule';

import { updateOptionListAction } from '../optionListActions';
import { loadInsurancePlans } from '../tickets/data';

import {
  addProductAction,
  bulkImportAction,
  adjustStockAction,
  withdrawAction,
  saveProductAction,
  deleteProductAction,
  setFilmPriceAction,
  saveInsurancePlanAction,
  deleteInsurancePlanAction,
} from './actions';

async function optionValues(
  supabase: Awaited<ReturnType<typeof createClient>>,
  listKey: string,
): Promise<string[]> {
  const { data } = await supabase
    .from('option_lists')
    .select('value')
    .eq('list_key', listKey)
    .order('sort_order', { ascending: true });
  return (data ?? []).map((r) => r.value);
}

export default async function StockPage() {
  // Calling getSessionContext() IS the authorization check (redirects if invalid).
  const session = await getSessionContext();
  const supabase = await createClient();

  const canSeeStockPrices = session.hasDashboardWidget('seeStockPrices');
  const isAdmin = session.roleId === 'admin';

  // All shops the caller may see, in canonical sort order.
  const { data: shopRows } = await supabase
    .from('shops')
    .select('id, name, sort_order')
    .order('sort_order', { ascending: true });
  const accessibleShops = (shopRows ?? [])
    .filter((s) => session.accessibleShopIds.includes(s.id))
    .map((s) => ({ id: s.id, name: s.name }));

  // Stock, scoped by RLS to the caller's shops. C2: cost/sell_price are ONLY
  // selected — and therefore only sent to the client — when the caller has the
  // `seeStockPrices` widget. A price-blind client never receives those values.
  // Two static `select` literals (not a computed string) so the generated types
  // resolve; the branch that omits the columns is what enforces the data gate.
  const { data: stockRows } = canSeeStockPrices
    ? await supabase
        .from('stock')
        .select('id, sku, name, short_name, category, shop_id, qty, min_qty, cost, sell_price')
        .order('category', { ascending: true })
        .order('name', { ascending: true })
    : await supabase
        .from('stock')
        .select('id, sku, name, short_name, category, shop_id, qty, min_qty')
        .order('category', { ascending: true })
        .order('name', { ascending: true });

  type StockRow = {
    id: number;
    sku: string;
    name: string;
    short_name: string;
    category: string;
    shop_id: string;
    qty: number;
    min_qty: number;
    cost?: number;
    sell_price?: number;
  };
  const stock: StockItem[] = ((stockRows ?? []) as unknown as StockRow[]).map((row) => {
    const item: StockItem = {
      id: row.id,
      sku: row.sku,
      name: row.name,
      shortName: row.short_name || '',
      category: row.category,
      shop: row.shop_id,
      qty: row.qty,
      min: row.min_qty,
    };
    if (canSeeStockPrices) {
      item.cost = row.cost ?? 0;
      item.sellPrice = row.sell_price ?? 0;
    }
    return item;
  });

  const { data: wdRows } = await supabase
    .from('withdrawals')
    .select('id, item, shop_id, qty, type, status, withdrawn_by, withdrawn_at')
    .order('withdrawn_at', { ascending: false });
  const withdrawals: Withdrawal[] = (wdRows ?? []).map((w) => ({
    id: w.id,
    item: w.item,
    shop: w.shop_id,
    qty: w.qty,
    type: w.type,
    by: w.withdrawn_by,
    date: fmtThaiDate(w.withdrawn_at ? new Date(w.withdrawn_at) : null),
    status: w.status,
  }));

  const [productCategories, carTypes, filmPositions, wrapPositions] = await Promise.all([
    optionValues(supabase, 'product_categories'),
    optionValues(supabase, 'car_types'),
    optionValues(supabase, 'film_positions'),
    optionValues(supabase, 'wrap_positions'),
  ]);

  // Film price matrix only matters to the admin pricing panel.
  let filmPriceMatrix: FilmPriceEntry[] = [];
  if (isAdmin) {
    const { data: fp } = await supabase
      .from('film_price_matrix')
      .select('category, product, position, car_type, price');
    filmPriceMatrix = (fp ?? []).map((e) => ({
      category: e.category,
      product: e.product,
      position: e.position,
      carType: e.car_type,
      price: e.price,
    }));
  }

  // แผนประกัน — configuration, like the film price matrix, and edited here for
  // the same reason: it is a price list, not part of any one job.
  const insurancePlans = await loadInsurancePlans();

  // A serialisable map, NOT session.canDo. StockModule is a Client Component, and
  // handing it the closure makes React refuse to serialise the tree, which 500s
  // the whole /stock route. Only the keys this module actually gates on.
  const caps = {
    'stock.addProduct': session.canDo('stock.addProduct'),
    'stock.adjustStock': session.canDo('stock.adjustStock'),
    'stock.withdraw': session.canDo('stock.withdraw'),
    'stock.editDelete': session.canDo('stock.editDelete'),
    'stock.export': session.canDo('stock.export'),
    'options.manage': session.canDo('options.manage'),
  };

  return (
    <StockModule
      stock={stock}
      withdrawals={withdrawals}
      caps={caps}
      canSeeStockPrices={canSeeStockPrices}
      isAdmin={isAdmin}
      accessibleShops={accessibleShops}
      canSeeAllShops={session.seesAllShops}
      productCategories={productCategories}
      carTypes={carTypes}
      filmPositions={filmPositions}
      wrapPositions={wrapPositions}
      filmPriceMatrix={filmPriceMatrix}
      insurancePlans={insurancePlans}
      actions={{
        addProduct: addProductAction,
        bulkImport: bulkImportAction,
        adjustStock: adjustStockAction,
        withdraw: withdrawAction,
        saveProduct: saveProductAction,
        deleteProduct: deleteProductAction,
        setFilmPrice: setFilmPriceAction,
        saveInsurancePlan: saveInsurancePlanAction,
        deleteInsurancePlan: deleteInsurancePlanAction,
        updateOptionList: updateOptionListAction,
      }}
    />
  );
}
