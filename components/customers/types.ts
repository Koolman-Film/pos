/**
 * Client-side view models for ทะเบียนลูกค้า.
 *
 * Mirrors what `app/(app)/customers/data.ts` produces: the registry row plus the
 * per-customer aggregates derived from their tickets. Kept here so the client
 * component does not import from a server-only module.
 */

export type CustomerVehicle = { plate: string; brand: string; model: string; carType: string };

export type CustomerTicket = {
  id: string;
  shop: string;
  status: string;
  dropOff: Date | null;
  total: number;
};

export type CustomerRow = {
  id: number;
  name: string;
  phone: string;
  ticketCount: number;
  totalSpent: number;
  lastVisit: Date | null;
  vehicles: CustomerVehicle[];
  tickets: CustomerTicket[];
};
