'use client';

import { DateTimeField } from '@/components/ui/DateTimeField';
import { ManagedChipPicker } from '@/components/ui/ManagedChipPicker';
import { ManagedDropdown } from '@/components/ui/ManagedDropdown';

import { TicketCustomerPicker } from '../TicketCustomerPicker';
import { BRAND_TH, MODEL_TH, type RetailCustomer, type Ticket } from '../types';

const labelCls = 'text-xs font-medium block mb-1';

/** Customer + vehicle info block. Ported from reference/v0.4/finnix-film.html:1456-1513. */
export function VehicleInfoSection({
  t,
  field,
  bookingChannels,
  setBookingChannels,
  serviceTypes,
  setServiceTypes,
  carTypes,
  setCarTypes,
  carBrands,
  setCarBrands,
  timeSlots,
  setTimeSlots,
  retailCustomers,
  setRetailCustomers,
  onSelectCustomer,
  onModelChange,
  commitModelRegistry,
}: {
  t: Ticket;
  field: (key: keyof Ticket, value: unknown) => void;
  bookingChannels: string[];
  setBookingChannels: (v: string[]) => void;
  serviceTypes: string[];
  setServiceTypes: (v: string[]) => void;
  carTypes: string[];
  setCarTypes: (v: string[]) => void;
  carBrands: string[];
  setCarBrands: (v: string[]) => void;
  timeSlots: string[];
  setTimeSlots: (v: string[]) => void;
  retailCustomers: RetailCustomer[];
  setRetailCustomers: (v: RetailCustomer[]) => void;
  onSelectCustomer: (c: { name: string; phone: string }) => void;
  onModelChange: (v: string) => void;
  commitModelRegistry: (brand: string, carType: string) => void;
}) {
  return (
    <div className="rounded-2xl p-4 mb-5" style={{ background: 'var(--paper)' }}>
      <p
        className="text-xs font-medium mb-3 flex items-center gap-1.5"
        style={{ color: 'var(--ink-soft)' }}
      >
        <i className="fa-solid fa-car"></i>ข้อมูลงานและลูกค้า
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <div>
          <label className={labelCls} style={{ color: 'var(--ink-soft)' }}>
            1. วันที่รับงาน
          </label>
          <DateTimeField
            label="วันที่รับรถ"
            value={t.dropOffDateObj}
            onChange={(v) => field('dropOffDateObj', v)}
            timeSlots={timeSlots}
            setTimeSlots={setTimeSlots}
          />
        </div>
        <div>
          <label className={labelCls} style={{ color: 'var(--ink-soft)' }}>
            2. วันที่ส่งงาน
          </label>
          <DateTimeField
            label="วันที่ส่งงาน"
            value={t.pickupDateObj}
            onChange={(v) => field('pickupDateObj', v)}
            timeSlots={timeSlots}
            setTimeSlots={setTimeSlots}
          />
        </div>
      </div>
      <div className="mb-3">
        <label className={labelCls} style={{ color: 'var(--ink-soft)' }}>
          3. จองผ่าน
        </label>
        <ManagedDropdown
          value={t.bookingChannel}
          onChange={(v) => field('bookingChannel', v)}
          options={bookingChannels}
          setOptions={setBookingChannels}
          placeholder="เลือกช่องทางจอง..."
        />
      </div>
      <div className="mb-3">
        <label className={labelCls} style={{ color: 'var(--ink-soft)' }}>
          4. การนัดหมาย
        </label>
        <ManagedChipPicker
          value={t.serviceType}
          onChange={(v) => field('serviceType', v)}
          options={serviceTypes}
          setOptions={setServiceTypes}
        />
      </div>
      <div className="mb-3">
        <label className={labelCls} style={{ color: 'var(--ink-soft)' }}>
          5. ชื่อลูกค้า <span style={{ color: '#C24B57' }}>*</span>
        </label>
        <TicketCustomerPicker
          customerName={t.customer}
          customerPhone={t.phone}
          customers={retailCustomers}
          setCustomers={setRetailCustomers}
          onSelect={onSelectCustomer}
        />
      </div>
      <div className="mb-3">
        <label className={labelCls} style={{ color: 'var(--ink-soft)' }}>
          6. เบอร์โทร <span style={{ color: '#C24B57' }}>*</span>
        </label>
        <div className="flex gap-2">
          <input
            type="tel"
            value={t.phone}
            onChange={(e) => field('phone', e.target.value)}
            placeholder="08X-XXX-XXXX"
            className="field flex-1 text-sm px-3 py-2"
            style={{ borderColor: !t.phone ? '#C24B57' : undefined }}
          />
          <a
            href={t.phone ? `tel:${t.phone}` : undefined}
            aria-label={t.phone ? `โทรหา ${t.customer} ${t.phone}` : 'ยังไม่มีเบอร์โทร'}
            onClick={(e) => {
              if (!t.phone) e.preventDefault();
            }}
            className="px-3.5 rounded-lg text-sm flex items-center justify-center"
            style={{
              background: t.phone ? '#4C7A3E' : 'var(--line)',
              color: '#fff',
              pointerEvents: t.phone ? 'auto' : 'none',
            }}
          >
            <i className="fa-solid fa-phone"></i>
          </a>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
        <div>
          <label className={labelCls} style={{ color: 'var(--ink-soft)' }}>
            7. รุ่นรถ
          </label>
          <input
            value={t.model}
            onChange={(e) => onModelChange(e.target.value)}
            placeholder="เช่น Vios"
            className="field w-full text-sm px-3 py-2"
          />
          {MODEL_TH[t.model] && (
            <p style={{ fontSize: '10px', color: 'var(--ink-faint)', marginTop: '2px' }}>
              {MODEL_TH[t.model]}
            </p>
          )}
        </div>
        <div>
          <label className={labelCls} style={{ color: 'var(--ink-soft)' }}>
            สีรถ
          </label>
          <input
            value={t.color}
            aria-label="สีรถ"
            onChange={(e) => field('color', e.target.value)}
            className="field w-full text-sm px-3 py-2"
          />
        </div>
        <div>
          <label className={labelCls} style={{ color: 'var(--ink-soft)' }}>
            ทะเบียนรถ/เลขถัง
          </label>
          <input
            value={t.plate}
            onChange={(e) => field('plate', e.target.value)}
            aria-label="ทะเบียนรถ/เลขถัง"
            className="field w-full text-sm px-3 py-2"
          />
        </div>
      </div>
      <div className="mb-3">
        <label className={labelCls} style={{ color: 'var(--ink-soft)' }}>
          8. ยี่ห้อรถ{' '}
          <span style={{ color: 'var(--ink-faint)', fontWeight: 400 }}>
            (เติมอัตโนมัติจากรุ่นรถ แก้ไขได้)
          </span>
        </label>
        <ManagedDropdown
          value={t.brand}
          onChange={(v) => {
            field('brand', v);
            commitModelRegistry(v, t.carType);
          }}
          options={carBrands}
          setOptions={setCarBrands}
          placeholder="เลือกยี่ห้อรถ..."
        />
        {BRAND_TH[t.brand] && (
          <p style={{ fontSize: '10px', color: 'var(--ink-faint)', marginTop: '2px' }}>
            {BRAND_TH[t.brand]}
          </p>
        )}
      </div>
      <div className="mb-3">
        <label className={labelCls} style={{ color: 'var(--ink-soft)' }}>
          9. ประเภทรถ{' '}
          <span style={{ color: 'var(--ink-faint)', fontWeight: 400 }}>
            (เติมอัตโนมัติจากรุ่นรถ แก้ไขได้)
          </span>
        </label>
        <ManagedChipPicker
          value={t.carType}
          onChange={(v) => {
            field('carType', v);
            commitModelRegistry(t.brand, v);
          }}
          options={carTypes}
          setOptions={setCarTypes}
        />
      </div>
    </div>
  );
}
