'use client';

import type { StatusConfig } from '@/components/ui/Badge';

import { TicketDetail, type SaveResult } from './TicketDetail';
import type {
  CarModel,
  CorporateBuyer,
  FilmPriceRow,
  InsurancePlan,
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
  deleteAction,
  unlockAction,
  attachmentUrlAction,
  corporateBuyerAction,
  carModelAction,
  extrasAction,
  serviceVisitAction,
  serviceVisitDeleteAction,
  insurancePlans,
  insuranceAction,
  insuranceDeleteAction,
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
  optionAction: (
    listKey: OptionListName,
    values: string[],
  ) => Promise<{ ok: boolean; error?: string }>;
  deleteAction?: (ticketId: string) => Promise<{ ok: boolean; error?: string }>;
  unlockAction?: (ticketId: string) => Promise<{ ok: boolean; error?: string }>;
  attachmentUrlAction?: (path: string) => Promise<{ url?: string; error?: string }>;
  corporateBuyerAction?: (input: {
    name: string;
    address: string;
    taxId: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  carModelAction?: (input: {
    model: string;
    brand: string;
    carType: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  extrasAction?: (input: {
    ticketId: string;
    extras: Record<string, unknown>;
  }) => Promise<{ ok: boolean; error?: string }>;
  serviceVisitAction?: (input: {
    id?: number;
    ticketId: string;
    visit: Record<string, unknown>;
    points: { seq: number; position: string; detail: string; note: string }[];
  }) => Promise<{ ok: boolean; error?: string; id?: number }>;
  serviceVisitDeleteAction?: (id: number) => Promise<{ ok: boolean; error?: string }>;
  insurancePlans?: InsurancePlan[];
  insuranceAction?: (input: {
    id?: number;
    ticketId: string;
    policy: Record<string, unknown>;
    claims: Record<string, unknown>[];
  }) => Promise<{ ok: boolean; error?: string; id?: number }>;
  insuranceDeleteAction?: (id: number) => Promise<{ ok: boolean; error?: string }>;
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
      deleteAction={deleteAction}
      unlockAction={unlockAction}
      attachmentUrlAction={attachmentUrlAction}
      corporateBuyerAction={corporateBuyerAction}
      carModelAction={carModelAction}
      extrasAction={extrasAction}
      serviceVisitAction={serviceVisitAction}
      serviceVisitDeleteAction={serviceVisitDeleteAction}
      insurancePlans={insurancePlans}
      insuranceAction={insuranceAction}
      insuranceDeleteAction={insuranceDeleteAction}
    />
  );
}
