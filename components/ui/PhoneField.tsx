'use client';

import { sanitizePhoneTyping } from '@/lib/domain/phone';

/**
 * ช่องเบอร์โทร — ไม่ใส่ขีด หลายเบอร์คั่นด้วย , (ร้านขอ 15 ก.ย. 2569).
 *
 * The rule is enforced as the number is typed rather than refused on save:
 * a dash or a space simply does not go in, and a pasted "081-234-5678" lands as
 * "0812345678". See lib/domain/phone.ts.
 */

export const PHONE_HINT = 'ไม่ต้องใส่ - · หลายเบอร์คั่นด้วย ,';

export function PhoneInput({
  value,
  onChange,
  ariaLabel,
  placeholder = '0812345678',
  className,
  style,
}: {
  value: string;
  onChange: (value: string) => void;
  ariaLabel?: string;
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <input
      type="tel"
      value={value}
      onChange={(e) => onChange(sanitizePhoneTyping(e.target.value))}
      placeholder={placeholder}
      aria-label={ariaLabel}
      title={PHONE_HINT}
      className={className}
      style={style}
    />
  );
}

/**
 * เบอร์นี้มีในทะเบียนแล้ว.
 *
 * A warning, not a refusal: two people can share a number (a husband and wife,
 * a shop's landline), so the person at the counter decides. It names who has
 * the number, and `onUse` — where the form can do it — picks that customer
 * instead of creating a second one.
 */
export function PhoneOwnersWarning<T extends { id: number; name: string; phone: string }>({
  owners,
  onUse,
}: {
  owners: T[];
  onUse?: (customer: T) => void;
}) {
  if (owners.length === 0) return null;
  return (
    <div
      role="alert"
      className="rounded-xl px-3 py-2.5 text-xs mb-3"
      style={{ background: '#FBF1DA', color: '#8A5A12', border: '1px solid #E8B23D' }}
    >
      <p className="font-semibold mb-1">
        <i className="fa-solid fa-triangle-exclamation mr-1"></i>
        เบอร์นี้มีในทะเบียนแล้ว — ตรวจก่อนว่าไม่ใช่ลูกค้าคนเดิม
      </p>
      <ul className="flex flex-col gap-1">
        {owners.map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-2 flex-wrap">
            <span>
              {c.name} · {c.phone}
            </span>
            {onUse && (
              <button
                type="button"
                onClick={() => onUse(c)}
                className="btn-outline px-2.5 py-1 rounded-lg text-xs font-semibold"
              >
                ใช้ลูกค้าคนนี้
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
