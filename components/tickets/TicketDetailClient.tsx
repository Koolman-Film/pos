'use client';

import type { StatusConfig } from '@/components/ui/Badge';

import { TicketDetail, type SaveResult } from './TicketDetail';
import type {
  CarModel,
  CorporateBuyer,
  FilmPriceRow,
  OptionListName,
  PriceMatrixRow,
  RetailCustomer,
  Shop,
  ShopInfo,
  StockRow,
  Ticket,
  TicketSavePayload,
} from './types';

/**
 * Client boundary for the detail/new form. The page passes serializable data
 * plus the `saveAction`/`optionAction` server actions (which DO cross the RSC
 * boundary) and a plain `capabilities` map; this wrapper rebuilds `canDo`.
 */
export function TicketDetailClient({
  initialTicket,
  isNew,
  shops,
  statuses,
  capabilities,
  currentUserName,
  initialOptions,
  initialStock,
  initialCarModels,
  initialPriceMatrix,
  filmPriceMatrix,
  initialRetailCustomers,
  initialCorporateBuyers,
  shopInfo,
  saveAction,
  optionAction,
}: {
  initialTicket: Ticket;
  isNew: boolean;
  shops: Shop[];
  statuses: StatusConfig[];
  capabilities: Record<string, boolean>;
  currentUserName: string;
  initialOptions: Record<OptionListName, string[]>;
  initialStock: StockRow[];
  initialCarModels: CarModel[];
  initialPriceMatrix: PriceMatrixRow[];
  filmPriceMatrix: FilmPriceRow[];
  initialRetailCustomers: RetailCustomer[];
  initialCorporateBuyers: CorporateBuyer[];
  shopInfo: Record<string, ShopInfo>;
  saveAction: (payload: TicketSavePayload) => Promise<SaveResult>;
  optionAction: (listKey: OptionListName, values: string[]) => Promise<{ ok: boolean; error?: string }>;
}) {
  const canDo = (key: string) => !!capabilities[key];
  return (
    <TicketDetail
      initialTicket={initialTicket}
      isNew={isNew}
      shops={shops}
      statuses={statuses}
      canDo={canDo}
      currentUserName={currentUserName}
      initialOptions={initialOptions}
      initialStock={initialStock}
      initialCarModels={initialCarModels}
      initialPriceMatrix={initialPriceMatrix}
      filmPriceMatrix={filmPriceMatrix}
      initialRetailCustomers={initialRetailCustomers}
      initialCorporateBuyers={initialCorporateBuyers}
      shopInfo={shopInfo}
      saveAction={saveAction}
      optionAction={optionAction}
    />
  );
}
