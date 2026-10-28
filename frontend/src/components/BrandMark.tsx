import React from 'react';

/** The Verveflow mark: three fanned task cards, the front one ticked. Navy and white only. */
export const BrandMark: React.FC<{ size?: number }> = ({ size = 32 }) => (
  // Cropped to the cards themselves (they sit inside 11..54 x 9..53.5), so the mark fills its square.
  <svg width={size} height={size} viewBox="9.5 8.25 46 46" aria-hidden="true" style={{ display: 'block', flex: 'none' }}>
    <rect x="15" y="12" width="30" height="38" rx="7" fill="#D3DDF1" transform="rotate(-14 30 31)" />
    <rect x="19" y="12" width="30" height="38" rx="7" fill="#7D98D1" transform="rotate(-4 34 31)" />
    <rect x="22" y="14" width="30" height="38" rx="7" fill="#234788" transform="rotate(7 37 33)" />
    <path
      d="M30 33 L35.5 38.5 L45 27" transform="rotate(7 37 33)"
      fill="none" stroke="#FFFFFF" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round"
    />
  </svg>
);

/** The mark with the app name beside it. */
export const BrandLockup: React.FC<{ size?: number }> = ({ size = 40 }) => (
  <div className="brand-lockup">
    <BrandMark size={size} />
    <span className="brand-lockup-name">verve<span>flow</span></span>
  </div>
);
